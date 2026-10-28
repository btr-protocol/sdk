// `PoolStorage` layout v10 (`Pool.storageVersion() == 10`, fresh fleets only): solc
// `storageLayout` of dex-evm `out/Pool.sol/Pool.json` (`forge inspect src/Pool.sol:Pool
// storage-layout`, release/pool-v2-rc2 83773c0) plus the area constants of
// `PoolConstantsLib.sol`. A listed leg's `Asset` is no mapping entry: it is a 5-slot record in the
// area (slot 128 up) found through `legIndex` (`recordSlot`), with `Custody` at +3 and `ClassHead`
// (`family u8 | row u64 | famRow u64`) at +4. Curves are area words found through `curveIndex`
// (`curveSlot`), no SSTORE2 code. Slot 4 (`unlisted`) holds only never-listed tokens; slots 5, 6, 7,
// 11 and 16 are reserved. `storage.test.ts` restates it by hand.

/** Absolute slots of every `IPool.PoolStorage` field, mappings and fixed arrays included. */
export const POOL_STORAGE_V10 = {
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
  unlisted: 4n,
  assetHooks: 8n,
  lpTokens: 9n,
  poolAdmin: 10n,
  legs: 12n,
  coop: 13n,
  lpTag: 14n,
  lpSyms: 15n,
  classRisk: 17n,
  swapGate: 18n,
  areaTop: 82n,
  legCount: 82n,
  curveCount: 82n,
  legIndex: 83n,
  curveIndex: 115n,
} as const;

/** `PoolStorage` members that are mappings: pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS_V10 = [
  'unlisted',
  'assetHooks',
  'lpTokens',
  'coop',
  'lpSyms',
  'classRisk',
] as const;

/** `PoolConstantsLib` area constants and the record / index geometry. */
export const POOL_AREA_V10 = {
  /** First area slot (page 1); records and curve blobs are bump-allocated from here. */
  AREA_BASE: 128n,
  /** Record = `Asset` (0..2) | `Custody` (+3) | `ClassHead` (+4). */
  RECORD_SLOTS: 5n,
  RECORD_CUSTODY: 3n,
  RECORD_CLASS_HEAD: 4n,
  /** `legIndex` words: entry `uint160(token) | recordSlot << 160`, probe from `uint160 % 32`. */
  LEG_INDEX_SLOTS: 32,
  LEG_MAX: 24,
  /** `curveIndex` u32 lanes (8 per word, lane j at word j/8 bit 32·(j%8)): `id | blobSlot << 16`. */
  CURVE_INDEX_WORDS: 8,
  CURVE_INDEX_LANES: 64,
  CURVE_MAX: 48,
  SWAP_GATE_SLOTS: 64,
  /** `PoolProxy`'s page-0 copy of the impl address. */
  IMPL_COPY: 127n,
  /** Slot 82 byte offsets: `areaTop` u32 | `legCount` u8 | `curveCount` u8. */
  META_OFFSETS: { areaTop: 0, legCount: 4, curveCount: 5 },
  /** `ClassHead` byte offsets in its record word. */
  CLASS_HEAD_OFFSETS: { family: 0, row: 1, famRow: 9 },
} as const;
