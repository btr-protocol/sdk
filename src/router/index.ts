// Swap execution builder: a quoted plan → the ordered calls that execute it.
//
// TWO PATHS, ONE PLAN. Preferred is the on-chain `Router` (bottom of this file): one transaction,
// all-or-nothing, one approval per input token. The legacy path sends the same plan as N plain
// `approve` + `Pool.swap` calls from the user's own account, batched atomically via EIP-5792
// `wallet_sendCalls` where the wallet supports it and sequentially where it does not — which is
// why it still exists, and why a multi-hop route on it can strand the user holding an intermediate
// asset when a later call reverts.
//
// Neither path SELECTS a route. The backend quoter does that; this module only encodes its answer.
//
// Multicall3 cannot execute the legacy path: `Pool.swap` pulls tokenIn from `msg.sender`, which
// under `Multicall3.aggregate3` is the Multicall3 contract (no funds, no allowance) → revert. The
// calls must originate from the user account. `Router` is not subject to this: it holds the pull
// itself, which is the point of deploying it.
import { POOL_ABI } from '../abis/Pool.js';
import { ROUTER_ABI } from '../abis/Router.js';
import { encodeFn } from '../eth/abi.js';
import type { Abi } from '../eth/abi.js';
import { ERC20_ABI } from '../eth/erc20.js';
import type { Address, Hex } from '../eth/types.js';
import { defaultDeadline } from '../pool/index.js';
import { applySlip } from '../utils/maths.js';
import type { SwapPlan } from './route.js';
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
   *  exact Σ amountIn for that (token, pool): standard exact-amount approve + swap. */
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

/** Carve the caller's EXACT input across the plan's parts, in the order given.
 *
 *  Shared by BOTH execution paths (N pool calls, and one router call) so they cannot disagree
 *  about what the wallet is debited for the same plan. Each part is floored and the residual dust
 *  rides on the last one, so Σ === `amountInUnits` to the wei.
 *
 *  Without an exact total the old float path stands: `plan.amountIn` is an f64 and cannot hold 18
 *  decimals, so a max-balance swap rebuilt from it lands ONE WEI above the balance the caller
 *  checked and `transferFrom` reverts. Pass `amountInUnits` whenever it is known. */
function inputCarver(
  plan: SwapPlan,
  nParts: number,
  amountInUnits?: bigint,
): (fraction: number, i: number, decimals: number) => bigint {
  const exactIn = amountInUnits !== undefined && amountInUnits > 0n ? amountInUnits : undefined;
  const FRAC_SCALE = 1_000_000_000_000n; // 1e12: fraction precision, well inside f64's 15 digits
  let leftIn = exactIn ?? 0n;
  return (fraction: number, i: number, decimals: number): bigint => {
    if (exactIn === undefined) return toUnits(fraction * plan.amountIn, decimals);
    if (i === nParts - 1) {
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
}

/** Map a router plan (router/route `best`) → ExecLeg[], largest part first (so the
 *  sequential fallback fills the biggest slice first). Direct part = 1 leg; cross part = 2 legs
 *  where leg2.amountIn = leg1.minOut (the exact bridged amount isn't known until leg1 executes).
 *  `nativeIn`/`nativeOut` flag the outer legs so the batch wraps/unwraps around them.
 *  Null when any pool address or token meta is missing. */
export function planToLegs(plan: SwapPlan, opts: PlanLegOpts): ExecLeg[] | null {
  const slip = opts.slippageFrac;
  // Unvalidated, slip >= 1 drives every minOut to 0: a batch with no slippage floor at all,
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
  const partInUnits = inputCarver(plan, parts.length, opts.amountInUnits);
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
 *  No EIP-2612 / Permit2: plain ERC-20 `approve` only.
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

/** [wrap?, approvals…]: funds and clears allowance for the swap phase. No deadline involved: safe
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

/** [swaps…, unwrap?]: `opts.deadline ?? defaultDeadline()` is read HERE, at call time: call this
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
 *  shared deadline for the whole thing: correct for a single atomic batch (one wallet prompt), but
 *  see `buildApprovalCalls`/`buildSwapExecCalls` for a non-atomic, multi-tx flow. */
export function buildSwapCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  return [...buildApprovalCalls(legs, opts), ...buildSwapExecCalls(legs, opts)];
}

/** Σ msg.value across the calls (native-in legs): the total to attach to a batched send. */
export function totalValue(calls: ExecCall[]): bigint {
  return calls.reduce((a, c) => a + c.value, 0n);
}

// ── LP dual-route batches (spec §2.3/§2.4) ──────────────────────────────────────
//
// The LP routes compose the SAME primitives as a swap: plain calls from the user's account, one
// shared deadline per atomic batch, no on-chain router. Approval logic is REUSED
// (buildApprovalCalls), never duplicated.

export interface MarketMintArgs {
  /** 'market': Route A, [approve?, swap(X→target)…, deposit(target)]. */
  mode: 'market';
  /** Market legs ending in `depositToken` (planToLegs output). */
  legs: ExecLeg[];
  depositToken: Address;
  /** Deposit size: pass Σ per-part minOut (the guaranteed floor); anything above it stays with
   *  the user as target tokens. Deposits mint at index by design; no price guard exists. */
  depositAmount: bigint;
}
export interface TransferMintArgs {
  /** 'transfer': Route B, [approve?, deposit(X), swapLiability]. ONE approval total: the LP burn
   *  needs no allowance. Non-batchable for fresh deposits (anti-JIT); see lpRoutes gating. */
  mode: 'transfer';
  token: Address; // X: deposited, then its liability swapped in the same batch
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
  /** 'cross': Route A', [withdrawTo]. Single call, no approvals. */
  mode: 'cross';
  tokenFrom: Address;
  tokenTo: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
}
export interface TransferRedeemArgs {
  /** 'transfer': Route B', [swapLiability, withdraw]. No approvals. Same anti-JIT caveat as
   *  Route B: the tail withdraw burns just-minted shares, so this runs sequentially after the
   *  cooldown, not atomically. */
  mode: 'transfer';
  tokenFrom: Address;
  tokenTo: Address;
  /** Shares burned by the swapLiability leg (the user's seasoned target-LP). */
  lpAmountIn: bigint;
  minLpAmountOut: bigint;
  /** Estimated target-leg shares the swapLiability mints: burned by the tail withdraw. The
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
export type {
  NamedPool,
  RouteLeg,
  Route,
  LegFill,
  RouteQuote,
  SplitPart,
  SwapPlan,
} from './route.js';
export { poolHas, poolHolding, enumerateRoutes } from './route.js';
export type {
  Row,
  AggRow,
  DepthPool,
  AggregateDepthOpts,
  AggregatedDepthBook,
  BookPart,
  PairDepthOpts,
} from './depth.js';
export {
  niceStep,
  stepLadder,
  aggregate,
  mergeAgg,
  depthLevelsToRows,
  bookPartFromCurve,
  assembleAggBook,
  aggregateDepthCurves,
  aggregateRouteDepthCurves,
  aggregatePairDepth,
  fetchDepthBook,
  aggregateDepthAsync,
  aggregateDepthCurvesAsync,
  aggregatePairDepthAsync,
} from './depth.js';
export type { LpRouteOpts, LpRouteStep, RankedLpRoute, RankedLpPlan } from './lpRoutes.js';
export { hexToF64, toRawHex, wirePlanToSwap, rankDeposit, rankRedeem } from './lpRoutes.js';

// ─────────────────────────────────────────────────────────────────────────────
// ON-CHAIN ROUTER
//
// The same plan, executed as ONE transaction by the `Router` contract instead of N calls from the
// wallet. Route SELECTION is unchanged — it happens in the backend quoter, and the router only
// executes what it is handed.
//
// The reason to prefer this path is not gas, it is atomicity: sent as N calls, hop 2 can revert
// after hop 1 has mined and the user is left holding an intermediate asset they never asked for.
// One transaction is all-or-nothing.
//
// THIS BUILDS FROM THE PLAN, NOT FROM `ExecLeg[]`. Going through `planToLegs` first would flatten
// the backend's parts into legs, attach a per-leg `minOut` to each, and then this code would
// regroup the legs back into the parts the backend already sent and throw those floors away —
// re-deriving, in TypeScript, a split the Rust quoter had already decided. It also capped routes
// at the two hops `planToLegs` hardcodes, while the contract takes any number. Mapping the plan
// straight across is both shorter and strictly more capable.
//
// WHAT IS NOT THE BACKEND'S TO DECIDE: the floors. `minOut` is a structural trust boundary — a
// server-authored floor is a sandwich the server can write — so the caller derives it here, from
// the quote it was shown and the slippage tolerance the user set. See `core/src/lib.rs:14`.
// ─────────────────────────────────────────────────────────────────────────────

/** One hop. `tokenIn` is implicit — the part's input first, the previous hop's output after. */
export interface RouterHop {
  pool: Address;
  tokenOut: Address;
}

/** One independent path. Parts do not feed each other, so a call may carry several inputs. */
export interface RouterPart {
  tokenIn: Address;
  amountIn: bigint;
  hops: RouterHop[];
}

/** The end-to-end promise, per OUTPUT TOKEN across the whole call. */
export interface RouterFloor {
  token: Address;
  minOut: bigint;
}

export interface RouterPlan {
  /** `Router.swap` arg 1, in plan order (largest part first). */
  parts: RouterPart[];
  /** `Router.swap` arg 2. One entry per distinct output token, never per part.
   *
   *  EXACTLY the contract's struct, nothing more: this array is handed straight to the encoder, so
   *  an extra field here rides into the calldata layout. Anything else the caller needs about a
   *  floor lives beside it, not in it. */
  floors: RouterFloor[];
  /** The pre-slippage output each floor was derived from, keyed by lowercased token address.
   *
   *  Kept so a re-floor can hold the floor to `min(quoted, fresh)` — the user must never be
   *  promised MORE than the quote they were shown, however well the market has moved since — and
   *  so the fall can be reported against the number that was actually on screen. */
  quotedOut: Readonly<Record<string, bigint>>;
  /** msg.value to attach: the gas token wrapped before the swap. 0 unless `nativeIn`. */
  wrapValue: bigint;
  /** `WNATIVE.withdraw` amount after the swap. 0 unless `nativeOut`. Tracks the floor, not the
   *  quote — the floor is the only amount guaranteed to be there, so positive slippage stays with
   *  the user as wrapped native instead of reverting the batch. */
  unwrapAmount: bigint;
  /** Whether the user asked to be paid in the GAS TOKEN.
   *
   *  Carried explicitly because `unwrapAmount > 0n` is not the same question. A re-floor can drive
   *  a floor to zero, and inferring the intent from the amount meant the plan stopped unwrapping
   *  from then on — a later re-floor back up produced a real floor with no withdraw beside it, and
   *  the user was silently paid in wrapped native. */
  nativeOut: boolean;
}

/**
 * Map a quoted `SwapPlan` → the exact arguments `Router.swap` takes.
 *
 * Parts are ordered largest-first, matching `planToLegs`, because both paths carve the caller's
 * exact input with the same `inputCarver` and the residual dust rides on the last part.
 *
 * FLOORS ARE PER OUTPUT TOKEN, AGGREGATED ACROSS THE WHOLE CALL — not per part. A split that lands
 * the same asset twice is floored on the TOTAL: floored per part it would refuse a fill that is
 * fine in aggregate, one path coming in light and the other more than covering it. And they are
 * end-to-end, on what the user actually asked for, so a route does not compound a tolerance per
 * hop and reject itself on a market that has not moved.
 *
 * Null (never a partial plan) when any pool address or token meta is missing, when a plan claims a
 * native leg it cannot support, or when a token resolves to the EIP-7528 sentinel — that address
 * is not a contract, and `transferFrom` against it would revert with nothing to explain why.
 */
export function planToRouterPlan(plan: SwapPlan, opts: PlanLegOpts): RouterPlan | null {
  const slip = opts.slippageFrac;
  if (!Number.isFinite(slip) || slip < 0 || slip >= 1) {
    throw new Error(`planToRouterPlan: slippageFrac must be in [0, 1), got ${slip}`);
  }
  const ordered = [...plan.parts].sort((a, b) => b.fraction - a.fraction);
  if (ordered.length === 0) return null;
  const carve = inputCarver(plan, ordered.length, opts.amountInUnits);

  const parts: RouterPart[] = [];
  // Quoted terminal output per token, pre-slippage, keyed lowercase so a split landing the same
  // asset from two paths accumulates onto one floor.
  const quoted = new Map<string, { token: Address; amount: bigint }>();
  const inputs = new Set<string>();

  for (const [i, part] of ordered.entries()) {
    const legs = part.route.legs;
    if (legs.length === 0) return null;
    const tin = opts.tokenOf(legs[0].tokenIn);
    if (!tin || isSentinel(tin.address)) return null;

    const hops: RouterHop[] = [];
    let terminal: TokenMeta | undefined;
    for (const [h, leg] of legs.entries()) {
      // The contract takes `tokenIn` as implicit — the previous hop's output — so a route whose
      // legs do not actually join would be re-chained here into a pair the pool never listed, and
      // the mismatch would surface on chain as an opaque pool revert instead of here.
      if (h > 0 && leg.tokenIn !== legs[h - 1].tokenOut) return null;
      const tout = opts.tokenOf(leg.tokenOut);
      if (!leg.poolAddr || !tout || isSentinel(tout.address)) return null;
      hops.push({ pool: leg.poolAddr as Address, tokenOut: tout.address });
      terminal = tout;
    }
    if (!terminal) return null;

    const amountIn = carve(part.fraction, i, tin.decimals);
    // A part can be carved down to nothing — `inputCarver` floors every non-last slice, so a tiny
    // input split across several routes leaves the small ones empty. Sending it costs a wallet
    // prompt to reach a guaranteed `ZeroValue` revert in the pool, and flooring its quoted output
    // would promise the user a delivery that no part is funded to make.
    if (amountIn <= 0n) continue;

    parts.push({ tokenIn: tin.address, amountIn, hops });
    inputs.add(tin.address.toLowerCase());
    const key = terminal.address.toLowerCase();
    const cur = quoted.get(key);
    quoted.set(key, {
      token: terminal.address,
      amount: (cur?.amount ?? 0n) + toUnits(part.quote.amountOut, terminal.decimals),
    });
  }
  if (parts.length === 0) return null;

  const floors: RouterFloor[] = [...quoted.values()].map(({ token, amount }) => ({
    token,
    minOut: applySlip(amount, slip),
  }));

  // A gas-token swap is single-asset on that side by definition — the user pays or is paid in the
  // one native token. More than one input (or output) with the flag set means the plan and the
  // flag disagree, and guessing which to believe is how you wrap the wrong amount.
  if (opts.nativeIn && inputs.size !== 1) return null;
  if (opts.nativeOut && floors.length !== 1) return null;

  return {
    parts,
    floors,
    quotedOut: Object.fromEntries([...quoted.entries()].map(([k, v]) => [k, v.amount])),
    wrapValue: opts.nativeIn ? parts.reduce((a, p) => a + p.amountIn, 0n) : 0n,
    unwrapAmount: opts.nativeOut ? floors.reduce((a, f) => a + f.minOut, 0n) : 0n,
    nativeOut: opts.nativeOut === true,
  };
}

/** Re-floor a built plan against a FRESH quote, without re-deriving the route.
 *
 *  The quote a user was shown ages between render and send. Rebuilding the whole plan to move the
 *  floors would re-run the split against whatever the pools look like now and could hand the wallet
 *  a different route than the one on screen; this moves only the numbers the tolerance controls.
 *
 *  `freshOut` is quoted (pre-slippage) output per token, keyed lowercase. A token the fresh quote
 *  does not mention keeps its existing floor. */
export function refloorRouterPlan(
  rp: RouterPlan,
  freshOut: Map<string, bigint>,
  slippageFrac: number,
): RouterPlan {
  if (!Number.isFinite(slippageFrac) || slippageFrac < 0 || slippageFrac >= 1) {
    throw new Error(`refloorRouterPlan: slippageFrac must be in [0, 1), got ${slippageFrac}`);
  }
  const floors = rp.floors.map((f) => {
    const key = f.token.toLowerCase();
    const fresh = freshOut.get(key);
    if (fresh === undefined) return f;
    // `min`, never the fresh number alone. A market that moved in the user's FAVOUR would
    // otherwise raise the floor above the quote they agreed to, turning a better fill into a
    // revert; and the floor must still never exceed what the pool can pay right now.
    const quoted = rp.quotedOut[key];
    const base = quoted !== undefined && quoted < fresh ? quoted : fresh;
    return { token: f.token, minOut: applySlip(base, slippageFrac) };
  });
  return {
    ...rp,
    floors,
    // Keyed on the INTENT, not on the current amount. Guarding this on `unwrapAmount > 0n` meant a
    // re-floor to zero permanently disabled the unwrap, and the next re-floor back up paid the
    // user in wrapped native with no withdraw at all.
    unwrapAmount: rp.nativeOut ? floors.reduce((a, f) => a + f.minOut, 0n) : 0n,
  };
}

/** [wrap?, approvals…] for the router path.
 *
 *  ONE approval per INPUT TOKEN, to the router — not one per (token, pool), which is the whole UX
 *  win: a 3-hop route through three pools is one approval, not three. An allowance granted to a
 *  pool does nothing here. */
export function buildRouterApprovalCalls(
  router: Address,
  rp: RouterPlan,
  opts: Pick<BuildOpts, 'needsApproval' | 'approveMax' | 'wrappedNative'>,
): ExecCall[] {
  const totals = new Map<string, { token: Address; amount: bigint }>();
  for (const part of rp.parts) {
    const key = part.tokenIn.toLowerCase();
    const cur = totals.get(key);
    totals.set(key, { token: part.tokenIn, amount: (cur?.amount ?? 0n) + part.amountIn });
  }
  const calls: ExecCall[] = [];
  if (rp.wrapValue > 0n) {
    if (!opts.wrappedNative) {
      throw new Error('buildRouterApprovalCalls: nativeIn plan needs opts.wrappedNative');
    }
    calls.push({
      to: opts.wrappedNative,
      data: encodeFn({ abi: WNATIVE_ABI, functionName: 'deposit' }),
      value: rp.wrapValue,
    });
  }
  for (const { token, amount } of totals.values()) {
    // Wrapped native holds no allowance before this batch wraps it, so it always needs one: the
    // caller's cached-allowance probe read a pre-batch state that cannot cover it.
    const wrapped = rp.wrapValue > 0n && token.toLowerCase() === opts.wrappedNative?.toLowerCase();
    if (!wrapped && opts.needsApproval && !opts.needsApproval(token, router, amount)) continue;
    calls.push({
      to: token,
      data: encodeFn({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [router, opts.approveMax ? MAX_UINT256 : amount],
      }),
      value: 0n,
    });
  }
  return calls;
}

/** [Router.swap, unwrap?].
 *
 *  `opts.deadline ?? defaultDeadline()` is read HERE, at call time. Call this immediately before
 *  the send: a deadline built while an approval was still mining can already be spent. */
export function buildRouterSwapExecCalls(
  router: Address,
  rp: RouterPlan,
  opts: BuildOpts,
): ExecCall[] {
  if (rp.parts.length === 0) throw new Error('buildRouterSwapExecCalls: empty plan');
  const calls: ExecCall[] = [
    {
      to: router,
      data: encodeFn({
        abi: ROUTER_ABI,
        functionName: 'swap',
        args: [rp.parts, rp.floors, opts.recipient, opts.deadline ?? defaultDeadline()],
      }),
      value: 0n,
    },
  ];
  if (rp.unwrapAmount > 0n) {
    if (!opts.wrappedNative) {
      throw new Error('buildRouterSwapExecCalls: nativeOut plan needs opts.wrappedNative');
    }
    calls.push({
      to: opts.wrappedNative,
      data: encodeFn({ abi: WNATIVE_ABI, functionName: 'withdraw', args: [rp.unwrapAmount] }),
      value: 0n,
    });
  }
  return calls;
}

/** Wrap first (funds the approval), approve before the swap that spends it, unwrap last.
 *
 *  One shared deadline, which is correct for a single atomic batch — one wallet prompt, sent
 *  together. A non-atomic flow that mines the approval as its own transaction should call
 *  `buildRouterApprovalCalls` and `buildRouterSwapExecCalls` separately, the second one right
 *  before the send. */
export function buildRouterCalls(router: Address, rp: RouterPlan, opts: BuildOpts): ExecCall[] {
  return [
    ...buildRouterApprovalCalls(router, rp, opts),
    ...buildRouterSwapExecCalls(router, rp, opts),
  ];
}
