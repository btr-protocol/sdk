// Test profiles + σ seeds + the portable preset-curve table.
//
// Curve SSoT (machine): dex/research/stable-core/out/spline_shared_grid.json — quartic I-spline
// fits per (regime, wall-width W). That artifact is gitignored, so the tracked input here is
// `spline_grid.json`, its portable-preset slice (see grid.ts; regen + parity check documented
// there). Only `portable: true` fits are exported (the deployability
// whitelist, same rule as export_parity_vectors.ts). wQ quantization matches the exporter:
// round(w_pbps · 1e9), interior knots rounded to strictly-increasing ints.
//
// presetId convention (SDK fixture table; on-chain ids are pool-operator-chosen):
//   presetId = 100·tier + regimeOrdinal, tier ∈ {1: W0.5, 2: W1, 3: W2, 4: W5},
//   regimeOrdinal = 1-based index in [hyper, flat, plateau, meso, lepto, platy, skew_L, skew_R,
//   pin_M, pin_M_tight, pin_M_med, pin_M_wide]. 0 stays reserved (= no curve / fallback quote).
// dispRef convention: 200·W pbps (2× the fit's edge offset ±100·W pbps) — same ratio the
// bootstrap curves below use (edge 500 → dispRef 1000, edge 50 → dispRef 100).

import { type AimmProfile, type QuarticCurve, buildCurve, dispersionCap } from '../aimm';
import type { SplineGrid } from './grid';
import GRID_SLICE from './spline_grid.json';

const grid = GRID_SLICE as SplineGrid;

const TIERS: Record<string, number> = { W0_5: 1, W1: 2, W2: 3, W5: 4 };
const REGIME_ORDER = [...grid.regimes, ...grid.pinVariants];

export interface CurvePreset {
  presetId: number;
  regime: string;
  /** Wall half-width in bp (edge offset = ±100·W pbps). */
  W: number;
  interior: number[];
  wQ: bigint[];
  dispRef: number;
}

/** Same quantization as export_parity_vectors.ts (integer knots, strictly increasing). */
function quantInterior(xs: number[]): number[] {
  const interior = xs.map((x) => Math.round(x));
  for (let i = 1; i < interior.length; i++) {
    if (interior[i] <= interior[i - 1]) interior[i] = interior[i - 1] + 1;
  }
  return interior;
}

/** Portable (regime, W) → curve params, presetId per the convention above. */
export const CURVE_PRESETS: CurvePreset[] = Object.entries(grid.walls).flatMap(
  ([wallKey, wall]) => {
    const interior = quantInterior(wall.shared.interiorX);
    const dispRef = Math.round(200 * wall.W);
    return REGIME_ORDER.filter((r) => wall.presets[r]?.portable).map((regime) => ({
      presetId: 100 * TIERS[wallKey] + REGIME_ORDER.indexOf(regime) + 1,
      regime,
      W: wall.W,
      interior,
      wQ: wall.presets[regime].w.map((v) => BigInt(Math.round(v * 1e9))),
      dispRef,
    }));
  },
);

/** Build the decoded on-chain curve object for a preset. */
export const presetCurve = (p: CurvePreset): QuarticCurve =>
  buildCurve(p.interior, p.wQ, p.dispRef);

export const findPreset = (regime: string, W: number): CurvePreset | undefined =>
  CURVE_PRESETS.find((p) => p.regime === regime && p.W === W);

// ── Bootstrap curves (deploy-script seed presets) ──────────────────────────────
// Preset 1 = generic default (±500 pbps ramp, dispRef 1000); preset 2 = tight stable
// (±50 pbps ramp, dispRef 100). Live front reads override via storage slots (readCurve).

const BOOTSTRAP_INTERIOR = [2000, 4000, 6000, 8000];
const rampWQ = (step: bigint): bigint[] =>
  Array.from({ length: 9 }, (_, i) => BigInt(i - 4) * step);
export const BOOTSTRAP_VOLATILE_CURVE: QuarticCurve = buildCurve(
  BOOTSTRAP_INTERIOR,
  rampWQ(125_000_000_000n),
  1000,
);
export const BOOTSTRAP_STABLE_CURVE: QuarticCurve = buildCurve(
  BOOTSTRAP_INTERIOR,
  rampWQ(12_500_000_000n),
  100,
);

const RISK = {
  gamma: 10_000,
  vega: 10_000,
  lambda: 10_000,
  covMin: 5_000,
  covMax: 20_000,
  protoShare: 20,
};

/** Stable: tight preset-2 curve + tight dispersion (peg book). */
export const STABLE_PROFILE: AimmProfile = {
  ...RISK,
  minFee: 10,
  maxFee: 2_000,
  minDisp: 500,
  maxDisp: 5_000,
  curve: BOOTSTRAP_STABLE_CURVE,
};

// Volatile: generic preset-1 curve at the WIDEST band the preset actually admits. The ceiling is
// the curve's own `Pricing.dispersionCap` (floor(SWING_CAP·dispRef·Q / span) = 10_000 here), which
// `PoolAdmin.sanitizeDispersion` BINDS the band to at the write — so it is derived, never picked.
// The old 50_000/500_000 pair reverted `BadConfig` on install: every test that used it validated a
// pool configuration that cannot exist on chain. Effective edge = (span/2)·disp/(dispRef·Q):
// ±0.1% at the floor, ±0.5% at the cap (= INTERIOR_SWING_CAP_PBPS/2, by construction).
const VOL_CAP = dispersionCap(BOOTSTRAP_VOLATILE_CURVE);
export const VOLATILE_PROFILE: AimmProfile = {
  ...RISK,
  minFee: 1_000,
  maxFee: 10_000,
  minDisp: VOL_CAP / 5,
  maxDisp: VOL_CAP,
  curve: BOOTSTRAP_VOLATILE_CURVE,
};

const SIGMA_SEED = { stable: 5_000, volatile: 50_000 } as const;
export const sigmaSeed = (tag: keyof typeof SIGMA_SEED): number => SIGMA_SEED[tag];
