// Canonical route enumeration: quote-free, backend SSOT for ranking.
//
// A route is one intra-pool leg or two legs across pools sharing a token.
// Enumeration names pool tags and shared tokens only (no pricing law); ranking
// runs over POST /v1/route via routeAsync (aimm.js), depth over POST /v1/depth
// via depth.js. `router/index.js` (planToLegs + buildSwapCalls) turns plans
// into EIP-5792 calldata. Single home for pool predicates (poolHas,
// poolHolding) shared by depth + lpRoutes.

import type { PoolState } from '../amm/aimm.js';

export interface NamedPool {
  tag: string;
  addr?: string;
  state: PoolState;
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

/** True when the pool holds the token as base or spoke. */
export const poolHas = (s: PoolState, token: string): boolean =>
  token === s.base || token in s.legs;

/** First pool holding both tokens, if any. */
export function poolHolding(pools: NamedPool[], a: string, b: string): NamedPool | undefined {
  return pools.find((p) => poolHas(p.state, a) && poolHas(p.state, b));
}

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

function sharedTokens(a: PoolState, b: PoolState): string[] {
  const inA = new Set<string>([a.base, ...Object.keys(a.legs)]);
  return [b.base, ...Object.keys(b.legs)].filter((t) => inA.has(t));
}
