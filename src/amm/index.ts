// AIMM: types + pure helpers. The float replica in aimm.ts is the off-chain approximation;
// the integer-exact answer comes from Rust `btr-quote` over `POST /v1/quote` and `POST /v1/route`.
//
// This module used to export `quoteExactInAsync` and `routeAsync` as thin wrappers over those
// two endpoints. Both were removed: they had no callers anywhere, and neither had ever worked.
// They serialised camelCase (`tokenIn`, `amountIn`) against a service that requires snake_case,
// so every call 400'd on `missing field \`token_in\``; and their `pools`/`poolState` payload was
// the SDK's own `PoolState` shape, which is not the `NamedPoolWire` the endpoint accepts. Fixing
// them meant writing a full PoolState -> wire mapper that already exists, correctly, in
// `front/src/lib/quoteApi.ts`. A second, broken copy of it in the SDK is worse than none.

export * from './aimm.js';
export * from './depthAgg.js';
export * from './depthRoute.js';
export * from './router.js';

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
