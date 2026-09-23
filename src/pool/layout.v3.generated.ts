// `PoolStorage` layout v3 (`Pool.storageVersion() >= 3`, BNB): solc `storageLayout` of dex-evm
// `out/Pool.sol/Pool.json`, and `abi/constants.json` `marks` for the two `marks` words. Layout v2
// (Arc) stays in `layout.generated.ts`, frozen. `storage.test.ts` restates both by hand.

/** Absolute slots of every `IPool.PoolStorage` field, mappings included. */
export const POOL_STORAGE_V3 = {
  baseToken: 0n,
  initialized: 0n,
  protoSharePct: 0n,
  flashFeePbps: 0n,
  flowCooldownSecs: 0n,
  solvencyArmed: 0n,
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
  lastGoodCWad: 13n,
  marks: 14n,
} as const;

/** `PoolStorage` members that are mappings: pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS_V3 = [
  'assets',
  'oracleConfigs',
  'curves',
  'custody',
  'assetHooks',
  'lpTokens',
  'marks',
] as const;

/**
 * In-struct field position as `[slot, byteOffset]`, LSB-aligned exactly as solc packs it.
 * `slot` is relative to the struct's own base (the mapping-entry base for a mapping value).
 */
export const POOL_STRUCTS_V3 = {
  PoolStorage: {
    baseToken: [0, 0],
    initialized: [0, 20],
    protoSharePct: [0, 21],
    flashFeePbps: [0, 22],
    flowCooldownSecs: [0, 24],
    solvencyArmed: [0, 26],
    wnative: [1, 0],
    treasury: [2, 0],
    factory: [3, 0],
    poolAdmin: [10, 0],
  },
  Asset: {
    reserves: [0, 0],
    liabilities: [0, 16],
    anchor: [1, 0],
    minLiquidity: [1, 20],
    liquidityIndexWad: [2, 0],
    minDispersionPbps: [2, 12],
    curveId: [2, 16],
    minFeePbps: [2, 18],
    vegaBps: [2, 20],
    depositCapCode: [2, 22],
    decimals: [2, 24],
    deadSeedPow10: [2, 25],
    flags: [2, 26],
    kappaCovBps: [2, 28],
    maxLiabWeightBps: [2, 30],
  },
  OracleConfig: {
    feedId: [0, 0],
    primary: [1, 0],
    mode: [1, 20],
    quoteUnit: [1, 21],
    refBandBps: [1, 22],
    refFeedId: [2, 0],
    refPrimary: [3, 0],
  },
  HookSlot: {
    target: [0, 0],
    flags: [0, 20],
    lastCreditAt: [0, 24],
  },
  Custody: {
    protocolFees: [0, 0],
    invested: [0, 16],
  },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

/**
 * `MarkWordLib` bit offsets. `marks[t]` is a `uint256[2]`: word 0 at the mapping-entry base (the
 * primary feed + config mirror), word 1 at base + 1 (the reference feed in the same bits, mirror
 * bits 0).
 */
export const MARK_WORD = {
  OBS_SHIFT: 128,
  SIGMA_SHIFT: 160,
  CONF_SHIFT: 187,
  TTL_SHIFT: 203,
  MAX_DEV_SHIFT: 219,
  HALT_SHIFT: 230,
  INTERNAL_SHIFT: 231,
  UOA_SHIFT: 232,
  REF_BAND_SHIFT: 233,
  MAX_DEV_MAX: 2047,
} as const;
