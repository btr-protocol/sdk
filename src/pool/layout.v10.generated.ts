// `PoolStorage` layout v10 (`Pool.storageVersion() == 12`, the v2 pool, fresh fleets only): solc
// `storageLayout` of dex-evm `out/Pool.sol/Pool.json` (`forge inspect src/Pool.sol:Pool
// storage-layout`, dex-evm main 1bfe04ed) plus the area constants of `PoolConstantsLib.sol`. No
// generator script: regenerate by hand from that artifact; `storage.test.ts` pins the slots and
// diffs them against a sibling `dex-evm/out` build. A listed leg's `Asset` is no mapping entry: it
// is a 6-slot record in the area (slot 128 up) found through `legIndex` (`recordSlot`): `Asset`
// (0..3, 3 = `kneeBits`), `Custody` at +4 and `ClassHead` (`family u8 | row u64 | famRow u64 |
// expAt u32 | expHw u88`) at +5. Curves are area words found through `curveIndex`
// (`curveSlot`), no SSTORE2 code. Slot 4 (`unlisted`) holds only never-listed tokens; slots 5, 6, 7,
// 11 and 16 are reserved. `storage.test.ts` restates it by hand.

/** Absolute slots of every `IPool.PoolStorage` field, mappings and fixed arrays included. */
export const POOL_STORAGE_V10 = {
  baseToken: 0n,
  initialized: 0n,
  protoSharePct: 0n,
  flowCooldownSecs: 0n,
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
  /** Record = `Asset` (0..3) | `Custody` (+4) | `ClassHead` (+5). */
  RECORD_SLOTS: 6n,
  RECORD_KNEE: 3n,
  RECORD_CUSTODY: 4n,
  RECORD_CLASS_HEAD: 5n,
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

/**
 * Wire 3 `MarkStore` (`storageVersion() == 12`) in the Pool impl account (`PoolFactory.implementation()`, equally a proxy's
 * ERC-1967 impl slot): words at `MS + o`, `o` a u8. Lane `l` at `MS + l` holds both tiers in the
 * `MARK_WORD_V4` layout with the lane's σ floor at `MIN_SIGMA_SHIFT` in place of the mirror bits.
 * `Asset.oracleBits` = lane 0..5 | INTERNAL 6 | UOA 7. `AUTH` (0x20) holds each tier's
 * counts, tier `t` at bit `32 (t - 1)`: `n u8 | k u8 | nRelayers u8`; `META` (0x21) = `nLanes u8 |
 * registered bitmap << 64`; signers at `0x30 + 16 (t - 1) + i`, relayers at `0x50 + 16 (t - 1) + i`.
 * `MS` is page-aligned: `keccak256("btr.markstore.p8.v3") - 1`, low 7 bits cleared.
 */
export const MARK_STORE_V10 = {
  MS: 0x9f565915885d2711090cff7ae34213da4080440ed72d78f99086ab658acbc900n,
  AUTH: 0x20n,
  META: 0x21n,
  MIN_SIGMA_SHIFT: 232,
  LANE_MASK: 63,
  INTERNAL_BIT: 64,
  UOA_BIT: 128,
} as const;
