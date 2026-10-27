import { type AimmProfile, type QuarticCurve, buildCurve } from './aimm.js';

const BOOTSTRAP_INTERIOR = [2000, 4000, 6000, 8000];
const rampWQ = (step: bigint): bigint[] =>
  Array.from({ length: 9 }, (_, i) => BigInt(i - 4) * step);
const BOOTSTRAP_VOLATILE_CURVE: QuarticCurve = buildCurve(
  BOOTSTRAP_INTERIOR,
  rampWQ(125_000_000_000n),
  1000,
);
const BOOTSTRAP_STABLE_CURVE: QuarticCurve = buildCurve(
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

// Volatile floor: 2_172 PBPS. It was floor(dispersionCap/5) of the retired interior swing cap; the
// chain now bounds a floor only by `MAX_DISPERSION_PBPS`, so the value stays as a plain number.
export const VOLATILE_PROFILE: AimmProfile = {
  ...RISK,
  minFeePbps: 1_000,
  minDisp: 2_172,
  curve: BOOTSTRAP_VOLATILE_CURVE,
};

const SIGMA_SEED = { stable: 5_000, volatile: 50_000 } as const;
export const sigmaSeed = (tag: keyof typeof SIGMA_SEED): number => SIGMA_SEED[tag];
