// `PoolStorage` layout v4 (`Pool.storageVersion() >= 4`, BNB): solc `storageLayout` of dex-evm
// `out/Pool.sol/Pool.json`, and `abi/constants.json` `marks` for the one `marks` word. v4 moves
// `lastGoodCWad` into slot 0 (uint40, 1e-9 WAD) and packs a leg's two feeds into one word at
// slot 13. `storage.test.ts` restates it by hand.

import { POOL_STRUCTS_V3 } from './layout.v3.generated.js';

/** Absolute slots of every `IPool.PoolStorage` field, mappings included. */
export const POOL_STORAGE_V4 = {
  baseToken: 0n,
  initialized: 0n,
  protoSharePct: 0n,
  flashFeePbps: 0n,
  flowCooldownSecs: 0n,
  solvencyArmed: 0n,
  lastGoodCWad9: 0n,
  wnative: 1n,
  treasury: 2n,
  factory: 3n,
  assets: 4n,
  oracleConfigs: 5n,
  curves: 6n,
  custody: 7n,
  assetHooks: 8n,
  lpTokens: 9n,
  poolAdmin: 10n,
  legs: 12n,
  marks: 13n,
} as const;

/** `PoolStorage` members that are mappings: pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS_V4 = [
  'assets',
  'oracleConfigs',
  'curves',
  'custody',
  'assetHooks',
  'lpTokens',
  'marks',
] as const;

/** In-struct `[slot, byteOffset]`: v3's, plus `lastGoodCWad9` in slot 0's tail. */
export const POOL_STRUCTS_V4 = {
  ...POOL_STRUCTS_V3,
  PoolStorage: { ...POOL_STRUCTS_V3.PoolStorage, lastGoodCWad9: [0, 27] },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

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
