// AIMM — lean: types + pure helpers stay, heavy pricer (aimm.ts 1297L float replica) deprecated.
// Use Rust `btr-quote` via `quoteExactInAsync` / `routeAsync` — bit-exact integer, same as chain.
// Docs: POST https://api.btr.markets/v1/quote  and  POST https://api.btr.markets/v1/route
// Old `quoteExactIn`/`rankSwap` kept for back-compat (will be removed), new code uses async fetch.

export * from './aimm.js';
export * from './depthAgg.js';
export * from './depthRoute.js';
export * from './router.js';

import { btrFetch } from '../api.js';
import type { Route } from './router.js';

import type { PoolAsset } from '../pool/index.js';
import { formatUnits } from '../utils/format.js';
import { type AimmProfile, type PoolState, buildLeg } from './aimm.js';

/** Per-spoke market inputs the chain doesn't serve: NX mark, feed σ (PBPS-scaled), profile, κ. */
export interface LegFeed {
  twap: number; // base-per-token
  sigma: number; // sigma, PBPS-scaled (1e4 = 1%)
  profile: AimmProfile;
  kappaCovBps?: number; // default 0 = wall off
}

const toFloat = (v: bigint, decimals: number): number => Number(formatUnits(v, decimals));

/**
 * Pure conversion: on-chain pool reads (`getPoolData().assets`, bigint) → the pricer's PoolState.
 * `base` = hub symbol (carries no leg; its reserves become every leg's baseRes); spokes without a
 * `feedOf` entry are skipped (no mark ⇒ unquotable).
 */
export function poolStateFrom(
  assets: PoolAsset[],
  base: string,
  feedOf: (symbol: string) => LegFeed | undefined,
): PoolState {
  const baseAsset = assets.find((a) => a.symbol === base);
  const baseRes = baseAsset ? toFloat(baseAsset.reserves, baseAsset.decimals) : 0;
  const legs: PoolState['legs'] = {};
  for (const a of assets) {
    if (a.symbol === base) continue;
    const f = feedOf(a.symbol);
    if (!f) continue;
    legs[a.symbol] = buildLeg(
      a.symbol,
      f.twap,
      f.sigma,
      toFloat(a.reserves, a.decimals),
      toFloat(a.liabilities, a.decimals),
      baseRes,
      a.decimals,
      f.profile,
      f.kappaCovBps ?? 0,
    );
  }
  const hub = baseAsset
    ? {
        res: baseRes,
        liab: toFloat(baseAsset.liabilities, baseAsset.decimals),
        kappaCovBps: feedOf(base)?.kappaCovBps ?? 0,
      }
    : undefined;
  return { base, legs, hub };
}

/** Lean: delegate quoting to Rust btr-quote — POST /v1/quote (integer exact) */
export async function quoteExactInAsync(
  poolState: PoolState,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<{ amountOut: bigint; leg: string }> {
  const res = await btrFetch<{ amountOut: string; leg: string }>('/v1/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ poolState, tokenIn, tokenOut, amountIn: `0x${amountIn.toString(16)}` }),
  });
  return { amountOut: BigInt(res.amountOut), leg: res.leg };
}

/** Lean: delegate routing to Rust — POST /v1/route */
export async function routeAsync(params: {
  pools: PoolState[];
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
}): Promise<Route> {
  return btrFetch<Route>('/v1/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, amountIn: `0x${params.amountIn.toString(16)}` }),
  });
}
