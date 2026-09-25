// Swap execution builder: a quoted plan → the ordered calls that execute it.
//
// TWO PATHS, ONE PLAN. The direct path sends the plan as plain `approve` + `Pool.swap` calls from
// the user's own account, batched atomically via EIP-5792 `wallet_sendCalls` where the wallet
// supports it and sequentially where it does not. It is the default for a single-pool route: one
// `Pool.swap`, 37.4k gas under the same swap through `Router` (BSC fork: 224.4k vs 261.8k), and it
// needs no Router on the chain. The on-chain `Router` (bottom of this file) is for a route across
// pools: one transaction, all-or-nothing, one approval per input token, where N direct calls can
// strand the user holding an intermediate asset when a later call reverts.
//
// Neither path SELECTS a route. The backend quoter does that; this module only encodes its answer.
//
// Multicall3 cannot execute the direct path: `Pool.swap` pulls tokenIn from `msg.sender`, which
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
  /** Quoted output in base units — display only; the floor is `minOut`. */
  quotedOut: bigint;
  /** tokenIn is the chain's wrapped native and the user pays the gas token: prepend a wrap. */
  wrapIn?: boolean;
  /** tokenOut is the chain's wrapped native and the user wants the gas token: append an unwrap. */
  unwrapOut?: boolean;
  /** This leg is funded by the PRECEDING leg's output (a cross part's second hop): its `amountIn`
   *  is the previous leg's `minOut`, so a changed floor for the previous leg must re-chain this
   *  one. */
  chained?: boolean;
}

interface ExecCall {
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
  /** The account these calls are sent FROM.
   *
   *  Only the unwrap needs it, and it needs it because the two halves point at different accounts:
   *  the pool (and `Router.swap`) pays the wrapped native to `recipient`, while `WNATIVE.withdraw`
   *  burns from `msg.sender`. With `recipient !== sender` the wrapped output lands with the
   *  recipient and the withdraw either reverts or silently spends the SENDER's own prior balance.
   *  Required whenever a leg unwraps native: with no sender there is nothing to compare `recipient`
   *  against, so the build refuses rather than assume the two are the same account. */
  sender?: Address;
}

const MAX_UINT256 = (1n << 256n) - 1n;

/** Scale an amount by the server's own `tol_pbps`, floor division. The only tolerance the builder
 *  applies to a server-floored plan: it never picks one itself. */
function applyTolPbps(amount: bigint, tolPbps: number): bigint {
  return (amount * (1_000_000n - BigInt(tolPbps))) / 1_000_000n;
}

/**
 * Trust boundary for a server-authored floor. `/v1/chain/*` returns `tol_pbps` and `min_out` derived from
 * the same `SwapQuote` as `amount_out`; the ONE formula, for both spread and relative modes, is
 * `min_out = amount_out·(1e6 − tol_pbps)/1e6` (`back/crates/quote/src/slippage.rs`). This checks
 * it rather than trusting it, and throws instead of quietly lowering the floor.
 *
 * The formula alone is only SELF-consistency: the server authors both sides of it, so a triple
 * like `{X, 999000, X/1000}` — legal all the way to the service's own 99.9% ceiling — passes while
 * leaving no floor at all, and the swap is sandwiched for almost the whole amount. `maxTolPbps` is
 * the caller's own tolerance, the one number in the exchange the server did not write, and it
 * bounds the tolerance the caller will encode.
 */
export function assertServerFloor(
  amountOut: bigint,
  tolPbps: number,
  minOut: bigint,
  maxTolPbps: number,
): void {
  if (!(tolPbps <= maxTolPbps)) {
    throw new Error(`server tol_pbps ${tolPbps} exceeds the requested ${maxTolPbps}`);
  }
  if (minOut > amountOut) {
    throw new Error(`server floor ${minOut} exceeds amount_out ${amountOut}`);
  }
  const expected = applyTolPbps(amountOut, tolPbps);
  const diff = expected > minOut ? expected - minOut : minOut - expected;
  if (diff > 1n) {
    throw new Error(`server floor ${minOut} != amount_out*(1e6-${tolPbps})/1e6 (=${expected})`);
  }
}

export interface TokenMeta {
  address: Address;
  decimals: number;
}

export interface PlanLegOpts {
  slippageFrac: number; // per-leg slippage floor (0.005 = 0.5%)
  tokenOf: (symbol: string) => TokenMeta | undefined; // route symbols → on-chain meta
  /** Is this pool address one the caller is willing to hand tokens to? REQUIRED, and required to
   *  fail closed: a plan naming any pool this rejects produces NO plan at all.
   *
   *  A pool address is not self-authenticating. `PoolFactory.createPool` is owner-gated, but
   *  nothing stops anyone deploying a contract that looks like a BTR pool outside the factory, and
   *  a quote source that names it gets an `approve` and a `swap` from the user's own account. On
   *  the direct path that approval is granted PER POOL, so one rogue address in one part is a
   *  standing allowance against the user's balance (`approveMax` makes it unbounded).
   *
   *  Feed it `PoolFactory.isOfficialPool`, the factory's asserted-official index, or a set
   *  derived from it. `tokenOf` is the same shape and the same contract: the caller owns the
   *  universe, this module only encodes what the caller already trusts. */
  isOfficialPool: (pool: Address) => boolean;
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
  /** Server-authored end-to-end floors from `/v1/chain/quote|route`, keyed by lowercase output token.
   *  Each carries the SAME `amount_out` the floor was derived from, in output base units: the
   *  check is `min_out = amount_out·(1e6 − tol_pbps)/1e6` on the server's own integer, never on
   *  the f64 plan amount, which truncates 18 decimals and would fail (or pass) the wrong check.
   *  When present the builder encodes THAT floor (verified with {@link assertServerFloor}) and
   *  never picks a tolerance itself. The floor is END-TO-END: on the leg path it is allocated
   *  across the parts landing the same token (`planToLegs`), and a two-leg part scales its
   *  intermediate hop; only the delivered token's floor is server-authored. A chained hop 2 is
   *  then funded at `leg1Quoted·(1−tol)` and floored at ≈ `leg2Quoted·(1−tol)`: ZERO margin, so
   *  adverse drift after hop 1 mines reverts `ThresholdViolation`. Route cross parts through
   *  `planToRouterPlan` where the aggregate floor is enforced once. REQUIRED for a chained part:
   *  `planToLegs` returns null rather than author a hop-2 floor of its own (`slippageFrac` floors
   *  direct legs only). */
  serverFloors?: Record<string, { amountOut: bigint; minOut: bigint; tolPbps: number }>;
  /** Ceiling on the server's `tol_pbps`, in pbps, from the CALLER's own slippage policy. REQUIRED
   *  whenever `serverFloors` is set: {@link assertServerFloor} can only prove the floor agrees
   *  with the server's own `amount_out`, and the widest tolerance the service will author (99.9%)
   *  satisfies that check while floring nothing. Supply the user's own maximum. */
  maxTolPbps?: number;
}

/** The caller's tolerance ceiling for a server-authored floor. A plan carrying `serverFloors` and
 *  no ceiling is refused rather than encoded: there would be nothing bounding the floor but the
 *  service that wrote it. */
function serverTolCeiling(caller: string, opts: PlanLegOpts): number {
  if (opts.maxTolPbps === undefined) {
    throw new Error(`${caller}: maxTolPbps is required whenever serverFloors is set`);
  }
  return opts.maxTolPbps;
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
  // >18 decimals used to be silently clamped to 18, which is a 10^(d-18) UNDERSTATEMENT of every
  // amount built from it - an input leg the wallet under-pays and a floor the user never agreed
  // to. Listing already reverts above 18 on chain, so no live token can reach this; refuse it here
  // too rather than encode a number that means something else.
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`toUnits: decimals must be an integer in [0, 18], got ${decimals}`);
  }
  const [mant, exp] = v.toExponential(15).split('e');
  const digits = mant.replace('.', '');
  // toExponential(15) is always one integer digit plus 15 fractional ones.
  const shift = Number(exp) - (digits.length - 1) + decimals;
  const n = BigInt(digits);
  return shift >= 0 ? n * 10n ** BigInt(shift) : n / 10n ** BigInt(-shift);
};

/** Single route-plan pipeline: every plan→calls mapping starts here — largest part first, so the
 *  sequential fallback fills the biggest slice first and residual dust rides on the last part. */
function orderedParts(plan: SwapPlan): SwapPlan['parts'] {
  return [...plan.parts].sort((a, b) => b.fraction - a.fraction);
}

/** One slippage gate for every plan→calls mapping. Unvalidated, slip >= 1 drives every minOut to
 *  0: a batch with no slippage floor at all, which is the one failure mode planning exists to
 *  prevent. NaN does the same. */
function assertSlip(caller: string, slip: number): void {
  if (!Number.isFinite(slip) || slip < 0 || slip >= 1) {
    throw new Error(`${caller}: slippageFrac must be in [0, 1), got ${slip}`);
  }
}

/** Single call pipeline: one encoder per EIP-5792 call shape, shared by the direct N-call path,
 *  the on-chain router path, and the LP batches — identical bytes, one owner. */
function approveCall(token: Address, spender: Address, amount: bigint): ExecCall {
  return {
    to: token,
    data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] }),
    value: 0n,
  };
}

function wrapDepositCall(wnative: Address, value: bigint): ExecCall {
  return { to: wnative, data: encodeFn({ abi: WNATIVE_ABI, functionName: 'deposit' }), value };
}

function unwrapCall(wnative: Address, amount: bigint): ExecCall {
  return {
    to: wnative,
    data: encodeFn({ abi: WNATIVE_ABI, functionName: 'withdraw', args: [amount] }),
    value: 0n,
  };
}

/** Deadline is read at send time, never baked at batch-build time (see buildSwapCalls). */
function swapDeadline(opts: BuildOpts): bigint {
  return opts.deadline ?? defaultDeadline();
}

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
  assertSlip('planToLegs', slip);
  const legs: ExecLeg[] = [];
  const ordered = orderedParts(plan);
  // INPUT-LEG SIZING. `plan.amountIn` is an f64 and the pay leg is what the wallet is debited, so
  // rebuilding it from that float is the one place a rounding step can push the swap ABOVE the
  // balance the caller checked. With `amountInUnits` the slices are carved from THAT bigint: each
  // is floored, the residual dust rides on the smallest (last) part, and Σ === amountInUnits to
  // the wei. Without it the old float path stands, for callers that have no exact total.
  // Carved BEFORE the floors are allocated: a part floored to 0 wei is dropped, as
  // `planToRouterPlan` drops it (a 0-wei `Pool.swap` reverts `ZeroValue`), and the server floor
  // is then spread over the parts that are funded, so Σ leg floors still equals it.
  const carve = inputCarver(plan, ordered.length, opts.amountInUnits);
  const parts: SwapPlan['parts'] = [];
  const partIn: bigint[] = [];
  for (const [i, part] of ordered.entries()) {
    const tin = part.route.legs[0] && opts.tokenOf(part.route.legs[0].tokenIn);
    if (!tin) return null;
    const amountIn = carve(part.fraction, i, tin.decimals);
    if (amountIn <= 0n) continue;
    parts.push(part);
    partIn.push(amountIn);
  }
  if (ordered.length > 0 && parts.length === 0) return null;
  // SERVER FLOORS ARE END-TO-END. `/v1/chain/*` authors ONE `min_out` per output token for the whole plan,
  // and `planToRouterPlan` floors the SUM of the parts landing that token. Encoding that floor on
  // EVERY part — or on a chained hop 2 — asks each slice to deliver the aggregate, so a split the
  // server already accepted reverts `ThresholdViolation`. Allocate it across the parts that deliver
  // the token, proportional to their quoted terminal output with the division residual on the
  // largest: Σ leg floors === the server floor exactly, and no part is floored above its own slice.
  // Verified once, against the aggregate, exactly as the router path does.
  const serverFloorByPart = new Map<number, bigint>();
  const byFloor = new Map<
    NonNullable<PlanLegOpts['serverFloors']>[string],
    { idx: number; q: bigint }[]
  >();
  for (const [i, part] of parts.entries()) {
    const last = part.route.legs.at(-1);
    const out = last && opts.tokenOf(last.tokenOut);
    const server = out && opts.serverFloors?.[out.address.toLowerCase()];
    if (!server) continue;
    byFloor.set(server, [
      ...(byFloor.get(server) ?? []),
      { idx: i, q: toUnits(part.quote.amountOut, out.decimals) },
    ]);
  }
  for (const [server, slices] of byFloor) {
    assertServerFloor(
      server.amountOut,
      server.tolPbps,
      server.minOut,
      serverTolCeiling('planToLegs', opts),
    );
    const total = slices.reduce((s, x) => s + x.q, 0n);
    // Nothing quoted for a floored token: no slice can carry the floor. Fail closed.
    if (total <= 0n) return null;
    const shares = slices.map((x) => (server.minOut * x.q) / total);
    // The division residual (≤ slices.length wei) rides on the LARGEST slice: it has the most
    // headroom, where adding it to a chained slice could floor hop 2 a wei above what hop 1 funds.
    const best = slices.reduce((b, x, k) => (x.q > slices[b].q ? k : b), 0);
    shares[best] += server.minOut - shares.reduce((s, x) => s + x, 0n);
    slices.forEach((x, k) => serverFloorByPart.set(x.idx, shares[k]));
  }
  for (const [i, part] of parts.entries()) {
    const rl = part.route.legs;
    // This builder encodes ONE or TWO legs; the `else` below reads `rl[0]` and `rl[1]` and nothing
    // more. A longer part used to fall into it and be encoded as its first two legs, delivering the
    // INTERMEDIATE token and calling it the swap. That is reachable now that `/route` takes
    // `max_hops` as a request parameter, so it fails closed instead: null is "no plan", which every
    // caller already handles, and `planToRouterPlan` takes any number of hops for callers that have
    // the on-chain Router.
    if (rl.length === 0 || rl.length > 2) return null;
    if (rl.length === 1) {
      const tin = opts.tokenOf(rl[0].tokenIn);
      const tout = opts.tokenOf(rl[0].tokenOut);
      if (!rl[0].poolAddr || !tin || !tout) return null;
      if (!opts.isOfficialPool(rl[0].poolAddr as Address)) return null;
      const quotedOut = toUnits(part.quote.amountOut, tout.decimals);
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: tin.address,
        tokenOut: tout.address,
        amountIn: partIn[i],
        quotedOut,
        minOut: serverFloorByPart.get(i) ?? applySlip(quotedOut, slip),
        wrapIn: opts.nativeIn,
        unwrapOut: opts.nativeOut,
      });
    } else {
      const t1in = opts.tokenOf(rl[0].tokenIn);
      const tmid = opts.tokenOf(rl[0].tokenOut);
      const t2out = opts.tokenOf(rl[1].tokenOut);
      if (!rl[0].poolAddr || !rl[1].poolAddr || !t1in || !tmid || !t2out) return null;
      if (
        !opts.isOfficialPool(rl[0].poolAddr as Address) ||
        !opts.isOfficialPool(rl[1].poolAddr as Address)
      ) {
        return null;
      }
      const leg1Quoted = toUnits(part.quote.fills[0].amountOut, tmid.decimals);
      // A zero first-hop quote cannot fund hop 2: `leg1MinOut` is 0, so hop 2 would be encoded
      // with `amountIn: 0n` and a floor that scales to 0 (`ThresholdViolation`/`ZeroValue`), the
      // whole point of planning being to never emit a leg with no floor. Fail closed.
      if (leg1Quoted <= 0n) return null;
      const server = opts.serverFloors?.[t2out.address.toLowerCase()];
      const leg2MinOut = serverFloorByPart.get(i);
      // A chained part is floored by the SERVER or not at all. The old no-server fallback floored
      // hop 2 at `q2·(1−s)²` (hop 1's floor funds hop 2, then `s` again on top) while the UI
      // promised `q2·(1−s)`: ~2× the tolerance extractable, authored here. The SDK never authors a
      // floor (L-43); fail closed and let the caller fetch `/v1/chain/route`.
      if (!server || leg2MinOut === undefined) return null;
      const leg1MinOut = applyTolPbps(leg1Quoted, server.tolPbps);
      const leg2Quoted = toUnits(part.quote.amountOut, t2out.decimals);
      // LEG 2 IS FUNDED BY LEG 1'S FLOOR, NOT LEG 1'S QUOTE, and floored at this part's allocated
      // slice of the end-to-end server floor (`serverFloorByPart`), never the whole floor.
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: t1in.address,
        tokenOut: tmid.address,
        amountIn: partIn[i],
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
        minOut: leg2MinOut,
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
  opts: Pick<BuildOpts, 'recipient' | 'sender'>,
): { wrapValue: bigint; unwrapAmount: bigint } {
  let wrapValue = 0n;
  let unwrapAmount = 0n;
  let chained = false;
  const outs = new Set<string>();
  for (const leg of legs) {
    // Every swap pays `recipient` but pulls `tokenIn` from `msg.sender`: a leg spending an earlier
    // leg's output is only funded when the two are the same account.
    if (outs.has(leg.tokenIn.toLowerCase())) chained = true;
    outs.add(leg.tokenOut.toLowerCase());
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
  if (unwrapAmount > 0n) {
    assertSelfDirected(opts, 'nativeOut plan (WNATIVE.withdraw burns from msg.sender)');
  }
  if (chained) assertSelfDirected(opts, 'chained plan (the next swap pulls from msg.sender)');
  return { wrapValue, unwrapAmount };
}

/** The swap pays `recipient`; an unwrap burns, and a chained swap pulls, from `msg.sender`. They
 *  must be the same account, so an unknown sender is refused — defaulting `recipient` to it is how
 *  the wrong account gets paid. */
function assertSelfDirected(opts: Pick<BuildOpts, 'recipient' | 'sender'>, plan: string): void {
  if (!opts.sender) {
    throw new Error(`${plan}: sender is required`);
  }
  if (opts.sender.toLowerCase() !== opts.recipient.toLowerCase()) {
    throw new Error(`${plan}: recipient must be the sender`);
  }
}

/** [wrap?, approvals…]: funds and clears allowance for the swap phase. No deadline involved: safe
 *  to build and send well ahead of the swap calls. */
export function buildApprovalCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const wnative = opts.wrappedNative?.toLowerCase();
  const { wrapValue } = validateLegs(legs, wnative, opts);
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
      approvals.push(approveCall(leg.tokenIn, leg.pool, amount));
    }
  }
  const wrap: ExecCall[] =
    wrapValue > 0n ? [wrapDepositCall(opts.wrappedNative as Address, wrapValue)] : [];
  return [...wrap, ...approvals];
}

/** [swaps…, unwrap?]: `opts.deadline ?? defaultDeadline()` is read HERE, at call time: call this
 *  immediately before the send so a deadline built during an earlier approval wait cannot expire it. */
export function buildSwapExecCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const wnative = opts.wrappedNative?.toLowerCase();
  const { unwrapAmount } = validateLegs(legs, wnative, opts);
  const deadline = swapDeadline(opts);
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
    unwrapAmount > 0n ? [unwrapCall(opts.wrappedNative as Address, unwrapAmount)] : [];
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

interface MarketMintArgs {
  /** 'market': Route A, [approve?, swap(X→target)…, deposit(target)]. */
  mode: 'market';
  /** Market legs ending in `depositToken` (planToLegs output). */
  legs: ExecLeg[];
  depositToken: Address;
  /** Deposit size: pass Σ per-part minOut (the guaranteed floor); anything above it stays with
   *  the user as target tokens. Deposits mint at index by design; no price guard exists. */
  depositAmount: bigint;
}
interface TransferMintArgs {
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
  const deadline = swapDeadline(opts);
  // ONE approval total: the LP burn needs no allowance. Built directly — the old path faked an
  // ExecLeg (minOut 0, never encoded as a swap) just to borrow buildApprovalCalls.
  if (isSentinel(args.token) || isSentinel(args.targetToken)) {
    throw new Error('leg carries the native sentinel: pass the wrapped-native address');
  }
  const amount = opts.approveMax ? MAX_UINT256 : args.amount;
  const need = !opts.needsApproval ? true : opts.needsApproval(args.token, pool, amount);
  const approval: ExecCall[] = need ? [approveCall(args.token, pool, amount)] : [];
  return [
    ...approval,
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

interface CrossRedeemArgs {
  /** 'cross': Route A', [withdrawTo]. Single call, no approvals. */
  mode: 'cross';
  tokenFrom: Address;
  tokenTo: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
}
interface TransferRedeemArgs {
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
  const deadline = swapDeadline(opts);
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
  Route,
  LegFill,
  RouteQuote,
  SplitPart,
  SwapPlan,
} from './route.js';
export { poolHas, poolHolding } from './route.js';
export type {
  Row,
  AggRow,
  AggregateDepthOpts,
  AggregatedDepthBook,
} from './depth.js';
export {
  niceStep,
  stepLadder,
  aggregate,
  mergeAgg,
  depthLevelsToRows,
  aggregateDepthCurvesAsync,
  aggregatePairDepthAsync,
} from './depth.js';
export type { LpRouteOpts, RankedLpRoute, RankedLpPlan } from './lpRoutes.js';
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
interface RouterHop {
  pool: Address;
  tokenOut: Address;
}

/** One independent path. Parts do not feed each other, so a call may carry several inputs. */
interface RouterPart {
  tokenIn: Address;
  amountIn: bigint;
  hops: RouterHop[];
}

/** The end-to-end promise, per OUTPUT TOKEN across the whole call. */
interface RouterFloor {
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
  /** msg.value to attach: the gas token wrapped before the swap. 0 unless `nativeIn`. */
  wrapValue: bigint;
  /** `WNATIVE.withdraw` amount after the swap. 0 unless `nativeOut`. Tracks the floor, not the
   *  quote — the floor is the only amount guaranteed to be there, so positive slippage stays with
   *  the user as wrapped native instead of reverting the batch. */
  unwrapAmount: bigint;
  /** Whether the user asked to be paid in the GAS TOKEN.
   *
   *  Carried explicitly because `unwrapAmount > 0n` is not the same question. A server floor can be
   *  zero, and inferring the intent from the amount meant the plan stopped unwrapping from then on:
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
  assertSlip('planToRouterPlan', slip);
  const ordered = orderedParts(plan);
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
      if (!opts.isOfficialPool(leg.poolAddr as Address)) return null;
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

  const floors: RouterFloor[] = [...quoted.values()].map(({ token, amount }) => {
    const server = opts.serverFloors?.[token.toLowerCase()];
    if (server) {
      assertServerFloor(
        server.amountOut,
        server.tolPbps,
        server.minOut,
        serverTolCeiling('planToRouterPlan', opts),
      );
      return { token, minOut: server.minOut };
    }
    return { token, minOut: applySlip(amount, slip) };
  });

  // A gas-token swap is single-asset on that side by definition — the user pays or is paid in the
  // one native token. More than one input (or output) with the flag set means the plan and the
  // flag disagree, and guessing which to believe is how you wrap the wrong amount.
  if (opts.nativeIn && inputs.size !== 1) return null;
  if (opts.nativeOut && floors.length !== 1) return null;

  return {
    parts,
    floors,
    wrapValue: opts.nativeIn ? parts.reduce((a, p) => a + p.amountIn, 0n) : 0n,
    unwrapAmount: opts.nativeOut ? floors.reduce((a, f) => a + f.minOut, 0n) : 0n,
    nativeOut: opts.nativeOut === true,
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
    const wnative = opts.wrappedNative;
    if (!wnative) {
      throw new Error('buildRouterApprovalCalls: nativeIn plan needs opts.wrappedNative');
    }
    calls.push(wrapDepositCall(wnative, rp.wrapValue));
  }
  for (const { token, amount } of totals.values()) {
    // Wrapped native holds no allowance before this batch wraps it, so it always needs one: the
    // caller's cached-allowance probe read a pre-batch state that cannot cover it.
    const wrapped = rp.wrapValue > 0n && token.toLowerCase() === opts.wrappedNative?.toLowerCase();
    if (!wrapped && opts.needsApproval && !opts.needsApproval(token, router, amount)) continue;
    calls.push(approveCall(token, router, opts.approveMax ? MAX_UINT256 : amount));
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
  const deadline = swapDeadline(opts);
  const calls: ExecCall[] = [
    {
      to: router,
      data: encodeFn({
        abi: ROUTER_ABI,
        functionName: 'swap',
        args: [rp.parts, rp.floors, opts.recipient, deadline],
      }),
      value: 0n,
    },
  ];
  if (rp.unwrapAmount > 0n) {
    const wnative = opts.wrappedNative;
    if (!wnative) {
      throw new Error('buildRouterSwapExecCalls: nativeOut plan needs opts.wrappedNative');
    }
    // `Router.swap` pays the wrapped native to `recipient`; this withdraw burns from `msg.sender`.
    assertSelfDirected(opts, 'nativeOut plan (WNATIVE.withdraw burns from msg.sender)');
    calls.push(unwrapCall(wnative, rp.unwrapAmount));
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
