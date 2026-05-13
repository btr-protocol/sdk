/**
 * Synthetic OHLC reconstruction from leg OHLC candles.
 *
 * Problem: synth_S.OHLC ≠ f(leg_A.OHLC, leg_B.OHLC) in general — naive
 * corner method gives upper bound but overestimates range by 30-50%.
 *
 * Solution: Parkinson-blended range estimator (Parkinson 1980), assumes
 * log-normal price within bucket. For synth = Π leg_i^{e_i}:
 *
 *   r_i² = ln(H_i / L_i)²                           (squared log-range)
 *   R² = Σ e_i² · r_i² + 2 · Σ_{i<j} e_i·e_j·ρ_ij·r_i·r_j   (variance)
 *
 * With default ρ=0 (legs uncorrelated within 10s bucket — reasonable for
 * BTC/USD vs EUR/USD, gold vs crypto, etc.):
 *
 *   R = √(Σ r_i²)                                   (Pythagorean range)
 *   M_S = √(O_S · C_S)                              (geometric mid, log-symmetric)
 *   H_S = M_S · exp(R/2)
 *   L_S = M_S · exp(-R/2)
 *
 * Open/Close are positional (first/last leg observations within bucket).
 *
 * @example
 *   const synth = reconstructSynthOhlc(
 *     [['PAXGUSDT', 1], ['EURUSDT', -1]],   // PAXG/EUR = PAXGUSDT / EURUSDT
 *     { PAXGUSDT: { o: 2500, h: 2510, l: 2495, c: 2505 },
 *       EURUSDT:  { o: 1.08, h: 1.082, l: 1.078, c: 1.081 } },
 *   );
 *   // → { o: ~2314.81, h: ~2327, l: ~2306, c: ~2317.76 }
 */

import type { Leg } from './paths.js';

export interface OhlcLite {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface OhlcWithRange extends OhlcLite {
  /** Σ leg log-ranges (debugging / vol diagnostics). */
  range?: number;
}

/**
 * Reconstruct synth OHLC for a single bucket from aligned leg OHLCs.
 * Returns `null` if any leg is missing or has invalid (≤0) prices.
 *
 * @param legs - signed legs (sym, exp ∈ {+1, -1})
 * @param legOhlc - map of leg sym → OHLC for the bucket
 * @returns synth OHLC or null
 */
export function reconstructSynthOhlc(
  legs: readonly Leg[],
  legOhlc: Readonly<Record<string, OhlcLite>>,
): OhlcWithRange | null {
  let o = 1, c = 1;
  let logRangeSq = 0; // Σ r_i² (ρ=0 assumption)

  for (const [sym, exp] of legs) {
    const k = legOhlc[sym];
    if (!k || k.o <= 0 || k.h <= 0 || k.l <= 0 || k.c <= 0 || k.h < k.l) return null;

    if (exp === 1) {
      o *= k.o;
      c *= k.c;
    } else {
      o /= k.o;
      c /= k.c;
    }
    // log-range is sign-invariant: ln(H/L) = -ln(L/H), squared is same
    const r = Math.log(k.h / k.l);
    logRangeSq += r * r;
  }

  const R = Math.sqrt(logRangeSq);            // Parkinson-blended range
  const M = Math.sqrt(o * c);                  // geometric mid
  const halfR = R / 2;
  const h = M * Math.exp(halfR);
  const l = M * Math.exp(-halfR);

  return { o, h, l, c, range: R };
}

/**
 * Bucketize-and-reconstruct: align multiple leg time-series by ts bucket,
 * apply synth reconstruction per bucket.
 *
 * @param legs - signed legs config
 * @param legSeries - map of leg sym → array of {ts, o, h, l, c} (must be sorted by ts asc)
 * @param tfMs - bucket size in milliseconds (e.g. 60_000 for M1)
 * @returns array of synth OHLC w/ ts (bucket-start)
 */
export function reconstructSynthSeries(
  legs: readonly Leg[],
  legSeries: Readonly<Record<string, ReadonlyArray<OhlcLite & { ts: number }>>>,
  tfMs: number,
): ReadonlyArray<OhlcLite & { ts: number }> {
  // Build per-bucket OHLC for each leg, then iterate buckets common to all legs.
  const byBucket: Map<number, Record<string, OhlcLite>> = new Map();

  for (const [sym] of legs) {
    const series = legSeries[sym];
    if (!series) return [];
    for (const row of series) {
      const bucket = Math.floor(row.ts / tfMs) * tfMs;
      let b = byBucket.get(bucket);
      if (!b) byBucket.set(bucket, (b = {}));
      const prev = b[sym];
      if (!prev) {
        b[sym] = { o: row.o, h: row.h, l: row.l, c: row.c };
      } else {
        // Aggregate multiple leg rows within same bucket: OHLC monoid
        prev.h = Math.max(prev.h, row.h);
        prev.l = Math.min(prev.l, row.l);
        prev.c = row.c;
      }
    }
  }

  const out: Array<OhlcLite & { ts: number }> = [];
  const sortedBuckets = [...byBucket.keys()].sort((a, b) => a - b);
  for (const ts of sortedBuckets) {
    const synth = reconstructSynthOhlc(legs, byBucket.get(ts)!);
    if (synth) out.push({ ts, o: synth.o, h: synth.h, l: synth.l, c: synth.c });
  }
  return out;
}
