// Off-chain AIMM model: pure f64 pricer (aimm.ts, mirrors dex/sim/src/amm/aimm.rs) + routing
// brain (router.ts) + the on-chain seam below (bigint pool reads → PoolState floats).

export * from './aimm.js';
export * from './depthAgg.js';
export * from './router.js';

import type { PoolAsset } from '../pool/index.js';
import { formatUnits } from '../utils/format.js';
import { type AimmProfile, type PoolState, buildLeg } from './aimm.js';

/** Per-spoke market inputs the chain doesn't serve: NX mark, feed σ (PBPS-scaled), profile, κ. */
export interface LegFeed {
  twap: number; // base-per-token
  sigma: number; // sigmaEma, PBPS-scaled (1e4 = 1%)
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
  return { base, legs };
}
