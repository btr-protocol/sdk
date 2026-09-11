import type { Asset } from './index.js';

const ASSET_NUMBER_FIELDS = [
  'minDispersionPbps',
  'presetId',
  'minFeePbps',
  'vegaBps',
  'haircutSuppressorBps',
  'decimals',
  'deadSeedPow10',
  'flags',
  'kappaCovBps',
  'maxLiabWeightBps',
] as const satisfies readonly (keyof Asset)[];

/** A decoded `getAsset` tuple, shaped as `Asset` says. The ABI decoder returns EVERY uint as a
 *  bigint, so without this the ≤uint16 fields arrive as bigints behind a `number` type and a
 *  finite-number check refuses every one of them. A field the ABI did not carry (a stale fetched
 *  ABI) becomes NaN, never 0: `Number(undefined)` would be NaN anyway, but `Number(null)` is 0, and
 *  0 is a real value for `kappaCovBps` and `flags`. */
export function toAsset(raw: unknown): Asset {
  const r = raw as Record<string, unknown>;
  const out = {
    reserves: r.reserves,
    liabilities: r.liabilities,
    anchor: r.anchor,
    minLiquidity: r.minLiquidity,
    liquidityIndexWad: r.liquidityIndexWad,
  } as Asset;
  for (const k of ASSET_NUMBER_FIELDS) {
    const v = r[k];
    out[k] = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  }
  return out;
}
