// Route-composed virtual depth: a book for pairs NO single pool holds (e.g. AUDF -> WBTC via
// USDC.b). aggregateDepthCurves only sees pools holding both tokens, so every routed pair had a
// zero book and the UI fell back to "pool data unavailable" even though rankSwap fills the swap.
//
// Each enumerated route contributes one synthetic DepthCurve: the router's own leg enumeration
// (enumerateRoutes) supplies the paths, and every rung still comes from depthCurve — leg ask
// ladders are chained input->output in the same sequential order quoteRoute fills them (leg 2
// spends leg 1's NET output), with sizes re-denominated into from/to units along the way. The
// composed curves merge mid-outward through the same assembler the direct books use, so chart
// bands, spread zone and DepthPanel consume an identical payload shape. No parallel pricing model.

import {
  type DepthCurve,
  type DepthLevel,
  type PoolState,
  depthCurve,
  invertDepthCurve,
} from './aimm.js';
import {
  type AggregateDepthOpts,
  type AggregatedDepthBook,
  type BookPart,
  type DepthPool,
  aggregateDepthCurves,
  assembleAggBook,
  bookPartFromCurve,
} from './depthAgg.js';
import { type NamedPool, type Route, enumerateRoutes } from './router.js';

/**
 * One side of a composed route as cumulative polylines over the route's INPUT (the token the taker
 * pays or sells): xs ascending inputs, gross/net the gross/net OUTPUT delivered at that input.
 * Net = what actually arrives after each leg's half-spread + coverage toll (the quoteRoute order).
 */
interface ChainPoly {
  xs: number[];
  gross: number[];
  net: number[];
}

/** Linear interp on a monotone polyline; below the first vertex it runs the origin line, past the
 *  last vertex it clamps (a leg's reserve clip is a wall, not an extrapolation). */
function interpAt(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0 || !(x > 0)) return 0;
  if (x <= xs[0]) return (ys[0] * x) / xs[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Inverse of interpAt: the input that delivers cumulative y (ys monotone by construction). */
function invertAt(xs: number[], ys: number[], y: number): number {
  const n = xs.length;
  if (n === 0 || !(y > 0)) return 0;
  if (y <= ys[0]) return (xs[0] * y) / ys[0];
  if (y >= ys[n - 1]) return xs[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= y) lo = mid;
    else hi = mid;
  }
  const t = (y - ys[lo]) / (ys[hi] - ys[lo]);
  return xs[lo] + t * (xs[hi] - xs[lo]);
}

/**
 * "Pay `pay`, receive `recv`" ladder for one pool leg, read off depthCurve's ask band.
 * depthLevelsToRows' conventions hold: sizes stay GROSS, the haircut lives in netPrice. The vertex
 * multiplier m = localPrice / netPrice folds the haircut back onto the output either way the curve
 * was oriented (hub-spoke annotateNet multiplies output; cross pairs divide the exact input).
 */
function askChain(state: PoolState, pay: string, recv: string): ChainPoly | null {
  const raw = depthCurve(state, pay, recv);
  // A hub-spoke depthCurve ladders the SPOKE regardless of argument order (asks buy the spoke with
  // the hub, bids sell it). Paying the spoke into the hub is therefore the BID band, read sold->received.
  const sellingSpoke = recv === state.base && pay !== state.base;
  const levels = sellingSpoke ? raw.bids : raw.asks;
  const xs: number[] = [];
  const gross: number[] = [];
  const net: number[] = [];
  let prevX = 0;
  let prevG = 0;
  let accNet = 0;
  for (const l of levels) {
    const x = sellingSpoke ? l.cumTok : l.cumBase; // pay-token spent (exact)
    const g = sellingSpoke ? l.cumBase : l.cumTok; // recv-token received (gross)
    if (!(x > prevX) || !(g > prevG)) continue; // zero anchor / flat vertex
    // Local slope in the curve's own hub-per-spoke units (what netPrice is quoted in): asks pay
    // hub for spoke (dHub/dSpoke = dx/dg); selling spoke into the hub earns hub (dHub/dSpoke = dg/dx).
    const localPrice = sellingSpoke ? (g - prevG) / (x - prevX) : (x - prevX) / (g - prevG);
    // Haircut multiplier on the OUTPUT: asks divide (netPrice = price/m), bids multiply
    // (netPrice = price*m) — annotateNet's asymmetry, either way net = gross * m.
    const m = sellingSpoke
      ? localPrice > 0
        ? l.netPrice / localPrice
        : 0
      : l.netPrice > 0
        ? localPrice / l.netPrice
        : 0;
    if (!(m > 0)) break; // coverage wall blocks the whole fill from here out
    xs.push(x);
    gross.push(g);
    accNet += (g - prevG) * m;
    net.push(accNet);
    prevX = x;
    prevG = g;
  }
  return xs.length > 0 ? { xs, gross, net } : null;
}

/** Push a chain through the next leg: leg 2 spends leg 1's NET output (quoteRoute fill order).
 *  Grid = own vertices plus the next leg's vertices mapped back through the net inverse, so bends
 *  on either side survive. Capacity = min(own clip, input that saturates the next leg). */
function chainThrough(cur: ChainPoly, outer: ChainPoly): ChainPoly | null {
  // Capacity: own clip, or the input that saturates the outer leg's MAX INPUT (its reserve clip
  // is denominated in what it CONSUMES, so invert that, never its gross output).
  const cap = Math.min(
    cur.xs[cur.xs.length - 1],
    invertAt(cur.xs, cur.net, outer.xs[outer.xs.length - 1]),
  );
  if (!(cap > 0)) return null;
  const grid = new Set<number>();
  for (const x of cur.xs) if (x <= cap) grid.add(x);
  for (const y of outer.xs) {
    const x = invertAt(cur.xs, cur.net, y);
    if (x > 0 && x <= cap) grid.add(x);
  }
  grid.add(cap);
  const seeds = [...grid].sort((a, b) => a - b);
  // Densify between vertices: each leg's curve is only sampled at its own rungs, and a sparse grid
  // flattens the composed marginals onto the interpolating lines (zero span -> no ladder).
  const xs: number[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const steps = i === 0 ? 1 : 8;
    if (i > 0) {
      const lo = seeds[i - 1];
      const hi = seeds[i];
      for (let k = 1; k < steps; k++) xs.push(lo + ((hi - lo) * k) / steps);
    }
    xs.push(seeds[i]);
  }
  const gross: number[] = [];
  const net: number[] = [];
  for (const x of xs) {
    const bridge = interpAt(cur.xs, cur.net, x); // intermediate tokens leg 2 actually receives
    gross.push(interpAt(outer.xs, outer.gross, bridge));
    net.push(interpAt(outer.xs, outer.net, bridge));
  }
  return { xs, gross, net };
}

/** Fold a leg onto a chain. First leg seeds the chain; a missing leg kills that side. */
function foldChain(cur: ChainPoly | null, leg: ChainPoly | null): ChainPoly | null {
  if (!cur) return leg;
  return leg ? chainThrough(cur, leg) : null;
}

/** Zero-size marginal slope (output per input) off the first vertex — the touch anchor. */
const slope0 = (p: ChainPoly | null, key: 'gross' | 'net'): number => {
  if (!p || !(p.xs[0] > 0)) return 0;
  return p[key][0] / p.xs[0];
};

/** Composed polylines -> DepthLevel rows in crossCurve convention: asks carry tokens RECEIVED,
 *  bids tokens SOLD; prices are from-per-to marginals; vertex 0 pinned to the zero-size touch so
 *  the touch definition matches a direct book (an average over the grid is not a price). */
function chainToLevels(
  poly: ChainPoly | null,
  mid: number,
  touch: number,
  side: 'bid' | 'ask',
): DepthLevel[] {
  if (!poly || !(mid > 0)) return [];
  const out: DepthLevel[] = [
    { price: mid, netPrice: touch > 0 ? touch : mid, cumTok: 0, cumBase: 0 },
  ];
  for (let i = 0; i < poly.xs.length; i++) {
    const p =
      i === 0
        ? { x: 0, g: 0, n: 0 }
        : { x: poly.xs[i - 1], g: poly.gross[i - 1], n: poly.net[i - 1] };
    const dX = poly.xs[i] - p.x;
    const dG = poly.gross[i] - p.g;
    const dN = poly.net[i] - p.n;
    const prev = out[out.length - 1];
    out.push(
      side === 'ask'
        ? {
            // pays dX from-token, receives dG gross / dN net to-token
            price: dG > 0 ? dX / dG : prev.price,
            netPrice: dN > 0 ? dX / dN : prev.netPrice,
            cumTok: poly.gross[i],
            cumBase: poly.xs[i],
          }
        : {
            // sells dX to-token (exact), receives dG gross / dN net from-token
            price: dX > 0 ? dG / dX : prev.price,
            netPrice: dX > 0 ? dN / dX : prev.netPrice,
            cumTok: poly.xs[i],
            cumBase: poly.gross[i],
          },
    );
  }
  return out;
}

interface RouteCurve {
  curve: DepthCurve;
}

/** Compose one route's synthetic DepthCurve, quoted from-per-to like aimm's cross pairs. */
function composeRouteCurve(pools: NamedPool[], route: Route): RouteCurve | null {
  const poolByTag = (tag: string) => pools.find((p) => p.tag === tag);

  // Asks fold left-to-right (leg 2 spends leg 1's output); bids fold right-to-left (selling the
  // receive token walks back up the path). A missing link kills that side only.
  let ask: ChainPoly | null = null;
  let bid: ChainPoly | null = null;
  let markRatio = 1; // to-per-from oracle product across legs (route mark = 1/this)
  let askSlope = 1; // to-gross per from, size-0
  let askNetSlope = 1; // to-net per from, size-0
  let bidSlope = 1; // from-gross per to sold, size-0
  let bidNetSlope = 1;
  let spreadMul = 1;

  const fwdChains: (ChainPoly | null)[] = [];
  const revChains: (ChainPoly | null)[] = [];

  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const p = poolByTag(leg.poolTag);
    if (!p || leg.tokenIn === leg.tokenOut) return null;
    const payFwd = leg.tokenIn;
    const recvFwd = leg.tokenOut;

    fwdChains.push(askChain(p.state, payFwd, recvFwd));
    revChains.push(askChain(p.state, recvFwd, payFwd));

    const raw = depthCurve(p.state, payFwd, recvFwd);
    // depthCurve marks are hub-per-spoke (= recv-per-pay when the hub receives, pay-per-recv when
    // the hub pays) and pay-per-recv on crosses; normalize to recv-per-pay and multiply.
    markRatio *= recvFwd === p.state.base ? raw.mark : raw.mark > 0 ? 1 / raw.mark : 0;
    spreadMul *= 1 + raw.spreadBps / 1e4;
  }

  for (const fwd of fwdChains) {
    askSlope *= slope0(fwd, 'gross');
    askNetSlope *= slope0(fwd, 'net');
    ask = foldChain(ask, fwd);
  }
  for (let i = revChains.length - 1; i >= 0; i--) {
    const rev = revChains[i];
    bidSlope *= slope0(rev, 'gross');
    bidNetSlope *= slope0(rev, 'net');
    bid = foldChain(bid, rev);
  }

  const midAsk = askSlope > 0 ? 1 / askSlope : 0; // from-per-to skew mid off the ask side
  const midBid = bidSlope; // already from-per-to
  const mid = midAsk > 0 && midBid > 0 ? (midAsk + midBid) / 2 : Math.max(midAsk, midBid);
  if (!(mid > 0)) return null;
  const mark = markRatio > 0 ? 1 / markRatio : 0;
  if (!(mark > 0) || !Number.isFinite(mark)) return null;

  const asks = chainToLevels(ask, mid, askNetSlope > 0 ? 1 / askNetSlope : 0, 'ask');
  const bids = chainToLevels(bid, mid, bidNetSlope, 'bid');
  if (!asks.length && !bids.length) return null;

  return {
    curve: {
      mark,
      mid,
      spreadBps: (spreadMul - 1) * 1e4,
      bids,
      asks,
      maxTokBid: bids[bids.length - 1]?.cumTok ?? 0,
      maxTokAsk: asks[asks.length - 1]?.cumTok ?? 0,
      unit: 'base',
    },
  };
}

/**
 * Compose a virtual book for (from, to) out of the ROUTER's multi-hop routes. Null when no route
 * carries executable depth. Direct pairs should keep using aggregateDepthCurves.
 */
export function aggregateRouteDepthCurves(
  pools: NamedPool[],
  from: string,
  to: string,
  opts?: AggregateDepthOpts,
): AggregatedDepthBook | null {
  if (from === to) return null;
  const parts: BookPart[] = [];
  // Routes sharing a pool draw the SAME reserves; merging them sums one pool's depth twice (the
  // same double-count rankSwap's split viability refuses). Greedy keep-first in enumeration order.
  const usedPools = new Set<string>();
  for (const route of enumerateRoutes(pools, from, to)) {
    if (route.hops < 2) continue; // direct legs belong to aggregateDepthCurves
    if (route.legs.some((l) => usedPools.has(l.poolTag))) continue;
    const composed = composeRouteCurve(pools, route);
    if (!composed) continue;
    // Honour opts.invert on the ROUTE path too, same as aggregateDepthCurves does per pool: the
    // composed curve is quoted from-per-to (composeRouteCurve doc), so an inverted view pair must
    // reciprocate it BEFORE bucketing - skipping this left cross-pool books in raw from-per-to
    // units (e.g. CBBTC per USD1 ≈ 1e-5) while the panel's display layer assumed the flip.
    const part = bookPartFromCurve(
      opts?.invert ? invertDepthCurve(composed.curve) : composed.curve,
    );
    if (!part) continue;
    parts.push(part);
    for (const l of route.legs) usedPools.add(l.poolTag);
  }
  return assembleAggBook(parts, opts);
}

/**
 * ONE dispatch entrypoint for any pair: direct pools first (byte-identical to today's single-pool
 * books), then the route-composed book. `direct` lets a caller pin its canonical pool set for a
 * direct pair; omit it to aggregate every pool holding both tokens.
 */
export function aggregatePairDepth(
  pools: NamedPool[],
  from: string,
  to: string,
  opts?: AggregateDepthOpts,
  direct?: DepthPool[],
): AggregatedDepthBook | null {
  const directPools = direct ?? pools;
  return (
    aggregateDepthCurves(directPools, from, to, opts) ??
    aggregateRouteDepthCurves(pools, from, to, opts)
  );
}
