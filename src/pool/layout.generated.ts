// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.

/** Absolute slots of every `IPool.PoolStorage` field, mappings included. */
export const POOL_STORAGE = {
  baseToken: 0n,
  initialized: 0n,
  protoSharePct: 0n,
  flashFeePbps: 0n,
  flowCooldownSecs: 0n,
  wnative: 1n,
  treasury: 2n,
  factory: 3n,
  assets: 4n,
  oracleConfigs: 5n,
  curves: 6n,
  protocolFees: 7n,
  assetHooks: 8n,
  invested: 9n,
  lpTokens: 10n,
} as const;

/** `PoolStorage` members that are mappings: pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS = [
  'assets',
  'oracleConfigs',
  'curves',
  'protocolFees',
  'assetHooks',
  'invested',
  'lpTokens',
] as const;

/**
 * In-struct field position as `[slot, byteOffset]`, LSB-aligned exactly as solc packs it.
 * `slot` is relative to the struct's own base (the mapping-entry base for a mapping value).
 */
export const POOL_STRUCTS = {
  PoolStorage: {
    baseToken: [0, 0],
    initialized: [0, 20],
    protoSharePct: [0, 21],
    flashFeePbps: [0, 22],
    flowCooldownSecs: [0, 24],
    wnative: [1, 0],
    treasury: [2, 0],
    factory: [3, 0],
  },
  Asset: {
    reserves: [0, 0],
    liabilities: [0, 16],
    anchor: [1, 0],
    minLiquidity: [1, 20],
    liquidityIndexWad: [2, 0],
    minDispersionPbps: [2, 12],
    presetId: [2, 16],
    minFeePbps: [2, 18],
    vegaBps: [2, 20],
    haircutSuppressorBps: [2, 22],
    decimals: [2, 24],
    deadSeedPow10: [2, 25],
    flags: [2, 26],
    kappaCovBps: [2, 28],
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
} as const satisfies Record<string, Record<string, readonly [number, number]>>;
