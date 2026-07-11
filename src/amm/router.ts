// Off-chain BTR swap router — the routing brain over the pure-TS pool replica (aimm.ts).
//
// BTR is a set of depth-1-star pools (a stablecoin hub `base` + spokes). A single Pool.swap already
// does the intra-pool hop (spoke→base→spoke), so a route is either ONE intra-pool leg or TWO legs
// across pools that share a token (always the hub in practice). There is NO on-chain router — this
// module decides the best route (with or without a split) purely off-chain; `sdk/router`
// (planToLegs + buildSwapCalls) turns the plan into the approval+swap calldata.
//
// Split math: per-route amountOut(amountIn) is concave (monotone spline impact + inventory skew,
// capped flat at the reserve clip `maxIn`), and the spread floor is a proportional rate (no fixed
// activation cost), so the optimal split equalises marginal output price across active routes. We do
// this with a robust greedy marginal water-fill (assign each slice to the route with the best next
// marginal) — exact-in-the-limit for the concave case and safe across toll/skew kinks — then keep the
// split only if it beats the best single route by more than the gas it costs.

import { type PoolState, type Quote, quoteExactIn } from './aimm';
import { type AggRow, aggregateDepthCurves, niceStep } from './depthAgg.js';

export interface NamedPool {
  tag: string; // pool identity (e.g. 'stable' | 'volatile')
  addr?: string; // on-chain pool address (for the tx builder)
  state: PoolState;
}

export interface RouteLeg {
  poolTag: string;
  poolAddr?: string;
  tokenIn: string;
  tokenOut: string;
}

export interface Route {
  legs: RouteLeg[]; // 1 (intra-pool) or 2 (cross-pool via a shared token)
  tokens: string[]; // [tokenIn, …, tokenOut]
  hops: number; // pool hops (legs.length)
}

export interface LegFill {
  leg: RouteLeg;
  amountIn: number;
  amountOut: number;
}

export interface RouteQuote {
  route: Route;
  amountIn: number;
  amountOut: number;
  fills: LegFill[]; // per-leg amounts (leg2 spends leg1 output)
  maxIn: number; // input that saturates the route's binding reserve clip
}

export interface SplitPart {
  route: Route;
  fraction: number; // share of amountIn on this route
  quote: RouteQuote;
}

export interface SwapPlan {
  amountIn: number;
  amountOut: number; // Σ parts' out
  parts: SplitPart[]; // ≥1; >1 ⇒ genuine split
  isSplit: boolean;
}

export interface RankedSwap {
  best: SwapPlan; // #1 — the optimal plan (may itself be a split)
  singles: RouteQuote[]; // every single route at 100% amountIn, ranked by output desc
}

const poolHas = (s: PoolState, token: string): boolean => token === s.base || token in s.legs;

/** All routes for (tokenIn → tokenOut): direct intra-pool + cross-pool 2-hop via a shared token. */
export function enumerateRoutes(pools: NamedPool[], tokenIn: string, tokenOut: string): Route[] {
  if (tokenIn === tokenOut) return [];
  const routes: Route[] = [];

  // Direct: any pool containing BOTH tokens (Pool.swap does the internal spoke↔base↔spoke hop).
  for (const p of pools) {
    if (poolHas(p.state, tokenIn) && poolHas(p.state, tokenOut)) {
      routes.push({
        legs: [{ poolTag: p.tag, poolAddr: p.addr, tokenIn, tokenOut }],
        tokens: [tokenIn, tokenOut],
        hops: 1,
      });
    }
  }

  // Cross-pool 2-hop: tokenIn in pool A, tokenOut in pool B (A≠B), joined by a token they both hold.
  for (const a of pools) {
    if (!poolHas(a.state, tokenIn)) continue;
    for (const b of pools) {
      if (b.tag === a.tag || !poolHas(b.state, tokenOut)) continue;
      const shared = sharedTokens(a.state, b.state).filter((t) => t !== tokenIn && t !== tokenOut);
      for (const mid of shared) {
        routes.push({
          legs: [
            { poolTag: a.tag, poolAddr: a.addr, tokenIn, tokenOut: mid },
            { poolTag: b.tag, poolAddr: b.addr, tokenIn: mid, tokenOut },
          ],
          tokens: [tokenIn, mid, tokenOut],
          hops: 2,
        });
      }
    }
  }
  return routes;
}

function sharedTokens(a: PoolState, b: PoolState): string[] {
  const inA = new Set<string>([a.base, ...Object.keys(a.legs)]);
  return [b.base, ...Object.keys(b.legs)].filter((t) => inA.has(t));
}

const poolByTag = (pools: NamedPool[], tag: string): NamedPool | undefined =>
  pools.find((p) => p.tag === tag);

/** Quote a full route for `amountIn` (legs sequential; leg2 spends leg1's output). */
export function quoteRoute(pools: NamedPool[], route: Route, amountIn: number): RouteQuote {
  const fills: LegFill[] = [];
  let amt = amountIn;
  let maxIn = Number.POSITIVE_INFINITY;
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const p = poolByTag(pools, leg.poolTag);
    if (!p) return { route, amountIn, amountOut: 0, fills: [], maxIn: 0 };
    const q: Quote = quoteExactIn(p.state, leg.tokenIn, leg.tokenOut, amt);
    // The route's input capacity is set by the FIRST leg's clip (downstream legs see less flow).
    if (i === 0) maxIn = q.maxIn;
    fills.push({ leg, amountIn: amt, amountOut: q.amountOut });
    amt = q.amountOut;
    if (amt <= 0) break;
  }
  return {
    route,
    amountIn,
    amountOut: amt,
    fills,
    maxIn: Number.isFinite(maxIn) ? maxIn : amountIn,
  };
}

export interface SplitOpts {
  slices?: number; // water-fill granularity (default 64)
  minGainBps?: number; // only split if it beats the best single by > this (gas guard; default 5)
  maxRoutes?: number; // cap simultaneously-used routes (default 3)
}

/**
 * Greedy marginal water-fill across `routes`: hand each slice to the route with the best next marginal
 * output. Saturation is detected by the marginal itself going to ~0 (a route past its reserve clip
 * stops producing output), NOT by the quote's `maxIn` estimate — that underestimates the buy-side
 * capacity, so using it as a hard cap under-allocates and makes a split lose to a single pool. If every
 * route saturates before the whole amount is placed, the leftover is simply not routable (partial fill).
 */
function waterFill(
  pools: NamedPool[],
  routes: Route[],
  amountIn: number,
  slices: number,
): number[] {
  const alloc = routes.map(() => 0);
  const curOut = routes.map(() => 0);
  const slice = amountIn / slices;
  const EPS = 1e-12;
  for (let s = 0; s < slices; s++) {
    let bestI = -1;
    let bestMarg = EPS; // a route must add real output to win the slice
    for (let i = 0; i < routes.length; i++) {
      const next = quoteRoute(pools, routes[i], alloc[i] + slice).amountOut;
      const marg = next - curOut[i];
      if (marg > bestMarg) {
        bestMarg = marg;
        bestI = i;
      }
    }
    if (bestI < 0) break; // every route saturated (no positive marginal left)
    alloc[bestI] += slice;
    curOut[bestI] = quoteRoute(pools, routes[bestI], alloc[bestI]).amountOut;
  }
  return alloc;
}

/** Build the ranked result: the optimal plan (single or split) plus every single route ranked. */
export function rankSwap(
  pools: NamedPool[],
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
  opts: SplitOpts = {},
): RankedSwap | null {
  const slices = opts.slices ?? 64;
  const minGainBps = opts.minGainBps ?? 5;
  const maxRoutes = opts.maxRoutes ?? 3;

  const routes = enumerateRoutes(pools, tokenIn, tokenOut);
  if (routes.length === 0) return null;

  // Every route at 100% — the inspection rows, ranked by output.
  const singles = routes
    .map((r) => quoteRoute(pools, r, amountIn))
    .filter((q) => q.amountOut > 0)
    .sort((a, b) => b.amountOut - a.amountOut);
  if (singles.length === 0) return null;

  const bestSingle = singles[0];
  let best: SwapPlan = {
    amountIn,
    amountOut: bestSingle.amountOut,
    parts: [{ route: bestSingle.route, fraction: 1, quote: bestSingle }],
    isSplit: false,
  };

  // Only bother splitting when >1 viable route and a non-trivial size. Candidates must be POOL-DISJOINT:
  // waterFill quotes each route against the pool's UNMUTATED state (quoteRoute is pure — no fill is
  // applied between slices), so two routes sharing a pool would each independently assume they alone
  // can draw its full depth. That double-counts the shared pool's liquidity and inflates the split's
  // summed output past what it can actually deliver — enough to clear `minGainBps` on a plan that then
  // reverts (atomic batch) or short-fills (sequential) once the shared pool's real, single depth is hit.
  // Picking greedily in ranked (best-output-first) order preserves "prefer the best routes" while a
  // shared-pool candidate is simply skipped rather than silently mispriced.
  // ponytail: routes that share a pool can never be split together, even when the underlying pools have
  // ample spare depth — upgrade path is a per-slice cloned/mutated PoolState so overlapping routes see
  // each other's fills and can be priced (and split) correctly instead of being excluded outright.
  const viable: Route[] = [];
  const usedPools = new Set<string>();
  for (const q of singles) {
    if (viable.length >= maxRoutes) break;
    const routePools = q.route.legs.map((l) => l.poolTag);
    if (routePools.some((p) => usedPools.has(p))) continue;
    viable.push(q.route);
    for (const p of routePools) usedPools.add(p);
  }
  if (viable.length > 1 && amountIn > 0) {
    const alloc = waterFill(pools, viable, amountIn, slices);
    const parts: SplitPart[] = [];
    let outSum = 0;
    for (let i = 0; i < viable.length; i++) {
      if (alloc[i] <= 0) continue;
      const q = quoteRoute(pools, viable[i], alloc[i]);
      if (q.amountOut <= 0) continue;
      parts.push({ route: viable[i], fraction: alloc[i] / amountIn, quote: q });
      outSum += q.amountOut;
    }
    // Keep the split only if it beats the best single by more than the gas of the extra leg(s).
    const gain = bestSingle.amountOut > 0 ? (outSum / bestSingle.amountOut - 1) * 1e4 : 0;
    if (parts.length > 1 && gain > minGainBps) {
      best = { amountIn, amountOut: outSum, parts, isSplit: true };
    }
  }

  return { best, singles };
}

// ── Aggregated market depth across all pools (DepthPanel + chart bands) ───────────

export interface AggDepth {
  mid: number; // size-weighted mid across pools
  bids: AggRow[]; // sell-token side, price descending
  asks: AggRow[]; // buy-token side, price ascending
  step: number;
}

/**
 * Combined book for (from, to) across every pool that holds the pair.
 * Densifies each pool Hermite curve onto `step`, then merges same-price buckets (N-pool).
 * Prefer `aggregateDepthCurves` when you need mark/spread/ladder/display denom.
 */
export function aggregateDepth(
  pools: NamedPool[],
  from: string,
  to: string,
  opts?: { step?: number; unit?: 'token' | 'base' },
): AggDepth {
  const book = aggregateDepthCurves(pools, from, to, {
    step: opts?.step,
    unit: opts?.unit ?? 'token',
  });
  if (!book) {
    const mid = 0;
    const step = opts?.step ?? (mid > 0 ? niceStep(mid * 5e-4) : 0);
    return { mid: 0, bids: [], asks: [], step };
  }
  return { mid: book.mid, bids: book.bids, asks: book.asks, step: book.step };
}
