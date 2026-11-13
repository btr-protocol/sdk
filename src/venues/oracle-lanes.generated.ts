// Oracle lane maps for the packed-slot push oracles, per chain.
// GENERATED from dex-evm/deployments (<slug>.manifest.json + <chainId>.deploy.json, and
// <chainId>-v2.lanes.json + <chainId>-v2.deploy.json for Pool v2) - never hand-edited.
// Regenerate: sdk/scripts/gen-oracle-lanes.py - it emits EVERY deployed chain, so a bare run is
// always the whole table; an optional chain-id argument only filters it for inspection.
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` is 0 on wire 8: the lane exponent is absolute.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// A wire-8 chain appears TWICE, once per tier verifyingContract (`role`): the primary every pool leg
// reads, and the reference that prices non-base spokes. A wire-9 (Pool v2) chain has one primary map,
// its PoolFactory. Generations overlap during a cutover, so more than one map can be live at a time -
// always join on the ADDRESS, never on the wire tag.

import type { Address, Hex } from '../eth/types.js';

/** Wire generation. The tag is the BLOB version byte, not the contract's name:
 *  ExternalOracleV3 speaks wire 'v3' (blob version 4), ExternalOracleV4 'v5', ExternalOracleV5 'v6',
 *  MarkStoreP8 'v8', and Pool v2's MarkStoreP8 wire 3 'v9' (storageVersion 12). */
export type OracleWire = 'v2' | 'v3' | 'v5' | 'v6' | 'v8' | 'v9';

/** Which of a generation's two deployed instances a map addresses. */
export type OracleRole = 'primary' | 'reference';

export interface OracleLaneFeed {
  /** slotId * lanesPerSlot + laneIdx; the address every wire record carries. */
  globalIndex: number;
  /** Decode bias: mark1e18 = mantissa << (exp + expBias). */
  expBias: number;
  /** Risk/encode class ('stable' | 'fx' | 'volatile' | 'equity'). */
  cls: string;
  /** Reference feed (USDC-USD denominator), not a spoke. */
  ref?: boolean;
  /** The feed's id as this generation's own deploy record names it. Present on wire 9 only: the
   *  venue record's id for the same name can differ (CBBTC), so a lane binds on this when set. */
  feedId?: Hex;
}

export interface OracleLaneMap {
  chainId: number;
  wire: OracleWire;
  /** Primary (pool-facing) or reference (spoke-pricing) instance of this generation. */
  role: OracleRole;
  /** The oracle contract this map addresses. THE join key: pick the map whose oracle
   *  matches the venue record's `contracts.oracle` / `contracts.refOracle`, so a
   *  generation cutover needs no code change. */
  oracle: Address;
  /** 8 (V2, 28-bit lanes), 10 (V3, 22-bit lanes), 8 (V4, 29-bit lanes) or 4 (V5 32-bit, P8 56-bit lanes). */
  lanesPerSlot: number;
  /** EIP-712 domain name the push quorum signs under. */
  domainName: string;
  /** Lane symbol -> lane addressing. Symbol maps to the on-chain feed name via {@link oracleFeedName}. */
  feeds: Record<string, OracleLaneFeed>;
}

export const ORACLE_LANE_MAPS: readonly OracleLaneMap[] = [
  {
    chainId: 143,
    wire: 'v8',
    role: 'primary',
    oracle: '0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF',
    lanesPerSlot: 4,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      'USDC-USD': { globalIndex: 0, expBias: 0, cls: 'stable', ref: true },
      WMON: { globalIndex: 1, expBias: 0, cls: 'volatile' },
      CBBTC: { globalIndex: 2, expBias: 0, cls: 'volatile' },
      WBTC: { globalIndex: 3, expBias: 0, cls: 'volatile' },
      WETH: { globalIndex: 4, expBias: 0, cls: 'volatile' },
      XAUT0: { globalIndex: 5, expBias: 0, cls: 'volatile' },
    },
  },
  {
    chainId: 143,
    wire: 'v8',
    role: 'reference',
    oracle: '0xBccAE41A5df0f9241454198d4565426Abf41cA83',
    lanesPerSlot: 4,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      'USDC-USD': { globalIndex: 0, expBias: 0, cls: 'stable', ref: true },
      WMON: { globalIndex: 1, expBias: 0, cls: 'volatile' },
      CBBTC: { globalIndex: 2, expBias: 0, cls: 'volatile' },
      WBTC: { globalIndex: 3, expBias: 0, cls: 'volatile' },
      WETH: { globalIndex: 4, expBias: 0, cls: 'volatile' },
      XAUT0: { globalIndex: 5, expBias: 0, cls: 'volatile' },
    },
  },
  {
    chainId: 143,
    wire: 'v9',
    role: 'primary',
    oracle: '0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0',
    lanesPerSlot: 64,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      'USDC-USD': {
        globalIndex: 0,
        expBias: 0,
        cls: 'stable',
        feedId: '0x0000000000000000000000000000000000000000000000000648453138900000',
        ref: true,
      },
      WMON: {
        globalIndex: 1,
        expBias: 0,
        cls: 'alt',
        feedId: '0x000000000000000000000000000000000000000000000000065b056484500000',
      },
      CBBTC: {
        globalIndex: 2,
        expBias: 0,
        cls: 'major',
        feedId: '0x000000000000000000000000000000000000000000000000060f3d6484500000',
      },
      WBTC: {
        globalIndex: 3,
        expBias: 0,
        cls: 'major',
        feedId: '0x000000000000000000000000000000000000000000000000064b016484500000',
      },
      WETH: {
        globalIndex: 4,
        expBias: 0,
        cls: 'major',
        feedId: '0x0000000000000000000000000000000000000000000000000616a96484500000',
      },
      XAUT0: {
        globalIndex: 5,
        expBias: 0,
        cls: 'gold',
        feedId: '0x000000000000000000000000000000000000000000000000064ee96484500000',
      },
      MUSD: {
        globalIndex: 6,
        expBias: 0,
        cls: 'stable',
        feedId: '0x000000000000000000000000000000000000000000000000065e256484500000',
      },
      AUSD: {
        globalIndex: 7,
        expBias: 0,
        cls: 'stable',
        feedId: '0x0000000000000000000000000000000000000000000000000601f56484500000',
      },
      GHO: {
        globalIndex: 8,
        expBias: 0,
        cls: 'stable',
        feedId: '0x0000000000000000000000000000000000000000000000000600c96484500000',
      },
      USDT0: {
        globalIndex: 9,
        expBias: 0,
        cls: 'stable',
        feedId: '0x0000000000000000000000000000000000000000000000000644c16484500000',
      },
      USDE: {
        globalIndex: 10,
        expBias: 0,
        cls: 'stable',
        feedId: '0x0000000000000000000000000000000000000000000000000615196484500000',
      },
      USDAT: {
        globalIndex: 11,
        expBias: 0,
        cls: 'stable',
        feedId: '0x000000000000000000000000000000000000000000000000065fb56484500000',
      },
      SYRUPUSDC: {
        globalIndex: 12,
        expBias: 0,
        cls: 'stable',
        feedId: '0x000000000000000000000000000000000000000000000000065b696484500000',
      },
    },
  },
];

/** Lane symbol -> the on-chain feed name (`feedIds` key in the venue record). */
export const oracleFeedName = (laneSymbol: string): string =>
  laneSymbol.includes('-') ? laneSymbol : `${laneSymbol}-USDC`;

/** The lane map addressing `oracle` on `chainId`, or null (a retired or unknown oracle has no
 *  lanes here - callers must treat null as "cannot decode", never as "no feeds"). */
export function oracleLaneMap(chainId: number, oracle: string): OracleLaneMap | null {
  const key = oracle.toLowerCase();
  return (
    ORACLE_LANE_MAPS.find((m) => m.chainId === chainId && m.oracle.toLowerCase() === key) ?? null
  );
}

/** globalIndex -> lane symbol, for joining decoded wire records back to feeds. */
export function laneSymbolByGi(map: OracleLaneMap): Map<number, string> {
  const out = new Map<number, string>();
  for (const [sym, f] of Object.entries(map.feeds)) out.set(f.globalIndex, sym);
  return out;
}
