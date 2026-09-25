// `PoolStorage` layout v5 (`Pool.storageVersion() >= 5`, BNB): solc `storageLayout` of dex-evm
// `out/Pool.sol/Pool.json`. No mark lives in the pool: slot 5 is reserved, the leg's oracle wiring
// sits in `Asset` slot 2 and the marks live once, in the Pool impl's `MarkStore`
// (`MARK_STORE`, one word per lane at `MS + lane`). Slot 6 is reserved too: each curve is an
// immutable SSTORE2 blob at `curvePointer(pool, curveId)`. `storage.test.ts` restates it by hand.

import { POOL_STRUCTS_V4 } from './layout.v4.generated.js';

/** Absolute slots of every `IPool.PoolStorage` field, mappings included. */
export const POOL_STORAGE_V5 = {
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
  custody: 7n,
  assetHooks: 8n,
  lpTokens: 9n,
  poolAdmin: 10n,
  legs: 12n,
} as const;

/** `PoolStorage` members that are mappings: pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS_V5 = ['assets', 'custody', 'assetHooks', 'lpTokens'] as const;

/** In-struct `[slot, byteOffset]`: v4's, with `Asset` slot 2 repacked around a uint72 index and
 *  the leg's oracle wiring on its tail. */
export const POOL_STRUCTS_V5 = {
  ...POOL_STRUCTS_V4,
  Asset: {
    reserves: [0, 0],
    liabilities: [0, 16],
    anchor: [1, 0],
    minLiquidity: [1, 20],
    liquidityIndexWad: [2, 0],
    minDispersionPbps: [2, 9],
    curveId: [2, 13],
    minFeePbps: [2, 15],
    vegaBps: [2, 17],
    depositCapCode: [2, 19],
    decimals: [2, 21],
    deadSeedPow10: [2, 22],
    flags: [2, 23],
    kappaCovBps: [2, 25],
    maxLiabWeightBps: [2, 27],
    oracleBits: [2, 29],
    refBandBps: [2, 30],
  },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

/**
 * `MarkStore` in the Pool impl account (`PoolFactory.implementation()`, equally a proxy's
 * ERC-1967 impl slot): words at `MS + o`, `o` a u8. Lane `l` at `MS + l` holds both tiers in the
 * `MARK_WORD_V4` layout with the lane's σ floor at `MIN_SIGMA_SHIFT` in place of the mirror bits.
 * `Asset.oracleBits` = lane 0..5 | INTERNAL 6 | UOA 7. `AUTH` holds both tiers' roster
 * commitments: tier `t` in the u128 at bit `(2 - t) * 128`, the high 16 bytes of `keccak(roster)`.
 */
export const MARK_STORE = {
  MS: 0x8fb4340288f7429bd33c13abd02aa3c2145e859f37a071b10e8e034e391167e9n,
  AUTH: 0x40n,
  META: 0x44n,
  ANCHOR: 0x80n,
  MIN_SIGMA_SHIFT: 232,
  LANE_MASK: 63,
  INTERNAL_BIT: 64,
  UOA_BIT: 128,
} as const;
