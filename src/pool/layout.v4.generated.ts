// The mark-word codecs the live pools use: `MARK_WORD_V4` is dex-evm main 1bfe04ed
// `MarkWordLib` (wire 3, the v2 pool, storage version 12; mirrored by core `mark_word_v4`),
// `MARK_WORD_WIRE2` the v1 fleet's impl (dex-evm 7ade4b9, storage versions 5..9), frozen with its
// R tier. The name keeps its layout-v4 origin; the v4 `PoolStorage` slots and storage version are
// retired. `test/solidity-mirror.test.ts` pins `MARK_WORD_V4` against `MarkWordLib.sol`.

/**
 * Wire 3 `MarkWordLib` bit offsets of a leg word: markF 0..31 | obs 32..63 | σ 64..90 | conf
 * 91..106 | ttl 107..122 | maxDev 123..133 | halt 134 | (store word: minSigma 232..255; leg word:
 * INTERNAL 232 | UOA 233 | depeg code 234..237, `Asset.flags` 12..15). No R tier. markF is the V5
 * lane float `mant u25 | exp7 u7 << 25`, mark = mant << (exp7 - 16) (a right shift below 16).
 */
export const MARK_WORD_V4 = {
  OBS_SHIFT: 32,
  SIGMA_SHIFT: 64,
  CONF_SHIFT: 91,
  TTL_SHIFT: 107,
  MAX_DEV_SHIFT: 123,
  HALT_SHIFT: 134,
  INTERNAL_SHIFT: 232,
  MIN_SIGMA_SHIFT: 232,
  UOA_SHIFT: 233,
  DEPEG_SHIFT: 234,
  MAX_DEV_MAX: 2047,
} as const;

/**
 * Wire 2 (v1 fleet) leg word: P as above, then R (reference feed, 0 while the band is disarmed):
 * markF at REF_SHIFT, obs, conf, ttl, halt; mirror INTERNAL 232 | UOA 233 | refBandBps 234..249.
 */
export const MARK_WORD_WIRE2 = {
  OBS_SHIFT: 32,
  SIGMA_SHIFT: 64,
  CONF_SHIFT: 91,
  TTL_SHIFT: 107,
  MAX_DEV_SHIFT: 123,
  HALT_SHIFT: 134,
  REF_SHIFT: 135,
  REF_OBS_SHIFT: 167,
  REF_CONF_SHIFT: 199,
  REF_TTL_SHIFT: 215,
  REF_HALT_SHIFT: 231,
  INTERNAL_SHIFT: 232,
  UOA_SHIFT: 233,
  REF_BAND_SHIFT: 234,
  MAX_DEV_MAX: 2047,
} as const;
