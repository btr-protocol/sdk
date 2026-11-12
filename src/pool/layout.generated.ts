// The struct layouts of the served `Pool.storageVersion()`s: `Asset` as the v2 pool (storage
// version 12, dex-evm main 1bfe04ed) packs it, `AssetV5` as the v1 fleet (5..9) still does, and
// `HookSlot`. The v2 `PoolStorage` slots, mappings and `OracleConfig` were the retired layouts
// v2..v4 (storage versions 2..4) and are gone; the v5 and v10 slot tables are in their own files.
// No generator: hand-mirrored from `forge inspect src/Pool.sol:Pool storage-layout` (the
// `t_struct(Asset)` members) and pinned by `storage.test.ts`.

/**
 * In-struct field position as `[slot, byteOffset]`, LSB-aligned exactly as solc packs it.
 * `slot` is relative to the struct's own base (the mapping-entry base for a mapping value).
 */
export const POOL_STRUCTS = {
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
    maxLiabWeightBps: [2, 25],
    oracleBits: [2, 27],
    covBits: [2, 28],
    kneeBits: [3, 0],
  },
  /** The v1 fleet's `Asset` (storage versions 5..9): κ and the depeg band were struct fields. */
  AssetV5: {
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
  HookSlot: {
    target: [0, 0],
    flags: [0, 20],
    lastCreditAt: [0, 24],
    creditBookCode: [0, 28],
  },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;
