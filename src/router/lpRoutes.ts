// Dual-route LP mint/redeem ranking (sdk/docs/lp-routing-spec.md §2).
//
// Every pool entry composes into one of two terminating instruments, and the routes are directly
// comparable because both end in the SAME receipt:
//   mint   X -> target-LP : Route A  market-first  [rankSwap legs, Pool.deposit]
//                          Route B  deposit-first [Pool.deposit, Pool.swapLiability]
//   redeem T-LP -> Y      : Route A' cross-exit     [Pool.withdrawTo]
//                          Route B' transfer-exit  [Pool.swapLiability, Pool.withdraw]
//
// Comparison key is DIRECT (spec §2.2): maximize target-LP face (mint) / token-out units
// (redeem). Face/mark normalization is presentation-only; both routes here terminate in the same
// pool's receipts so shared terms cancel. Both routes are quoted through the SAME mirrors — the
// contract-derived haircut pipeline (pool/liability.ts) and aimm.quoteExactIn — never mixed
// f64/bignum. Tiebreak: fewer legs (gas).
//
// Season gating (§2.5): any route whose first step BURNS leg-LP (B, A', B') is gated on
// pre-existing seasoned shares — maxRedeem >= burned — because a same-timestamp mint arms the
// anti-JIT lock and an atomic batch would revert. A gated route is RETURNED with
// feasible: false, reason: 'cooldown', never picked, so callers surface "available after
// cooldown" instead of quoting a reverting batch.

import { quoteExactIn } from '../amm/aimm.js';
import { type NamedPool, type SwapPlan, rankSwap } from '../amm/router.js';
import { type LiabLeg, WAD, haircutFace, quoteSwapLiabilityCore } from '../pool/liability.js';

export interface LpRouteOpts {
  /** Per-leg slippage floor fraction (default 0.005). Market legs get minOut floors; liability
   *  legs get minLpAmountOut on received shares; deposits get NONE (they mint at index). */
  slippageFrac?: number;
  /** Liability-transfer flag gate per symbol (LIABILITY_SWAP_ENABLED_BIT). Default: enabled. */
  liabilityEnabled?: (symbol: string) => boolean;
  /** Unlocked-share capacity per symbol (maxRedeem mirror), in FACE units. Routes that burn a
   *  leg's LP are gated on this. Default: unlimited (caller has no lock machinery). */
  maxRedeem?: (symbol: string) => number;
  /** haircutSuppressorBps per symbol (default 0 — full haircut applies). */
  haircutSuppressorBps?: (symbol: string) => number;
}

const DEFAULT_SLIP = 0.005;

/** The leg book swapLiability reads, lifted from a router PoolState (+ per-symbol suppressor). */
function liabLeg(pool: NamedPool, symbol: string, opts: LpRouteOpts): LiabLeg | null {
  const s = pool.state;
  const suppressor = opts.haircutSuppressorBps?.(symbol) ?? 0;
  if (symbol === s.base) {
    if (!s.hub) return null;
    return {
      symbol,
      reserves: s.hub.res,
      liabilities: s.hub.liab,
      haircutSuppressorBps: suppressor,
      indexWad: WAD,
    };
  }
  const leg = s.legs[symbol];
  if (!leg) return null;
  return {
    symbol,
    reserves: leg.res,
    liabilities: leg.liab,
    haircutSuppressorBps: suppressor,
    indexWad: WAD,
  };
}

function poolHolding(pools: NamedPool[], a: string, b: string): NamedPool | undefined {
  const has = (p: NamedPool, t: string) => t === p.state.base || t in p.state.legs;
  return pools.find((p) => has(p, a) && has(p, b));
}

/** One composed step. LP-side amounts are FACE units (shares · idx/WAD, idx normalized to 1). */
export interface LpRouteStep {
  kind: 'swap' | 'deposit' | 'withdraw' | 'withdrawTo' | 'swapLiability';
  poolTag: string;
  poolAddr?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  /** Quoted output (net, post everything the mirror charges). */
  amountOut: number;
  /** Slippage floor carried into the calldata (minOut / minLpAmountOut). 0 = no price guard
   *  (deposits mint at index by design — spec §4). */
  minOut: number;
}

export interface RankedLpRoute {
  /** A market-first (mint) · B deposit-first (mint) · A' cross-exit · B' transfer-exit. */
  id: 'market-first' | 'deposit-first' | 'cross-exit' | 'transfer-exit';
  label: string;
  feasible: boolean;
  /** Why the route is gated off: 'cooldown' | 'flag-disabled' | 'capacity' | 'no-route'. */
  reason?: string;
  /** COMPARISON METRIC: target-LP face for mints, token-out units for redeems. */
  out: number;
  hops: number;
  steps: LpRouteStep[];
}

export interface RankedLpPlan {
  /** Highest-output FEASIBLE route (ties → fewer legs). Null when every route is gated off. */
  best: RankedLpRoute | null;
  /** All enumerated routes, ranked by output desc (losing routes included for the compare view). */
  routes: RankedLpRoute[];
}

// ── helpers ─────────────────────────────────────────────────────────────────────

type RouteShell = Omit<RankedLpRoute, 'feasible' | 'reason'> & { steps: LpRouteStep[] };

const seasonGate = (
  route: RouteShell,
  burnedSymbol: string,
  burnedFace: number,
  opts: LpRouteOpts,
): RankedLpRoute => {
  const capacity = opts.maxRedeem?.(burnedSymbol);
  if (capacity !== undefined && capacity < burnedFace) {
    return { ...route, feasible: false, reason: 'cooldown' };
  }
  return { ...route, feasible: true };
};

const flagGate = (
  route: RouteShell,
  symbols: string[],
  opts: LpRouteOpts,
): RankedLpRoute | null => {
  if (!symbols.every((s) => opts.liabilityEnabled?.(s) ?? true)) {
    return { ...route, feasible: false, reason: 'flag-disabled' };
  }
  return null;
};

/** Rank: output desc, then fewer legs (gas), then stable input order. */
const rankRoutes = (routes: RankedLpRoute[]): RankedLpRoute[] =>
  [...routes].sort((a, b) => b.out - a.out || a.hops - b.hops || 0);

// ── mint: X -> target-LP ────────────────────────────────────────────────────────

function marketMint(
  pools: NamedPool[],
  xToken: string,
  targetSym: string,
  amountIn: number,
  opts: LpRouteOpts,
): RankedLpRoute | null {
  const slip = opts.slippageFrac ?? DEFAULT_SLIP;
  const ranked = rankSwap(pools, xToken, targetSym, amountIn);
  if (!ranked) return null;
  const plan: SwapPlan = ranked.best;

  const steps: LpRouteStep[] = [];
  let placed = 0;
  let depositExpected = 0;
  for (const part of plan.parts) {
    placed += part.fraction * amountIn;
    part.quote.fills.forEach((fill, i) => {
      const isFinal = i === part.quote.fills.length - 1;
      steps.push({
        kind: 'swap',
        poolTag: fill.leg.poolTag,
        poolAddr: fill.leg.poolAddr,
        tokenIn: fill.leg.tokenIn,
        tokenOut: fill.leg.tokenOut,
        amountIn: fill.amountIn,
        amountOut: fill.amountOut,
        minOut: fill.amountOut * (1 - slip),
      });
      if (isFinal) depositExpected += fill.amountOut;
    });
  }
  // Water-fill left part of the input unroutable, or a part runs past its binding reserve clip
  // (single-route plans are never split, so `placed` alone cannot see saturation): the plan
  // would revert on-chain or silently drop input.
  const overClip = plan.parts.some((part) => part.quote.amountIn > part.quote.maxIn * 1.001);
  if (placed < amountIn * 0.999 || overClip) {
    return {
      id: 'market-first',
      label: 'market swap, then deposit',
      out: plan.amountOut,
      hops: steps.length + 1,
      steps,
      feasible: false,
      reason: 'capacity',
    };
  }
  // Deposits carry NO price guard (mint at current index); the amount sent is the guaranteed
  // floor Σ per-part minOut — anything above stays with the user as target tokens (usable
  // holdings, spec §2.4).
  const first = steps[0];
  steps.push({
    kind: 'deposit',
    poolTag: first?.poolTag ?? '',
    poolAddr: first?.poolAddr,
    tokenIn: targetSym,
    tokenOut: targetSym,
    amountIn: steps.reduce((a, s) => a + s.minOut, 0),
    amountOut: depositExpected,
    minOut: 0,
  });

  return {
    id: 'market-first',
    label: 'market swap, then deposit',
    out: plan.amountOut, // target tokens → face at the current index
    hops: steps.length,
    steps,
    feasible: true,
  };
}

function transferMint(
  pools: NamedPool[],
  xToken: string,
  targetSym: string,
  amountIn: number,
  opts: LpRouteOpts,
): RankedLpRoute | null {
  const slip = opts.slippageFrac ?? DEFAULT_SLIP;
  const holder = poolHolding(pools, xToken, targetSym);
  if (!holder) return null;
  const inLeg = liabLeg(holder, xToken, opts);
  const outLeg = liabLeg(holder, targetSym, opts);
  if (!inLeg || !outLeg) return null;

  const shell: RouteShell = {
    id: 'deposit-first',
    label: 'deposit, then transfer liability',
    out: 0,
    hops: 2,
    steps: [
      {
        kind: 'deposit',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: xToken,
        tokenOut: xToken,
        amountIn,
        amountOut: amountIn,
        minOut: 0,
      },
      {
        kind: 'swapLiability',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: xToken,
        tokenOut: targetSym,
        amountIn,
        amountOut: 0,
        minOut: 0,
      },
    ],
  };
  const flagged = flagGate(shell, [xToken, targetSym], opts);
  if (flagged) return flagged;
  // The deposit mints fresh X-LP the very same batch would burn: gated on seasoned X-LP (§2.5).
  const gated = seasonGate(shell, xToken, amountIn, opts);
  if (!gated.feasible) return gated;

  // Index-normalized: the deposit mints face == amountIn of X-LP.
  const q = quoteSwapLiabilityCore(inLeg, outLeg, amountIn, (fair) =>
    quoteExactIn(holder.state, xToken, targetSym, fair),
  );
  if (!q) return { ...shell, feasible: false, reason: 'no-route', out: 0 };
  shell.steps[1].amountOut = q.lpAmountOut;
  shell.steps[1].minOut = q.lpAmountOut * (1 - slip);
  return { ...shell, out: q.lpAmountOut, feasible: true };
}

/** Mint amountIn of xToken, ending in targetSym LP. Both symbols live in ONE pool (spec §2.1:
 *  single-pool scope; cross-pool is out of scope v1). Returns every enumerated route ranked. */
export function rankDeposit(
  pools: NamedPool[],
  xToken: string,
  targetSym: string,
  amountIn: number,
  opts: LpRouteOpts = {},
): RankedLpPlan {
  if (!(amountIn > 0)) return { best: null, routes: [] };
  const market = marketMint(pools, xToken, targetSym, amountIn, opts);
  const transfer = transferMint(pools, xToken, targetSym, amountIn, opts);
  const routes = rankRoutes([market, transfer].filter((r): r is RankedLpRoute => r !== null));
  return { best: routes.find((r) => r.feasible) ?? null, routes };
}

// ── redeem: target-LP -> Y ──────────────────────────────────────────────────────

function crossExit(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts,
): RankedLpRoute | null {
  const slip = opts.slippageFrac ?? DEFAULT_SLIP;
  const holder = poolHolding(pools, targetSym, outToken);
  if (!holder) return null;
  const fromLeg = liabLeg(holder, targetSym, opts);
  const toLeg = liabLeg(holder, outToken, opts);
  if (!fromLeg || !toLeg) return null;

  // Mirror of _quoteWithdrawCross (PoolLiquidity.sol:335-369): from-haircut → anchor-path
  // conversion (fees embedded) → Lemma B mark cap → out-haircut. Reserve sufficiency and the
  // liquid floor stay on-chain; the gate below mirrors maxRedeem's fold.
  const { actual: fair } = haircutFace(
    lpFaceIn,
    fromLeg.reserves,
    fromLeg.liabilities,
    fromLeg.haircutSuppressorBps,
  );
  const q = quoteExactIn(holder.state, targetSym, outToken, fair);
  const markCap = fair * q.markPrice;
  const conv = q.amountOut > markCap ? markCap : q.amountOut;
  const { actual: out } = haircutFace(
    conv,
    toLeg.reserves,
    toLeg.liabilities,
    toLeg.haircutSuppressorBps,
  );

  const shell: RouteShell = {
    id: 'cross-exit',
    label: 'cross withdraw (one call)',
    out,
    hops: 1,
    steps: [
      {
        kind: 'withdrawTo',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: targetSym,
        tokenOut: outToken,
        amountIn: lpFaceIn,
        amountOut: out,
        minOut: out * (1 - slip),
      },
    ],
  };
  // Burns target-LP like every exit: capacity + season folded (maxRedeem mirror).
  return seasonGate(shell, targetSym, lpFaceIn, opts);
}

function transferExit(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts,
): RankedLpRoute | null {
  const slip = opts.slippageFrac ?? DEFAULT_SLIP;
  const holder = poolHolding(pools, targetSym, outToken);
  if (!holder) return null;
  const fromLeg = liabLeg(holder, targetSym, opts);
  const toLeg = liabLeg(holder, outToken, opts);
  if (!fromLeg || !toLeg) return null;

  const shell: RouteShell = {
    id: 'transfer-exit',
    label: 'transfer liability, then same-asset exit',
    out: 0,
    hops: 2,
    steps: [
      {
        kind: 'swapLiability',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: targetSym,
        tokenOut: outToken,
        amountIn: lpFaceIn,
        amountOut: 0,
        minOut: 0,
      },
      {
        kind: 'withdraw',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: outToken,
        tokenOut: outToken,
        amountIn: 0,
        amountOut: 0,
        minOut: 0,
      },
    ],
  };
  const flagged = flagGate(shell, [targetSym, outToken], opts);
  if (flagged) return flagged;
  // Burn of the source LP is lock-gated, and the minted Y-LP is born frozen — this route needs
  // seasoned target shares, and its tail cannot clear inside one atomic batch either way:
  // sequential execution after the cooldown is the only path (spec §2.5).
  const gated = seasonGate(shell, targetSym, lpFaceIn, opts);
  if (!gated.feasible) return gated;

  const q = quoteSwapLiabilityCore(fromLeg, toLeg, lpFaceIn, (fair) =>
    quoteExactIn(holder.state, targetSym, outToken, fair),
  );
  if (!q) return { ...shell, feasible: false, reason: 'no-route', out: 0 };

  // Same-asset exit of the received Y face: haircut only, no spread/proto fee (spec §2.1 B').
  const { actual: exitOut } = haircutFace(
    q.liabOut,
    toLeg.reserves,
    toLeg.liabilities,
    toLeg.haircutSuppressorBps,
  );
  shell.steps[0].amountOut = q.lpAmountOut;
  shell.steps[0].minOut = q.lpAmountOut * (1 - slip);
  shell.steps[1].amountIn = q.lpAmountOut;
  shell.steps[1].amountOut = exitOut;
  shell.steps[1].minOut = exitOut * (1 - slip);
  return { ...shell, out: exitOut, feasible: true };
}

/** Redeem lpFaceIn (FACE units: shares · idx/WAD) of targetSym LP, ending in outToken tokens. */
export function rankRedeem(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts = {},
): RankedLpPlan {
  if (!(lpFaceIn > 0)) return { best: null, routes: [] };
  const cross = crossExit(pools, targetSym, outToken, lpFaceIn, opts);
  const transfer = transferExit(pools, targetSym, outToken, lpFaceIn, opts);
  const routes = rankRoutes([cross, transfer].filter((r): r is RankedLpRoute => r !== null));
  return { best: routes.find((r) => r.feasible) ?? null, routes };
}
