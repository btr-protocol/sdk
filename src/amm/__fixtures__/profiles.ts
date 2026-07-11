// Test profiles + σ seeds — value-identical to front config/aimm-profiles (SSoT:
// dex/evm/deploy/testnet-asset-params.json). Live front reads override via storage slots.

import type { AimmProfile } from '../aimm';

const RISK = {
  gamma: 10_000,
  vega: 10_000,
  lambda: 10_000,
  covMin: 5_000,
  covMax: 20_000,
  depthAmp: 10_000,
  protoShare: 20,
};

/** Stable: center-bump + tight dispersion (peg book). */
export const STABLE_PROFILE: AimmProfile = {
  ...RISK,
  minFee: 10,
  maxFee: 2_000,
  minDisp: 500,
  maxDisp: 5_000,
  weights: [25, 150, 25],
  knots: [-50, -12, 12, 50],
};

/** Volatile: flat Hermite + wider band (minDisp 50_000 → ±2.5% with knots ±50). */
export const VOLATILE_PROFILE: AimmProfile = {
  ...RISK,
  minFee: 1_000,
  maxFee: 10_000,
  minDisp: 50_000,
  maxDisp: 500_000,
  weights: [50, 50, 50, 50],
  knots: [-50, -25, 0, 25, 50],
};

const SIGMA_SEED = { stable: 5_000, volatile: 50_000 } as const;
export const sigmaSeed = (tag: keyof typeof SIGMA_SEED): number => SIGMA_SEED[tag];

/**
 * Flat Hermite + legacy fees/dispersion — exactly the profiles aimm.rs used when emitting
 * `aimm-golden.json`. Do not use for Chapel live quoting (use STABLE_/VOLATILE_PROFILE).
 */
const RUST_SHARED = {
  ...RISK,
  minDisp: 1_000,
  maxDisp: 100_000,
  weights: [50, 50, 50, 50],
  knots: [-50, -25, 0, 25, 50],
};
export const RUST_STABLE_PROFILE: AimmProfile = { ...RUST_SHARED, minFee: 1, maxFee: 2_000 };
export const RUST_VOLATILE_PROFILE: AimmProfile = { ...RUST_SHARED, minFee: 1, maxFee: 10_000 };
