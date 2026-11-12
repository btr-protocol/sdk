// The live struct layouts shared by every served `Pool.storageVersion()` (5..9 and 12): `Asset`
// and `HookSlot`. The v2 `PoolStorage` slots, mappings and `OracleConfig` were the retired layouts
// v2..v4 (storage versions 2..4) and are gone; the v5 and v10 slot tables are in their own files.

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
    kappaCovBps: [2, 25],
    maxLiabWeightBps: [2, 27],
    oracleBits: [2, 29],
    refBandBps: [2, 30],
  },
  HookSlot: {
    target: [0, 0],
    flags: [0, 20],
    lastCreditAt: [0, 24],
  },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;
