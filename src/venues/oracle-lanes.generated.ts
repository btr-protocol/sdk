// Oracle lane maps for the packed-slot push oracles, per chain.
// GENERATED from dex-evm/deployments (<slug>.manifest.json + <chainId>.deploy.json) - never hand-edited.
// Regenerate: sdk/scripts/gen-oracle-lanes.py - it emits EVERY deployed chain, so a bare run is
// always the whole table; an optional chain-id argument only filters it for inspection.
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` is 0 on wire 8: the lane exponent is absolute.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// A chain appears TWICE, once per tier verifyingContract (`role`): the primary every pool leg
// reads, and the reference that prices non-base spokes. Generations overlap during a cutover, so
// more than one map can be live at a time - always join on the ADDRESS, never on the wire tag.

import type { Address } from '../eth/types.js';

/** Wire generation. The tag is the BLOB version byte, not the contract's name:
 *  ExternalOracleV3 speaks wire 'v3' (blob version 4), ExternalOracleV4 'v5', ExternalOracleV5 'v6',
 *  MarkStoreP8 'v8'. */
export type OracleWire = 'v2' | 'v3' | 'v5' | 'v6' | 'v8';

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
    chainId: 5042002,
    wire: 'v8',
    role: 'primary',
    oracle: '0xbBBbBBBb323D7f7E51976b8A8DF2Bb4B4608d9B3',
    lanesPerSlot: 4,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      'USDC-USD': { globalIndex: 0, expBias: 0, cls: 'stable', ref: true },
      USDT: { globalIndex: 1, expBias: 0, cls: 'stable' },
      USDS: { globalIndex: 2, expBias: 0, cls: 'stable' },
      USD1: { globalIndex: 3, expBias: 0, cls: 'stable' },
      PYUSD: { globalIndex: 4, expBias: 0, cls: 'stable' },
      EURC: { globalIndex: 5, expBias: 0, cls: 'fx' },
      QCAD: { globalIndex: 6, expBias: 0, cls: 'fx' },
      AUDF: { globalIndex: 7, expBias: 0, cls: 'fx' },
      JPYC: { globalIndex: 8, expBias: 0, cls: 'fx' },
      KRW1: { globalIndex: 9, expBias: 0, cls: 'fx' },
      WETH: { globalIndex: 10, expBias: 0, cls: 'volatile' },
      WBTC: { globalIndex: 11, expBias: 0, cls: 'volatile' },
      CBBTC: { globalIndex: 12, expBias: 0, cls: 'volatile' },
      BNB: { globalIndex: 13, expBias: 0, cls: 'volatile' },
      XAUT: { globalIndex: 14, expBias: 0, cls: 'volatile' },
      PAXG: { globalIndex: 15, expBias: 0, cls: 'volatile' },
      INTC: { globalIndex: 16, expBias: 0, cls: 'volatile' },
      AMD: { globalIndex: 17, expBias: 0, cls: 'volatile' },
      NVDA: { globalIndex: 18, expBias: 0, cls: 'volatile' },
      ASML: { globalIndex: 19, expBias: 0, cls: 'volatile' },
      SPCX: { globalIndex: 20, expBias: 0, cls: 'volatile' },
      AVGO: { globalIndex: 21, expBias: 0, cls: 'volatile' },
      TSLA: { globalIndex: 22, expBias: 0, cls: 'volatile' },
      MSFT: { globalIndex: 23, expBias: 0, cls: 'volatile' },
      ORCL: { globalIndex: 24, expBias: 0, cls: 'volatile' },
      META: { globalIndex: 25, expBias: 0, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v8',
    role: 'reference',
    oracle: '0x27cf4711937B0154ba70D020eD238D941b586966',
    lanesPerSlot: 4,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      'USDC-USD': { globalIndex: 0, expBias: 0, cls: 'stable', ref: true },
      USDT: { globalIndex: 1, expBias: 0, cls: 'stable' },
      USDS: { globalIndex: 2, expBias: 0, cls: 'stable' },
      USD1: { globalIndex: 3, expBias: 0, cls: 'stable' },
      PYUSD: { globalIndex: 4, expBias: 0, cls: 'stable' },
      EURC: { globalIndex: 5, expBias: 0, cls: 'fx' },
      QCAD: { globalIndex: 6, expBias: 0, cls: 'fx' },
      AUDF: { globalIndex: 7, expBias: 0, cls: 'fx' },
      JPYC: { globalIndex: 8, expBias: 0, cls: 'fx' },
      KRW1: { globalIndex: 9, expBias: 0, cls: 'fx' },
      WETH: { globalIndex: 10, expBias: 0, cls: 'volatile' },
      WBTC: { globalIndex: 11, expBias: 0, cls: 'volatile' },
      CBBTC: { globalIndex: 12, expBias: 0, cls: 'volatile' },
      BNB: { globalIndex: 13, expBias: 0, cls: 'volatile' },
      XAUT: { globalIndex: 14, expBias: 0, cls: 'volatile' },
      PAXG: { globalIndex: 15, expBias: 0, cls: 'volatile' },
      INTC: { globalIndex: 16, expBias: 0, cls: 'volatile' },
      AMD: { globalIndex: 17, expBias: 0, cls: 'volatile' },
      NVDA: { globalIndex: 18, expBias: 0, cls: 'volatile' },
      ASML: { globalIndex: 19, expBias: 0, cls: 'volatile' },
      SPCX: { globalIndex: 20, expBias: 0, cls: 'volatile' },
      AVGO: { globalIndex: 21, expBias: 0, cls: 'volatile' },
      TSLA: { globalIndex: 22, expBias: 0, cls: 'volatile' },
      MSFT: { globalIndex: 23, expBias: 0, cls: 'volatile' },
      ORCL: { globalIndex: 24, expBias: 0, cls: 'volatile' },
      META: { globalIndex: 25, expBias: 0, cls: 'volatile' },
    },
  },
  {
    chainId: 143,
    wire: 'v8',
    role: 'primary',
    oracle: '0xbBBbBBBb323D7f7E51976b8A8DF2Bb4B4608d9B3',
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
    oracle: '0x27cf4711937B0154ba70D020eD238D941b586966',
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
