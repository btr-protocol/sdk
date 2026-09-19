import { type AimmProfile, type QuarticCurve, buildCurve, dispersionCap } from './aimm.js';

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
  vega: 10_000,
  protoFeeBps: 2_000,
};

/** Stable: tight curve 2 + tight dispersion (peg book). */
export const STABLE_PROFILE: AimmProfile = {
  ...RISK,
  minFeePbps: 10,
  minDisp: 500,
  curve: BOOTSTRAP_STABLE_CURVE,
};

// Volatile floor DERIVED from the curve, never picked: `sanitizeDispersion` CHECKS
// `minDispersion` against `dispersionCap` (10_862 here); a floor above the cap is a
// pool configuration that cannot exist on chain.
const VOL_CAP = dispersionCap(BOOTSTRAP_VOLATILE_CURVE);
export const VOLATILE_PROFILE: AimmProfile = {
  ...RISK,
  minFeePbps: 1_000,
  minDisp: Math.floor(VOL_CAP / 5),
  curve: BOOTSTRAP_VOLATILE_CURVE,
};

const SIGMA_SEED = { stable: 5_000, volatile: 50_000 } as const;
export const sigmaSeed = (tag: keyof typeof SIGMA_SEED): number => SIGMA_SEED[tag];
