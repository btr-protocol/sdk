// Route SHAPES and pool predicates. No enumeration, no ranking, no pricing.
//
// Enumeration lived here too, as a second implementation of
// `btr_core::route::enumerate_routes` — and it had already drifted: this copy only
// reached for a 3-hop route when NO 2-hop join existed, so a longer itinerary that
// paid better was invisible whenever a shorter one happened to exist. It had no
// caller outside its own test. The backend enumerates, prices and ranks every
// itinerary (POST /v1/route via routeAsync in amm/aimm.js; depth over POST
// /v1/depth via depthAsync, consumed through router/depth.js), and this module
// only names the shapes that come back. `router/index.js` (planToLegs,
// planToRouterPlan, buildSwapCalls) turns those plans into calldata. Single home
// for the pool predicates (poolHas, poolHolding) shared by depth + lpRoutes.

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
