// The one mark-word codec the live pools use: the P8 store word (`MarkWordLib.compose`) that
// `decodeStoreWord` reads for v5 and v10 pools. The name keeps its layout-v4 origin; the v4
// `PoolStorage` slots and the v4 storage version are retired and no longer tabled here.

/**
 * `MarkWordLib` bit offsets of the one `marks[t]` word. P (primary feed): markF 0..31, obs, σ,
 * conf, ttl, maxDev, halt. R (reference feed, 0 while the band is disarmed): markF at REF_SHIFT,
 * obs, conf, ttl, halt. Then the config mirror. markF is the V5 lane float
 * `mant u25 | exp7 u7 << 25`, mark = mant << (exp7 - 16) (a right shift below 16).
 */
export const MARK_WORD_V4 = {
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
