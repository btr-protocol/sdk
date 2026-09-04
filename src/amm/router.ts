// Off-chain swap router: enumeration is local and quote-free; ranking is backend SSOT.
//
// A route is one intra-pool leg or two legs across pools sharing a token. Enumeration
// (enumerateRoutes) duplicates no pricing law: it only names pool tags and shared tokens.
// Ranking runs over POST /v1/route via routeAsync, depth over POST /v1/depth via
// aggregateDepthAsync. `sdk/router` (planToLegs + buildSwapCalls) turns plans into calldata.

import {
  type DepthBookWire,
  type DepthRequestWire,
  type NamedPoolWire,
  type QuoteRouteWire,
  type RouteRequestWire,
  type RouteResponseWire,
  backendBase,
  depthAsync,
  routeAsync,
} from './aimm.js';
import { type DepthPool, aggregateDepthCurvesAsync } from './depthAgg.js';

export interface NamedPool {
  tag: string;
  addr?: string;
  state: import('./aimm.js').PoolState;
}

export interface RouteLeg {
  poolTag: string;
  poolAddr?: string;
  tokenIn: string;
  tokenOut: string;
}

export interface Route {
  legs: RouteLeg[];
  tokens: string[];
  hops: number;
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
  fills: LegFill[];
  maxIn: number;
}

export interface SplitPart {
  route: Route;
  fraction: number;
  quote: RouteQuote;
}

export interface SwapPlan {
  amountIn: number;
  amountOut: number;
  parts: SplitPart[];
  isSplit: boolean;
}

/** Combined book for (from, to) across every pool that holds the pair, via POST /v1/depth. */

const poolHas = (s: import('./aimm.js').PoolState, token: string): boolean =>
  token === s.base || token in s.legs;

/** All routes for (tokenIn → tokenOut): direct intra-pool + cross-pool 2-hop via a shared token. */
export function enumerateRoutes(pools: NamedPool[], tokenIn: string, tokenOut: string): Route[] {
  if (tokenIn === tokenOut) return [];
  const routes: Route[] = [];

  for (const p of pools) {
    if (poolHas(p.state, tokenIn) && poolHas(p.state, tokenOut)) {
      routes.push({
        legs: [{ poolTag: p.tag, poolAddr: p.addr, tokenIn, tokenOut }],
        tokens: [tokenIn, tokenOut],
        hops: 1,
      });
    }
  }

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

  if (!routes.some((r) => r.hops === 2)) {
    for (const a of pools) {
      if (!poolHas(a.state, tokenIn)) continue;
      for (const b of pools) {
        if (b.tag === a.tag || !poolHas(b.state, tokenOut)) continue;
        for (const m of pools) {
          if (m.tag === a.tag || m.tag === b.tag) continue;
          const xs = sharedTokens(a.state, m.state).filter((t) => t !== tokenIn);
          const ys = sharedTokens(m.state, b.state).filter((t) => t !== tokenOut);
          for (const x of xs) {
            for (const y of ys) {
              if (x === y) continue;
              routes.push({
                legs: [
                  { poolTag: a.tag, poolAddr: a.addr, tokenIn, tokenOut: x },
                  { poolTag: m.tag, poolAddr: m.addr, tokenIn: x, tokenOut: y },
                  { poolTag: b.tag, poolAddr: b.addr, tokenIn: y, tokenOut },
                ],
                tokens: [tokenIn, x, y, tokenOut],
                hops: 3,
              });
            }
          }
        }
      }
    }
  }
  return routes;
}

function sharedTokens(
  a: import('./aimm.js').PoolState,
  b: import('./aimm.js').PoolState,
): string[] {
  const inA = new Set<string>([a.base, ...Object.keys(a.legs)]);
  return [b.base, ...Object.keys(b.legs)].filter((t) => inA.has(t));
}

/** Combined book for (from, to) across every pool that holds the pair, via POST /v1/depth. */
export async function aggregateDepthAsync(
  pools: DepthPool[],
  from: string,
  to: string,
  req: { wires: NamedPoolWire[]; base?: string },
): Promise<DepthBookWire | null> {
  const body: DepthRequestWire = { pools: req.wires, from, to };
  void pools;
  return depthAsync(body, req.base);
}

export type { DepthBookWire, NamedPoolWire, QuoteRouteWire, RouteRequestWire, RouteResponseWire };
export { backendBase, routeAsync };
export { aggregateDepthCurvesAsync };
