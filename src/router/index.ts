// Off-chain swap execution builder. BTR has NO on-chain router: a routed/split swap is a sequence of
// plain `approve` + `Pool.swap` calls the user's wallet submits directly — batched atomically via
// EIP-5792 `wallet_sendCalls` where the wallet supports it, else sequentially. This module turns a
// route plan (computed off-chain, e.g. by front `lib/amm/router`) into that ordered call list.
//
// Multicall3 CANNOT execute these: `Pool.swap` pulls tokenIn from `msg.sender`, which under
// Multicall3.aggregate3 is the Multicall3 contract (no funds, no allowance) → revert. So the calls
// must originate from the user account — EIP-5792 batch or N direct txs.

import { POOL_ABI } from '../abis/Pool.js';
import type { SwapPlan } from '../amm/router.js';
import { encodeFn } from '../eth/abi.js';
import type { Abi } from '../eth/abi.js';
import { ERC20_ABI } from '../eth/erc20.js';
import type { Address, Hex } from '../eth/types.js';
import { defaultDeadline } from '../pool/index.js';
import { applySlip } from '../utils/maths.js';
export { applySlip };

/** WETH9 wrap/unwrap. The pool NEVER sees the gas token: it is wrapped and unwrapped by the user's
 *  own account inside the same batch, so no pool-side native path (and no contract change) is used. */
const WNATIVE_ABI: Abi = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
];

/** One executable swap leg. For a split, pass several (parallel, each funded from the user's tokenIn).
 *  For a cross-pool 2-hop the caller passes two legs where leg2.amountIn is set conservatively to
 *  leg1.minOut (the exact bridged amount isn't known until leg1 executes; the small remainder stays
 *  with the user). */
export interface ExecLeg {
  pool: Address; // pool clone that runs this swap
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint; // per-leg slippage floor
  /** The output this leg was QUOTED at, in base units - the number the user was shown. `minOut` is
   *  always `applySlip(quotedOut, slippageFrac)` and nothing else, so the tolerance that actually
   *  reaches calldata is auditable from the leg alone (see `refloorLeg`). */
  quotedOut: bigint;
  /** tokenIn is the chain's wrapped native and the user pays the gas token: prepend a wrap. */
  wrapIn?: boolean;
  /** tokenOut is the chain's wrapped native and the user wants the gas token: append an unwrap. */
  unwrapOut?: boolean;
  /** This leg is funded by the PRECEDING leg's output (a cross part's second hop): its `amountIn`
   *  is the previous leg's `minOut`, so re-flooring the previous leg must re-chain this one. */
  chained?: boolean;
}

/** Re-floor one leg against the pool's OWN quote, read fresh at send time.
 *
 *  WHY THIS EXISTS. `minOut` used to be `applySlip(quotedOut, slip)` and nothing more, where
 *  `quotedOut` came from the off-chain model (`@sdk/amm` or the Rust pricer) at DISPLAY time. Two
 *  gaps then ate the whole tolerance before the transaction was ever sent:
 *   1. model-vs-chain. The replica is not bit-exact with `Pricing._quotePath`; measured live on Arc
 *      the front quoted 1000.12 USDC.b for 1000 USDT.b while `Pool.getSwapQuote` returned
 *      1000.016425205618633264 - 1.04 bps rich, against a spread-scaled tolerance of 0.9 bps.
 *      Deterministic `ThresholdViolation`, no market move required.
 *   2. time. `Pricing._staleTerm` is `sigma*sqrt(age - grace)` re-evaluated at `block.timestamp`,
 *      so the deliverable output DECAYS with wall-clock even with a frozen mark, and an approval
 *      mined between quote and swap sits squarely inside that window.
 *
 *  So the floor is taken against `min(quotedOut, freshOut)`: never above the floor the user was
 *  promised (`applySlip(quotedOut)`), and never above what the pool can pay right now - which is
 *  what leaves the tolerance real room for the drift that happens AFTER the send. `freshOut` must
 *  come from `Pool.getSwapQuote`, the view twin of the `getAnchorPathQuote` call `Pricing.swap`
 *  makes: same routing path, same maths, evaluated one block early.
 *
 *  The caller is responsible for refusing to send when `freshOut < applySlip(quotedOut, slip)`:
 *  that is the quote going stale beyond what the user agreed to, and it must surface as a warning,
 *  never as a silently lowered floor. */
export function refloorLeg(leg: ExecLeg, freshOut: bigint, slippageFrac: number): ExecLeg {
  const base = freshOut > 0n && freshOut < leg.quotedOut ? freshOut : leg.quotedOut;
  return { ...leg, minOut: applySlip(base, slippageFrac) };
}

/** An encoded call ready for eth_sendTransaction / wallet_sendCalls. */
export interface ExecCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface BuildOpts {
  recipient: Address; // where tokenOut lands (usually the user)
  /** Return false to SKIP a token→pool approval (e.g. cached allowance already covers it). Called once
   *  per unique (tokenIn, pool). Default: emit an approval for every non-native leg that needs one. */
  needsApproval?: (tokenIn: Address, pool: Address, amountIn: bigint) => boolean;
  /** When true, approve max uint256 (reuse forever). When false/omitted (default), approve only the
   *  exact Σ amountIn for that (token, pool) — standard exact-amount approve + swap. */
  approveMax?: boolean;
  /** Unix-seconds swap expiry; defaults to now + 600s. Pass NO_DEADLINE to opt out. */
  deadline?: bigint;
  /** Chain's wrapped-native (WETH9) address. Required as soon as any leg sets wrapIn/unwrapOut. */
  wrappedNative?: Address;
}

const MAX_UINT256 = (1n << 256n) - 1n;

export interface TokenMeta {
  address: Address;
  decimals: number;
}

export interface PlanLegOpts {
  slippageFrac: number; // per-leg slippage floor (0.005 = 0.5%)
  tokenOf: (symbol: string) => TokenMeta | undefined; // route symbols → on-chain meta
  /** User pays the gas token: the first leg of every part wraps before it swaps. The plan itself is
   *  always expressed in the WRAPPED symbol, so routing and pricing stay wrap-agnostic (1:1). */
  nativeIn?: boolean;
  /** User wants the gas token back: the last leg of every part unwraps after it swaps. */
  nativeOut?: boolean;
  /** EXACT input size in base units - the same bigint the caller's balance guard compared against
   *  `balanceOf`, and the amount the wallet is actually asked to part with. Supply it whenever it
   *  is known.
   *
   *  Without it the input leg is rebuilt from `plan.amountIn`, an f64 that cannot hold 18 decimals:
   *  a balance of 31049999999999999999 wei seeds the field as "31.049999999999999999", `parseFloat`
   *  rounds it to 31.05, and `toUnits` hands the pool 31050000000000000000 - ONE WEI above the
   *  balance, so `transferFrom` reverts `TransferFromFailed()` (0x7939f424) on every max-balance
   *  swap. The approval is built from the same inflated sum, so it matches and hides the cause.
   *  Split parts are carved from this bigint and sum back to it EXACTLY. */
  amountInUnits?: bigint;
}

/** EIP-7528 native sentinel. Legs are always expressed in the wrapped address; this only guards it. */
const SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const isSentinel = (a: Address): boolean => a.toLowerCase() === SENTINEL;

/** Human amount → integer units. Goes through `toExponential` rather than `toFixed`: at
 *  1e21 and above `toFixed` emits exponential notation ("1e+21"), which the old `parseUnits`
 *  path could not read, silently producing a garbage `minOut` for any large-supply token.
 *  Rounds DOWN, so a `minOut` built from this is never rounded up past what the quote saw. */
const toUnits = (v: number, decimals: number): bigint => {
  if (!Number.isFinite(v) || v <= 0) return 0n;
  const [mant, exp] = v.toExponential(15).split('e');
  const digits = mant.replace('.', '');
  // toExponential(15) is always one integer digit plus 15 fractional ones.
  const shift = Number(exp) - (digits.length - 1) + Math.min(decimals, 18);
  const n = BigInt(digits);
  return shift >= 0 ? n * 10n ** BigInt(shift) : n / 10n ** BigInt(-shift);
};

/** Map a router plan (amm/router rankSwap `best`) → ExecLeg[], largest part first (so the
 *  sequential fallback fills the biggest slice first). Direct part = 1 leg; cross part = 2 legs
 *  where leg2.amountIn = leg1.minOut (the exact bridged amount isn't known until leg1 executes).
 *  `nativeIn`/`nativeOut` flag the outer legs so the batch wraps/unwraps around them.
 *  Null when any pool address or token meta is missing. */
export function planToLegs(plan: SwapPlan, opts: PlanLegOpts): ExecLeg[] | null {
  const slip = opts.slippageFrac;
  // Unvalidated, slip >= 1 drives every minOut to 0 — a batch with no slippage floor at all,
  // which is the one failure mode this function exists to prevent. NaN does the same.
  if (!Number.isFinite(slip) || slip < 0 || slip >= 1) {
    throw new Error(`planToLegs: slippageFrac must be in [0, 1), got ${slip}`);
  }
  const legs: ExecLeg[] = [];
  const parts = [...plan.parts].sort((a, b) => b.fraction - a.fraction);
  // INPUT-LEG SIZING. `plan.amountIn` is an f64 and the pay leg is what the wallet is debited, so
  // rebuilding it from that float is the one place a rounding step can push the swap ABOVE the
  // balance the caller checked. With `amountInUnits` the slices are carved from THAT bigint: each
  // is floored, the residual dust rides on the smallest (last) part, and Σ === amountInUnits to
  // the wei. Without it the old float path stands, for callers that have no exact total.
  const exactIn =
    opts.amountInUnits !== undefined && opts.amountInUnits > 0n ? opts.amountInUnits : undefined;
  const FRAC_SCALE = 1_000_000_000_000n; // 1e12: fraction precision, well inside f64's 15 digits
  let leftIn = exactIn ?? 0n;
  const partInUnits = (fraction: number, i: number, decimals: number): bigint => {
    if (exactIn === undefined) return toUnits(fraction * plan.amountIn, decimals);
    if (i === parts.length - 1) {
      const rest = leftIn;
      leftIn = 0n;
      return rest;
    }
    const f = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
    const slice = (exactIn * BigInt(Math.floor(f * Number(FRAC_SCALE)))) / FRAC_SCALE;
    const take = slice > leftIn ? leftIn : slice;
    leftIn -= take;
    return take;
  };
  for (const [i, part] of parts.entries()) {
    const rl = part.route.legs;
    if (rl.length === 1) {
      const tin = opts.tokenOf(rl[0].tokenIn);
      const tout = opts.tokenOf(rl[0].tokenOut);
      if (!rl[0].poolAddr || !tin || !tout) return null;
      const quotedOut = toUnits(part.quote.amountOut, tout.decimals);
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: tin.address,
        tokenOut: tout.address,
        amountIn: partInUnits(part.fraction, i, tin.decimals),
        quotedOut,
        minOut: applySlip(quotedOut, slip),
        wrapIn: opts.nativeIn,
        unwrapOut: opts.nativeOut,
      });
    } else {
      const t1in = opts.tokenOf(rl[0].tokenIn);
      const tmid = opts.tokenOf(rl[0].tokenOut);
      const t2out = opts.tokenOf(rl[1].tokenOut);
      if (!rl[0].poolAddr || !rl[1].poolAddr || !t1in || !tmid || !t2out) return null;
      const leg1Quoted = toUnits(part.quote.fills[0].amountOut, tmid.decimals);
      const leg1MinOut = applySlip(leg1Quoted, slip);
      const leg2Quoted = toUnits(part.quote.amountOut, t2out.decimals);
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: t1in.address,
        tokenOut: tmid.address,
        amountIn: partInUnits(part.fraction, i, t1in.decimals),
        quotedOut: leg1Quoted,
        minOut: leg1MinOut,
        wrapIn: opts.nativeIn,
      });
      legs.push({
        pool: rl[1].poolAddr as Address,
        tokenIn: tmid.address,
        tokenOut: t2out.address,
        amountIn: leg1MinOut,
        quotedOut: leg2Quoted,
        minOut: applySlip(leg2Quoted, slip),
        unwrapOut: opts.nativeOut,
        chained: true,
      });
    }
  }
  return legs;
}

/** Ordered [wrap?, approvals…, swaps…, unwrap?] calls for a routed/split swap. Approvals are deduped
 *  per (token,pool); amount is exact Σ amountIn by default, or max uint256 when `approveMax`. Gas-token
 *  legs are composed, never delegated to the pool: a `wrapIn` leg is funded by a preceding
 *  `WNATIVE.deposit{value}` and then behaves as a plain ERC-20 leg; an `unwrapOut` leg is followed by
 *  `WNATIVE.withdraw(Σ minOut)`. Withdrawing minOut (not the quote) is the only amount guaranteed to
 *  exist: any positive slippage stays with the user as wrapped-native rather than reverting the batch.
 *  No EIP-2612 / Permit2 — plain ERC-20 `approve` only.
 *
 *  `buildSwapCalls` bakes ONE `deadline` into every swap call, read at the moment it is invoked.
 *  Fine for an atomic batch (one wallet prompt, sent together), but a non-atomic multi-tx flow that
 *  approves and swaps as SEPARATE, sequentially-mined transactions can leave that deadline stale by
 *  the time the swap call actually goes out (a first-time wallet often needs 1-2 approval txs mined
 *  first). Split the two phases with `buildApprovalCalls` + `buildSwapExecCalls` and call the second
 *  one right before the swap send, so its deadline is computed then, not at batch-build time. */
function validateLegs(
  legs: ExecLeg[],
  wnative: string | undefined,
): { wrapValue: bigint; unwrapAmount: bigint } {
  let wrapValue = 0n;
  let unwrapAmount = 0n;
  for (const leg of legs) {
    // Trust boundary: the EIP-7528 sentinel is not a contract. Approving or swapping it would
    // encode an approve to an address with no code, so a leg must carry the wrapped address.
    if (isSentinel(leg.tokenIn) || isSentinel(leg.tokenOut)) {
      throw new Error('leg carries the native sentinel: pass the wrapped-native address');
    }
    // A wrap/unwrap flag that does not match the chain's wrapped-native would send value to, or
    // withdraw from, an unrelated contract. Refuse to encode it.
    if (leg.wrapIn) {
      if (!wnative || leg.tokenIn.toLowerCase() !== wnative) {
        throw new Error('wrapIn leg: tokenIn is not the chain wrapped native');
      }
      wrapValue += leg.amountIn;
    }
    if (leg.unwrapOut) {
      if (!wnative || leg.tokenOut.toLowerCase() !== wnative) {
        throw new Error('unwrapOut leg: tokenOut is not the chain wrapped native');
      }
      unwrapAmount += leg.minOut;
    }
  }
  return { wrapValue, unwrapAmount };
}

/** [wrap?, approvals…] — funds and clears allowance for the swap phase. No deadline involved: safe
 *  to build and send well ahead of the swap calls. */
export function buildApprovalCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const wnative = opts.wrappedNative?.toLowerCase();
  const { wrapValue } = validateLegs(legs, wnative);
  const exactByKey = new Map<string, bigint>();
  for (const leg of legs) {
    const key = `${leg.tokenIn.toLowerCase()}:${leg.pool.toLowerCase()}`;
    exactByKey.set(key, (exactByKey.get(key) ?? 0n) + leg.amountIn);
  }
  const approveAmt = (key: string): bigint =>
    opts.approveMax ? MAX_UINT256 : (exactByKey.get(key) ?? 0n);
  const seen = new Set<string>();
  const approvals: ExecCall[] = [];
  for (const leg of legs) {
    const key = `${leg.tokenIn.toLowerCase()}:${leg.pool.toLowerCase()}`;
    const amount = approveAmt(key);
    // A wrapped-native leg holds no allowance before the batch wraps, so it always needs one:
    // the caller's cached-allowance probe reads a pre-batch state that cannot cover it.
    const need =
      leg.wrapIn || !opts.needsApproval ? true : opts.needsApproval(leg.tokenIn, leg.pool, amount);
    if (need && !seen.has(key)) {
      seen.add(key);
      approvals.push({
        to: leg.tokenIn,
        data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [leg.pool, amount] }),
        value: 0n,
      });
    }
  }
  const wrap: ExecCall[] =
    wrapValue > 0n
      ? [
          {
            to: opts.wrappedNative as Address,
            data: encodeFn({ abi: WNATIVE_ABI, functionName: 'deposit' }),
            value: wrapValue,
          },
        ]
      : [];
  return [...wrap, ...approvals];
}

/** [swaps…, unwrap?] — `opts.deadline ?? defaultDeadline()` is read HERE, at call time: call this
 *  immediately before the send so a deadline built during an earlier approval wait cannot expire it. */
export function buildSwapExecCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const wnative = opts.wrappedNative?.toLowerCase();
  const { unwrapAmount } = validateLegs(legs, wnative);
  const deadline = opts.deadline ?? defaultDeadline();
  const swaps: ExecCall[] = legs.map((leg) => ({
    to: leg.pool,
    data: encodeFn({
      abi: POOL_ABI,
      functionName: 'swap',
      args: [leg.tokenIn, leg.tokenOut, leg.amountIn, leg.minOut, opts.recipient, deadline],
    }),
    value: 0n,
  }));
  const unwrap: ExecCall[] =
    unwrapAmount > 0n
      ? [
          {
            to: opts.wrappedNative as Address,
            data: encodeFn({ abi: WNATIVE_ABI, functionName: 'withdraw', args: [unwrapAmount] }),
            value: 0n,
          },
        ]
      : [];
  return [...swaps, ...unwrap];
}

/** Wrap first (funds the approvals), approvals before the swaps that spend them, unwrap last. One
 *  shared deadline for the whole thing — correct for a single atomic batch (one wallet prompt), but
 *  see `buildApprovalCalls`/`buildSwapExecCalls` for a non-atomic, multi-tx flow. */
export function buildSwapCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  return [...buildApprovalCalls(legs, opts), ...buildSwapExecCalls(legs, opts)];
}

/** Σ msg.value across the calls (native-in legs) — the total to attach to a batched send. */
export function totalValue(calls: ExecCall[]): bigint {
  return calls.reduce((a, c) => a + c.value, 0n);
}

// ── LP dual-route batches (spec §2.3/§2.4) ──────────────────────────────────────
//
// The LP routes compose the SAME primitives as a swap — plain calls from the user's account, one
// shared deadline per atomic batch, no on-chain router. Approval logic is REUSED
// (buildApprovalCalls), never duplicated.

export interface MarketMintArgs {
  /** 'market': Route A — [approve?, swap(X→target)…, deposit(target)]. */
  mode: 'market';
  /** Market legs ending in `depositToken` (planToLegs output). */
  legs: ExecLeg[];
  depositToken: Address;
  /** Deposit size: pass Σ per-part minOut (the guaranteed floor); anything above it stays with
   *  the user as target tokens. Deposits mint at index by design — no price guard exists. */
  depositAmount: bigint;
}
export interface TransferMintArgs {
  /** 'transfer': Route B — [approve?, deposit(X), swapLiability]. ONE approval total: the LP burn
   *  needs no allowance. Non-batchable for fresh deposits (anti-JIT) — see lpRoutes gating. */
  mode: 'transfer';
  token: Address; // X — deposited, then its liability swapped in the same batch
  amount: bigint;
  targetToken: Address;
  /** Shares the deposit mints for THIS sender (post-dead-seed estimate: amt·WAD/idx − dead). */
  lpAmountIn: bigint;
  minLpAmountOut: bigint;
}

export function buildDepositCalls(
  pool: Address,
  args: MarketMintArgs | TransferMintArgs,
  opts: BuildOpts,
): ExecCall[] {
  if (args.mode === 'market') {
    const swaps = buildSwapExecCalls(args.legs, opts);
    return [
      ...buildApprovalCalls(args.legs, opts),
      ...swaps,
      {
        to: pool,
        data: encodeFn({
          abi: POOL_ABI,
          functionName: 'deposit',
          args: [args.depositToken, args.depositAmount],
        }),
        value: 0n,
      },
    ];
  }
  const deadline = opts.deadline ?? defaultDeadline();
  return [
    ...buildApprovalCalls(
      [
        {
          pool,
          tokenIn: args.token,
          tokenOut: args.targetToken,
          amountIn: args.amount,
          quotedOut: 0n,
          minOut: 0n, // approval-only shim: never encoded as a swap
        },
      ],
      opts,
    ),
    {
      to: pool,
      data: encodeFn({ abi: POOL_ABI, functionName: 'deposit', args: [args.token, args.amount] }),
      value: 0n,
    },
    {
      to: pool,
      data: encodeFn({
        abi: POOL_ABI,
        functionName: 'swapLiability',
        args: [args.token, args.targetToken, args.lpAmountIn, args.minLpAmountOut, deadline],
      }),
      value: 0n,
    },
  ];
}

export interface CrossRedeemArgs {
  /** 'cross': Route A' — [withdrawTo]. Single call, no approvals. */
  mode: 'cross';
  tokenFrom: Address;
  tokenTo: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
}
export interface TransferRedeemArgs {
  /** 'transfer': Route B' — [swapLiability, withdraw]. No approvals. Same anti-JIT caveat as
   *  Route B: the tail withdraw burns just-minted shares, so this runs sequentially after the
   *  cooldown, not atomically. */
  mode: 'transfer';
  tokenFrom: Address;
  tokenTo: Address;
  /** Shares burned by the swapLiability leg (the user's seasoned target-LP). */
  lpAmountIn: bigint;
  minLpAmountOut: bigint;
  /** Estimated target-leg shares the swapLiability mints — burned by the tail withdraw. The
   *  exact number is only known post-execution; pass a conservative floor (≥ minLpAmountOut). */
  lpWithdraw: bigint;
  minAmountOut: bigint;
}

export function buildRedeemCalls(
  pool: Address,
  args: CrossRedeemArgs | TransferRedeemArgs,
  opts: BuildOpts,
): ExecCall[] {
  const deadline = opts.deadline ?? defaultDeadline();
  if (args.mode === 'cross') {
    return [
      {
        to: pool,
        data: encodeFn({
          abi: POOL_ABI,
          functionName: 'withdrawTo',
          args: [args.tokenFrom, args.tokenTo, args.lpAmount, args.minAmountOut, deadline],
        }),
        value: 0n,
      },
    ];
  }
  return [
    {
      to: pool,
      data: encodeFn({
        abi: POOL_ABI,
        functionName: 'swapLiability',
        args: [args.tokenFrom, args.tokenTo, args.lpAmountIn, args.minLpAmountOut, deadline],
      }),
      value: 0n,
    },
    {
      to: pool,
      data: encodeFn({
        abi: POOL_ABI,
        functionName: 'withdraw',
        args: [args.tokenTo, args.lpWithdraw, args.minAmountOut, deadline],
      }),
      value: 0n,
    },
  ];
}

// Dual-route LP mint/redeem ranking + plans (spec §2); builders above turn them into batches.
export * from './lpRoutes.js';
