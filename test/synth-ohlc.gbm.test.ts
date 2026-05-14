/**
 * GBM Monte-Carlo validation for synth-ohlc estimators.
 *
 * Generates correlated 2-leg GBM paths via Cholesky decomposition, builds OHLC
 * buckets at the base TF, reconstructs the synth bucket and rolls up. Asserts
 * mean_bias(R_S - R_true) / R_true is small across TF ∈ {M1, M5, H1}.
 *
 * Deterministic PRNG (mulberry32) ⇒ stable CI.
 */

import { expect, test } from 'bun:test';
import {
  reconstructSynthSeriesAtBaseTfThenRollup,
  RollingCorrelation,
  type OhlcLite,
} from '../src/types/synth-ohlc';
import type { Leg } from '../src/types/paths';

// ─── PRNG ───────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller via stored spare to halve PRNG calls.
function gauss(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u: number, v: number, s: number;
    do { u = 2 * rng() - 1; v = 2 * rng() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * f;
    return u * f;
  };
}

// ─── Synthetic GBM tick path for two legs w/ given correlation ρ_true ────
function gbmPaths(
  rng: () => number,
  nTicks: number,
  dtSec: number,
  sigA: number,    // ann vol (e.g. 0.6 for 60%)
  sigB: number,
  rhoTrue: number,
  s0a: number,
  s0b: number,
): { a: number[]; b: number[] } {
  const g = gauss(rng);
  const a = new Array<number>(nTicks);
  const b = new Array<number>(nTicks);
  const dt = dtSec / (365 * 24 * 3600); // ann time
  const sqdt = Math.sqrt(dt);
  let sa = s0a, sb = s0b;
  const c = rhoTrue;
  const c2 = Math.sqrt(Math.max(0, 1 - c * c));
  for (let i = 0; i < nTicks; i++) {
    const z1 = g();
    const z2 = g();
    const wa = z1;
    const wb = c * z1 + c2 * z2;
    sa *= Math.exp(-0.5 * sigA * sigA * dt + sigA * sqdt * wa);
    sb *= Math.exp(-0.5 * sigB * sigB * dt + sigB * sqdt * wb);
    a[i] = sa;
    b[i] = sb;
  }
  return { a, b };
}

// Bucketize tick path → OHLC series at baseTfMs. dtSec is the inter-tick spacing.
function toOhlc(
  prices: number[],
  dtSec: number,
  baseTfMs: number,
): Array<OhlcLite & { ts: number }> {
  const baseSec = baseTfMs / 1000;
  const ticksPerBucket = Math.max(1, Math.round(baseSec / dtSec));
  const out: Array<OhlcLite & { ts: number }> = [];
  for (let i = 0; i < prices.length; i += ticksPerBucket) {
    const slice = prices.slice(i, i + ticksPerBucket);
    if (!slice.length) break;
    let h = slice[0], l = slice[0];
    for (const p of slice) { if (p > h) h = p; if (p < l) l = p; }
    out.push({ ts: i * dtSec * 1000, o: slice[0], h, l, c: slice[slice.length - 1] });
  }
  return out;
}

function trueSynthOhlc(
  a: number[],
  b: number[],
  dtSec: number,
  targetTfMs: number,
): Array<OhlcLite & { ts: number }> {
  // True synth path = a / b (e.g. ETH/BTC), bucketize @ target TF directly.
  const ratio = a.map((x, i) => x / b[i]);
  return toOhlc(ratio, dtSec, targetTfMs);
}

function meanLogRangeBias(
  estimated: ReadonlyArray<OhlcLite & { ts: number }>,
  truth: ReadonlyArray<OhlcLite & { ts: number }>,
): number {
  // Align by ts; compute (R_est - R_true) / R_true mean.
  const tMap = new Map(truth.map(r => [r.ts, r]));
  let sum = 0, n = 0;
  for (const e of estimated) {
    const t = tMap.get(e.ts);
    if (!t) continue;
    const rt = Math.log(t.h / t.l);
    const re = Math.log(e.h / e.l);
    if (!(rt > 0) || !Number.isFinite(re)) continue;
    sum += (re - rt) / rt;
    n++;
  }
  return n > 0 ? sum / n : NaN;
}

// ─── Tests ──────────────────────────────────────────────────────────────

const LEGS: readonly Leg[] = [['A', 1], ['B', -1]] as const;
const BASE_TF_MS = 10_000;        // S10
const DT_SEC = 1;                  // 1 tick / s
const TF_CASES = [
  { name: 'M1', ms: 60_000 },
  { name: 'M5', ms: 300_000 },
  { name: 'H1', ms: 3_600_000 },
];

test('RollingCorrelation tracks Pearson ρ on synthetic correlated data', () => {
  const rng = mulberry32(42);
  const g = gauss(rng);
  const rc = new RollingCorrelation(500);
  const rhoTrue = 0.6;
  const c2 = Math.sqrt(1 - rhoTrue * rhoTrue);
  for (let i = 0; i < 500; i++) {
    const z1 = g();
    const z2 = g();
    rc.add(z1, rhoTrue * z1 + c2 * z2);
  }
  const est = rc.value();
  expect(Math.abs(est - rhoTrue)).toBeLessThan(0.1);
});

test('GBM Monte Carlo: RS-ρ mean range bias < 3% across M1/M5/H1', () => {
  const N_TRIALS = 200;
  const TICKS = 4000; // ~67 min @ 1s tick spacing → enough for H1 (60 min) buckets to populate
  const rhoTrue = 0.5;
  const sigA = 0.6;
  const sigB = 0.5;

  for (const tf of TF_CASES) {
    let sumBias = 0;
    let n = 0;
    for (let trial = 0; trial < N_TRIALS; trial++) {
      const rng = mulberry32(0xBEEF + trial);
      const { a, b } = gbmPaths(rng, TICKS, DT_SEC, sigA, sigB, rhoTrue, 100, 50);

      const aOhlc = toOhlc(a, DT_SEC, BASE_TF_MS);
      const bOhlc = toOhlc(b, DT_SEC, BASE_TF_MS);

      const est = reconstructSynthSeriesAtBaseTfThenRollup(
        LEGS,
        { A: aOhlc, B: bOhlc },
        BASE_TF_MS,
        tf.ms,
        { estimator: 'rs', rho: () => rhoTrue },
      );
      const truth = trueSynthOhlc(a, b, DT_SEC, tf.ms);
      const bias = meanLogRangeBias(est, truth);
      if (Number.isFinite(bias)) { sumBias += bias; n++; }
    }
    const meanBias = sumBias / Math.max(1, n);
    // |mean_bias| < 3% — Parkinson inversion under-/over-estimates partial-path range
    // by a small amount; RS w/ correct ρ should center near 0.
    expect(Math.abs(meanBias)).toBeLessThan(0.03);
  }
});

test('GBM Monte Carlo: ρ=0 fallback bias bounded < 20% (uncorrelated assumption)', () => {
  // Sanity: even w/o correlation, bias should not be unbounded.
  const N_TRIALS = 50;
  const TICKS = 2000;
  const rhoTrue = 0.5;
  for (const tf of [{ name: 'M1', ms: 60_000 }]) {
    let sumAbs = 0; let n = 0;
    for (let trial = 0; trial < N_TRIALS; trial++) {
      const rng = mulberry32(0x1234 + trial);
      const { a, b } = gbmPaths(rng, TICKS, DT_SEC, 0.6, 0.5, rhoTrue, 100, 50);
      const aOhlc = toOhlc(a, DT_SEC, BASE_TF_MS);
      const bOhlc = toOhlc(b, DT_SEC, BASE_TF_MS);
      const est = reconstructSynthSeriesAtBaseTfThenRollup(
        LEGS, { A: aOhlc, B: bOhlc }, BASE_TF_MS, tf.ms,
        { estimator: 'rs' /* default ρ=0 */ },
      );
      const truth = trueSynthOhlc(a, b, DT_SEC, tf.ms);
      const bias = meanLogRangeBias(est, truth);
      if (Number.isFinite(bias)) { sumAbs += Math.abs(bias); n++; }
    }
    expect(sumAbs / Math.max(1, n)).toBeLessThan(0.2);
  }
});
