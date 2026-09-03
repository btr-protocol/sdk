// AIMM adapter surface: types + backend fetchers. Quotes route over POST /v1/quote|route,
// depth over POST /v1/depth (btr-quote, btr-core SSOT). The f64 replica is deleted.

export * from './aimm.js';
export * from './depthAgg.js';
export * from './depthRoute.js';
export * from './router.js';

import type { PoolAsset } from '../pool/index.js';
import { formatUnits } from '../utils/format.js';
import { type AimmProfile, type PoolState, buildLeg } from './aimm.js';

export interface LegFeed {
  twap: number;
  sigma: number;
  profile: AimmProfile;
  kappaCovBps?: number;
}

const toFloat = (v: bigint, decimals: number): number => Number(formatUnits(v, decimals));

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
