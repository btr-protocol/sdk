/**
 * Synthetic OHLC reconstruction from leg OHLC candles.
 *
 * Problem: synth_S.OHLC ≠ f(leg_A.OHLC, leg_B.OHLC) in general — naive
 * corner method gives upper bound but overestimates range by 30-50%.
 *
 * Solution: range-vol blended estimator for synth = Π leg_i^{e_i}.
 *
 * Per-leg variance estimator (configurable):
 *   - 'parkinson' (1980): v_i = (1/(4 ln 2)) · ln(H_i/L_i)²
 *   - 'rs' (Rogers-Satchell 1991, default — drift-robust):
 *     v_i = ln(H_i/C_i)·ln(H_i/O_i) + ln(L_i/C_i)·ln(L_i/O_i)
 *
 * Quadratic-form variance accumulator:
 *   V = Σ e_i²·v_i + 2·Σ_{i<j} e_i·e_j·ρ_ij·√(v_i·v_j)
 *   V = max(V, 1e-12)
 *
 * Synth OHLC (Parkinson inversion → log-range):
 *   R_S = √(4·ln(2) · V)
 *   M_S = √(O_S · C_S)        (geometric mid, log-symmetric)
 *   H_S = M_S · exp(R_S / 2)
 *   L_S = M_S · exp(-R_S / 2)
 *
 * Open/Close are positional (first/last leg observations within bucket).
 *
 * @example
 *   const synth = reconstructSynthOhlc(
 *     [['PAXGUSDT', 1], ['EURUSDT', -1]],   // PAXG/EUR = PAXGUSDT / EURUSDT
 *     { PAXGUSDT: { o: 2500, h: 2510, l: 2495, c: 2505 },
 *       EURUSDT:  { o: 1.08, h: 1.082, l: 1.078, c: 1.081 } },
 *     { estimator: 'rs' },
 *   );
 */

import type { Leg } from './paths.js';

export interface OhlcLite {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface OhlcWithRange extends OhlcLite {
  /** Synth log-range R_S = √(4·ln(2)·V) (debugging / vol diagnostics). */
  range?: number;
}

export type VarianceEstimator = 'parkinson' | 'rs';

export interface SynthOpts {
  /** Per-leg variance estimator. Default 'rs' (drift-robust). */
  estimator?: VarianceEstimator;
  /**
   * Pairwise correlation lookup: (i, j) → ρ_ij ∈ [-1, 1].
   * Indices refer to position in the `legs` array. Default returns 0 (independent).
   * Symmetry assumed: caller may return same value for (i,j) and (j,i).
   */
  rho?: (legAIndex: number, legBIndex: number) => number;
}

const FOUR_LN2 = 4 * Math.log(2);
const INV_4LN2 = 1 / FOUR_LN2;
const V_FLOOR = 1e-12;

/** Per-leg variance (log-vol²) under the chosen estimator. Returns NaN on invalid input. */
function legVariance(k: OhlcLite, estimator: VarianceEstimator): number {
  if (estimator === 'parkinson') {
    const r = Math.log(k.h / k.l);
    return INV_4LN2 * r * r;
  }
  // Rogers-Satchell (drift-robust): non-negative by construction (H≥O,C and L≤O,C).
  const lhc = Math.log(k.h / k.c);
  const lho = Math.log(k.h / k.o);
  const llc = Math.log(k.l / k.c);
  const llo = Math.log(k.l / k.o);
  return lhc * lho + llc * llo;
}

/**
 * Reconstruct synth OHLC for a single bucket from aligned leg OHLCs.
 * Returns `null` if any leg is missing or has invalid (≤0) prices.
 *
 * @param legs - signed legs (sym, exp ∈ {+1, -1})
 * @param legOhlc - map of leg sym → OHLC for the bucket
 * @param opts - estimator + ρ callback (defaults: 'rs', ρ=0)
 * @returns synth OHLC or null
 */
export function reconstructSynthOhlc(
  legs: readonly Leg[],
  legOhlc: Readonly<Record<string, OhlcLite>>,
  opts: SynthOpts = {},
): OhlcWithRange | null {
  const estimator: VarianceEstimator = opts.estimator ?? 'rs';
  const rho = opts.rho ?? (() => 0);

  const n = legs.length;
  const v = new Array<number>(n);  // per-leg variances v_i
  const e = new Array<number>(n);  // per-leg signed exponents e_i

  let o = 1, c = 1;
  for (let i = 0; i < n; i++) {
    const [sym, exp] = legs[i];
    const k = legOhlc[sym];
    if (!k || k.o <= 0 || k.h <= 0 || k.l <= 0 || k.c <= 0 || k.h < k.l) return null;
    if (exp === 1) { o *= k.o; c *= k.c; } else { o /= k.o; c /= k.c; }
    e[i] = exp;
    const vi = legVariance(k, estimator);
    v[i] = Number.isFinite(vi) && vi >= 0 ? vi : 0;
  }

  // Quadratic-form variance: diag + 2·off-diag·ρ·√(v_i v_j).
  let V = 0;
  for (let i = 0; i < n; i++) V += e[i] * e[i] * v[i];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rij = rho(i, j);
      if (rij === 0) continue;
      V += 2 * e[i] * e[j] * rij * Math.sqrt(v[i] * v[j]);
    }
  }
  if (!(V >= V_FLOOR)) V = V_FLOOR;

  const R = Math.sqrt(FOUR_LN2 * V);          // Parkinson inversion → log-range
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
 * @param opts - estimator + ρ callback
 * @returns array of synth OHLC w/ ts (bucket-start), asc-sorted
 */
export function reconstructSynthSeries(
  legs: readonly Leg[],
  legSeries: Readonly<Record<string, ReadonlyArray<OhlcLite & { ts: number }>>>,
  tfMs: number,
  opts: SynthOpts = {},
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
        // Aggregate multiple leg rows within same bucket: OHLC monoid.
        prev.h = Math.max(prev.h, row.h);
        prev.l = Math.min(prev.l, row.l);
        prev.c = row.c;
      }
    }
  }

  const out: Array<OhlcLite & { ts: number }> = [];
  const sortedBuckets = [...byBucket.keys()].sort((a, b) => a - b);
  for (const ts of sortedBuckets) {
    const synth = reconstructSynthOhlc(legs, byBucket.get(ts)!, opts);
    if (synth) out.push({ ts, o: synth.o, h: synth.h, l: synth.l, c: synth.c });
  }
  return out;
}

/**
 * Canonical "S10 → M1+" reconstruction path: compute synth at the base TF
 * (per-bucket synth from S10 leg OHLCs) then roll up to target TF via the
 * OHLC monoid (first/max/min/last). Counts are summed.
 *
 * This is the BTR-preferred path — capturing intra-bucket variance correctly
 * at S10 (where leg correlation is weakest), then aggregating to user TFs.
 *
 * @param legs - signed legs config
 * @param legSeries - per-leg S10 series (or whatever the base TF is)
 * @param baseTfMs - base bucket size in ms (e.g. 10_000 for S10)
 * @param targetTfMs - target bucket size in ms (≥ baseTfMs; must be multiple)
 * @param opts - estimator + ρ callback
 * @returns rolled-up synth series w/ ts + count, asc-sorted
 */
export function reconstructSynthSeriesAtBaseTfThenRollup(
  legs: readonly Leg[],
  legSeries: Readonly<Record<string, ReadonlyArray<OhlcLite & { ts: number; count?: number }>>>,
  baseTfMs: number,
  targetTfMs: number,
  opts: SynthOpts = {},
): ReadonlyArray<OhlcLite & { ts: number; count: number }> {
  const baseSynth = reconstructSynthSeries(legs, legSeries, baseTfMs, opts);
  if (targetTfMs <= baseTfMs) {
    return baseSynth.map(r => ({ ts: r.ts, o: r.o, h: r.h, l: r.l, c: r.c, count: 1 }));
  }
  const tf = targetTfMs;
  const out: Array<OhlcLite & { ts: number; count: number }> = [];
  let cur: (OhlcLite & { ts: number; count: number }) | null = null;
  for (const r of baseSynth) {
    const bucket = Math.floor(r.ts / tf) * tf;
    if (!cur || cur.ts !== bucket) {
      if (cur) out.push(cur);
      cur = { ts: bucket, o: r.o, h: r.h, l: r.l, c: r.c, count: 1 };
    } else {
      cur.h = Math.max(cur.h, r.h);
      cur.l = Math.min(cur.l, r.l);
      cur.c = r.c;
      cur.count++;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Welford-style online correlation accumulator over a sliding window of size N.
 * State maintained: n, sum(x), sum(y), sum(x²), sum(y²), sum(x·y) + ring buffer.
 *
 * value() → ρ ∈ [-0.99, 0.99] (clamped to avoid singular covariance).
 * Returns 0 when n<2 or variance is effectively 0.
 */
export class RollingCorrelation {
  private readonly N: number;
  private readonly bufX: Float64Array;
  private readonly bufY: Float64Array;
  private idx = 0;
  private filled = 0;
  private sx = 0;
  private sy = 0;
  private sxx = 0;
  private syy = 0;
  private sxy = 0;

  constructor(windowSize: number) {
    if (!(windowSize >= 2)) throw new RangeError('windowSize must be ≥ 2');
    this.N = windowSize | 0;
    this.bufX = new Float64Array(this.N);
    this.bufY = new Float64Array(this.N);
  }

  /** Push paired sample (rA, rB) — typically log-returns. O(1). */
  add(rA: number, rB: number): void {
    if (!Number.isFinite(rA) || !Number.isFinite(rB)) return;
    if (this.filled === this.N) {
      const ox = this.bufX[this.idx];
      const oy = this.bufY[this.idx];
      this.sx -= ox; this.sy -= oy;
      this.sxx -= ox * ox; this.syy -= oy * oy;
      this.sxy -= ox * oy;
    } else {
      this.filled++;
    }
    this.bufX[this.idx] = rA;
    this.bufY[this.idx] = rB;
    this.sx += rA; this.sy += rB;
    this.sxx += rA * rA; this.syy += rB * rB;
    this.sxy += rA * rB;
    this.idx = (this.idx + 1) % this.N;
  }

  /** Current Pearson correlation, clamped to [-0.99, 0.99]. 0 when n<2 or σ≈0. */
  value(): number {
    const n = this.filled;
    if (n < 2) return 0;
    const num = n * this.sxy - this.sx * this.sy;
    const dx = n * this.sxx - this.sx * this.sx;
    const dy = n * this.syy - this.sy * this.sy;
    if (!(dx > 0) || !(dy > 0)) return 0;
    const rho = num / Math.sqrt(dx * dy);
    if (!Number.isFinite(rho)) return 0;
    if (rho > 0.99) return 0.99;
    if (rho < -0.99) return -0.99;
    return rho;
  }

  /** Number of observations currently in window. */
  count(): number { return this.filled; }
}
