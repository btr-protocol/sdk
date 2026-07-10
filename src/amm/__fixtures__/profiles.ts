// Test profiles + σ seeds — value-identical to front config/aimm-profiles (SSoT:
// dex/evm/deploy/testnet-asset-params.json); the golden vectors were emitted against these.

import type { AimmProfile } from '../aimm';

const SHARED = {
  gamma: 10_000,
  vega: 10_000,
  lambda: 10_000,
  minDisp: 1_000,
  maxDisp: 100_000,
  covMin: 5_000,
  covMax: 20_000,
  depthAmp: 10_000,
  protoShare: 20,
  weights: [50, 50, 50, 50],
  knots: [-50, -25, 0, 25, 50],
};

export const STABLE_PROFILE: AimmProfile = { ...SHARED, minFee: 1, maxFee: 2_000 };
export const VOLATILE_PROFILE: AimmProfile = { ...SHARED, minFee: 1, maxFee: 10_000 };

const SIGMA_SEED = { stable: 5_000, volatile: 50_000 } as const;
export const sigmaSeed = (tag: keyof typeof SIGMA_SEED): number => SIGMA_SEED[tag];
