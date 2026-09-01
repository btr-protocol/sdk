// Oracle lane maps for the packed-slot push oracles (V2/V3/V4), per chain.
// GENERATED from dex-evm/deployments/arc-oracle-{v2,v3,v4}-lanes.json - do not hand-edit values.
// Regenerate: sdk/scripts/gen-oracle-lanes.py (reads the dex-evm lane JSONs).
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` governs the lane price decode (mantissa << (exp + bias)); it is per encode class up to
// V3 and PER FEED from V4 (bias = bitLength(mark1e18) - 32, which pins exp = 7 on every feed). It
// is corrected on-chain via setFeedExpBias, so a drifted bias means REGENERATING this file.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// Each generation appears TWICE, once per deployed instance (`role`): the primary every pool leg
// reads, and the reference that prices non-base spokes. Generations overlap during a cutover, so
// more than one map can be live at a time - always join on the ADDRESS, never on the wire tag.

import type { Address } from '../eth/types.js';

/** Wire generation. The tag is the BLOB version byte, not the contract's name:
 *  ExternalOracleV3 speaks wire 'v3' (blob version 4), ExternalOracleV4 speaks 'v5'. */
export type OracleWire = 'v2' | 'v3' | 'v5';

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
  /** 8 (V2, 28-bit lanes), 10 (V3, 22-bit lanes) or 8 (V4, 29-bit lanes). */
  lanesPerSlot: number;
  /** EIP-712 domain name the push quorum signs under. */
  domainName: string;
  /** Lane symbol -> lane addressing. Symbol maps to the on-chain feed name via {@link oracleFeedName}. */
  feeds: Record<string, OracleLaneFeed>;
}

export const ORACLE_LANE_MAPS: readonly OracleLaneMap[] = [
  {
    chainId: 5042002,
    wire: 'v2',
    role: 'primary',
    oracle: '0xcd7d5d0fCd08f08570D95bdd159eB148e453aB37',
    lanesPerSlot: 8,
    domainName: 'BTR ExternalOracleV2',
    feeds: {
      USDT: { globalIndex: 0, expBias: 22, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 22, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 22, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 22, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 22, cls: 'stable', ref: true },
      EURC: { globalIndex: 8, expBias: 16, cls: 'fx' },
      QCAD: { globalIndex: 9, expBias: 16, cls: 'fx' },
      AUDF: { globalIndex: 10, expBias: 16, cls: 'fx' },
      JPYC: { globalIndex: 11, expBias: 16, cls: 'fx' },
      KRW1: { globalIndex: 12, expBias: 16, cls: 'fx' },
      WETH: { globalIndex: 16, expBias: 32, cls: 'volatile' },
      WBTC: { globalIndex: 17, expBias: 32, cls: 'volatile' },
      CBBTC: { globalIndex: 18, expBias: 32, cls: 'volatile' },
      BNB: { globalIndex: 19, expBias: 32, cls: 'volatile' },
      XAUT: { globalIndex: 20, expBias: 32, cls: 'volatile' },
      PAXG: { globalIndex: 21, expBias: 32, cls: 'volatile' },
      INTC: { globalIndex: 24, expBias: 32, cls: 'volatile' },
      AMD: { globalIndex: 25, expBias: 32, cls: 'volatile' },
      NVDA: { globalIndex: 26, expBias: 32, cls: 'volatile' },
      ASML: { globalIndex: 27, expBias: 32, cls: 'volatile' },
      SPCX: { globalIndex: 28, expBias: 32, cls: 'volatile' },
      AVGO: { globalIndex: 29, expBias: 32, cls: 'volatile' },
      TSLA: { globalIndex: 30, expBias: 32, cls: 'volatile' },
      MSFT: { globalIndex: 31, expBias: 32, cls: 'volatile' },
      ORCL: { globalIndex: 32, expBias: 32, cls: 'volatile' },
      META: { globalIndex: 33, expBias: 32, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v2',
    role: 'reference',
    oracle: '0xebc298A8d2d98114C5b448EC9e1f96e176aBF0d5',
    lanesPerSlot: 8,
    domainName: 'BTR ExternalOracleV2',
    feeds: {
      USDT: { globalIndex: 0, expBias: 22, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 22, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 22, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 22, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 22, cls: 'stable', ref: true },
      EURC: { globalIndex: 8, expBias: 16, cls: 'fx' },
      QCAD: { globalIndex: 9, expBias: 16, cls: 'fx' },
      AUDF: { globalIndex: 10, expBias: 16, cls: 'fx' },
      JPYC: { globalIndex: 11, expBias: 16, cls: 'fx' },
      KRW1: { globalIndex: 12, expBias: 16, cls: 'fx' },
      WETH: { globalIndex: 16, expBias: 32, cls: 'volatile' },
      WBTC: { globalIndex: 17, expBias: 32, cls: 'volatile' },
      CBBTC: { globalIndex: 18, expBias: 32, cls: 'volatile' },
      BNB: { globalIndex: 19, expBias: 32, cls: 'volatile' },
      XAUT: { globalIndex: 20, expBias: 32, cls: 'volatile' },
      PAXG: { globalIndex: 21, expBias: 32, cls: 'volatile' },
      INTC: { globalIndex: 24, expBias: 32, cls: 'volatile' },
      AMD: { globalIndex: 25, expBias: 32, cls: 'volatile' },
      NVDA: { globalIndex: 26, expBias: 32, cls: 'volatile' },
      ASML: { globalIndex: 27, expBias: 32, cls: 'volatile' },
      SPCX: { globalIndex: 28, expBias: 32, cls: 'volatile' },
      AVGO: { globalIndex: 29, expBias: 32, cls: 'volatile' },
      TSLA: { globalIndex: 30, expBias: 32, cls: 'volatile' },
      MSFT: { globalIndex: 31, expBias: 32, cls: 'volatile' },
      ORCL: { globalIndex: 32, expBias: 32, cls: 'volatile' },
      META: { globalIndex: 33, expBias: 32, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v3',
    role: 'primary',
    oracle: '0x0bef57B54631004Efc83636678cd95884C772ad4',
    lanesPerSlot: 10,
    domainName: 'BTR ExternalOracleV3',
    feeds: {
      USDT: { globalIndex: 0, expBias: 34, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 34, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 34, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 34, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 34, cls: 'stable', ref: true },
      EURC: { globalIndex: 10, expBias: 30, cls: 'fx' },
      QCAD: { globalIndex: 11, expBias: 30, cls: 'fx' },
      AUDF: { globalIndex: 12, expBias: 30, cls: 'fx' },
      JPYC: { globalIndex: 13, expBias: 30, cls: 'fx' },
      KRW1: { globalIndex: 14, expBias: 30, cls: 'fx' },
      WETH: { globalIndex: 20, expBias: 47, cls: 'volatile' },
      WBTC: { globalIndex: 21, expBias: 47, cls: 'volatile' },
      CBBTC: { globalIndex: 22, expBias: 47, cls: 'volatile' },
      BNB: { globalIndex: 23, expBias: 47, cls: 'volatile' },
      XAUT: { globalIndex: 24, expBias: 47, cls: 'volatile' },
      PAXG: { globalIndex: 25, expBias: 47, cls: 'volatile' },
      INTC: { globalIndex: 30, expBias: 43, cls: 'volatile' },
      AMD: { globalIndex: 31, expBias: 43, cls: 'volatile' },
      NVDA: { globalIndex: 32, expBias: 43, cls: 'volatile' },
      ASML: { globalIndex: 33, expBias: 43, cls: 'volatile' },
      SPCX: { globalIndex: 34, expBias: 43, cls: 'volatile' },
      AVGO: { globalIndex: 35, expBias: 43, cls: 'volatile' },
      TSLA: { globalIndex: 36, expBias: 43, cls: 'volatile' },
      MSFT: { globalIndex: 37, expBias: 43, cls: 'volatile' },
      ORCL: { globalIndex: 38, expBias: 43, cls: 'volatile' },
      META: { globalIndex: 39, expBias: 43, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v3',
    role: 'reference',
    oracle: '0x8523ce6EBc563b1C69aAE7558Eb775DfEE89Fbd0',
    lanesPerSlot: 10,
    domainName: 'BTR ExternalOracleV3',
    feeds: {
      USDT: { globalIndex: 0, expBias: 34, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 34, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 34, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 34, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 34, cls: 'stable', ref: true },
      EURC: { globalIndex: 10, expBias: 30, cls: 'fx' },
      QCAD: { globalIndex: 11, expBias: 30, cls: 'fx' },
      AUDF: { globalIndex: 12, expBias: 30, cls: 'fx' },
      JPYC: { globalIndex: 13, expBias: 30, cls: 'fx' },
      KRW1: { globalIndex: 14, expBias: 30, cls: 'fx' },
      WETH: { globalIndex: 20, expBias: 47, cls: 'volatile' },
      WBTC: { globalIndex: 21, expBias: 47, cls: 'volatile' },
      CBBTC: { globalIndex: 22, expBias: 47, cls: 'volatile' },
      BNB: { globalIndex: 23, expBias: 47, cls: 'volatile' },
      XAUT: { globalIndex: 24, expBias: 47, cls: 'volatile' },
      PAXG: { globalIndex: 25, expBias: 47, cls: 'volatile' },
      INTC: { globalIndex: 30, expBias: 43, cls: 'volatile' },
      AMD: { globalIndex: 31, expBias: 43, cls: 'volatile' },
      NVDA: { globalIndex: 32, expBias: 43, cls: 'volatile' },
      ASML: { globalIndex: 33, expBias: 43, cls: 'volatile' },
      SPCX: { globalIndex: 34, expBias: 43, cls: 'volatile' },
      AVGO: { globalIndex: 35, expBias: 43, cls: 'volatile' },
      TSLA: { globalIndex: 36, expBias: 43, cls: 'volatile' },
      MSFT: { globalIndex: 37, expBias: 43, cls: 'volatile' },
      ORCL: { globalIndex: 38, expBias: 43, cls: 'volatile' },
      META: { globalIndex: 39, expBias: 43, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v5',
    role: 'primary',
    oracle: '0x842c2736F072A8A7b523D23bd3Ef21F21AC24d5C',
    lanesPerSlot: 8,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      USDT: { globalIndex: 0, expBias: 28, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 28, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 28, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 28, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 28, cls: 'stable', ref: true },
      EURC: { globalIndex: 8, expBias: 29, cls: 'fx' },
      QCAD: { globalIndex: 9, expBias: 28, cls: 'fx' },
      AUDF: { globalIndex: 10, expBias: 28, cls: 'fx' },
      JPYC: { globalIndex: 11, expBias: 21, cls: 'fx' },
      KRW1: { globalIndex: 12, expBias: 18, cls: 'fx' },
      WETH: { globalIndex: 16, expBias: 40, cls: 'volatile' },
      WBTC: { globalIndex: 17, expBias: 45, cls: 'volatile' },
      CBBTC: { globalIndex: 18, expBias: 45, cls: 'volatile' },
      BNB: { globalIndex: 19, expBias: 38, cls: 'volatile' },
      XAUT: { globalIndex: 20, expBias: 40, cls: 'volatile' },
      PAXG: { globalIndex: 21, expBias: 40, cls: 'volatile' },
      INTC: { globalIndex: 24, expBias: 35, cls: 'volatile' },
      AMD: { globalIndex: 25, expBias: 37, cls: 'volatile' },
      NVDA: { globalIndex: 26, expBias: 36, cls: 'volatile' },
      ASML: { globalIndex: 27, expBias: 39, cls: 'volatile' },
      SPCX: { globalIndex: 28, expBias: 35, cls: 'volatile' },
      AVGO: { globalIndex: 32, expBias: 37, cls: 'volatile' },
      TSLA: { globalIndex: 33, expBias: 37, cls: 'volatile' },
      MSFT: { globalIndex: 34, expBias: 37, cls: 'volatile' },
      ORCL: { globalIndex: 35, expBias: 35, cls: 'volatile' },
      META: { globalIndex: 36, expBias: 37, cls: 'volatile' },
    },
  },
  {
    chainId: 5042002,
    wire: 'v5',
    role: 'reference',
    oracle: '0xC17920b2cC4Ac028c7F8bdB46E952Fb2d2a172a6',
    lanesPerSlot: 8,
    domainName: 'BTR ExternalOracleV4',
    feeds: {
      USDT: { globalIndex: 0, expBias: 28, cls: 'stable' },
      USDS: { globalIndex: 1, expBias: 28, cls: 'stable' },
      USD1: { globalIndex: 2, expBias: 28, cls: 'stable' },
      PYUSD: { globalIndex: 3, expBias: 28, cls: 'stable' },
      'USDC-USD': { globalIndex: 4, expBias: 28, cls: 'stable', ref: true },
      EURC: { globalIndex: 8, expBias: 29, cls: 'fx' },
      QCAD: { globalIndex: 9, expBias: 28, cls: 'fx' },
      AUDF: { globalIndex: 10, expBias: 28, cls: 'fx' },
      JPYC: { globalIndex: 11, expBias: 21, cls: 'fx' },
      KRW1: { globalIndex: 12, expBias: 18, cls: 'fx' },
      WETH: { globalIndex: 16, expBias: 40, cls: 'volatile' },
      WBTC: { globalIndex: 17, expBias: 45, cls: 'volatile' },
      CBBTC: { globalIndex: 18, expBias: 45, cls: 'volatile' },
      BNB: { globalIndex: 19, expBias: 38, cls: 'volatile' },
      XAUT: { globalIndex: 20, expBias: 40, cls: 'volatile' },
      PAXG: { globalIndex: 21, expBias: 40, cls: 'volatile' },
      INTC: { globalIndex: 24, expBias: 35, cls: 'volatile' },
      AMD: { globalIndex: 25, expBias: 37, cls: 'volatile' },
      NVDA: { globalIndex: 26, expBias: 36, cls: 'volatile' },
      ASML: { globalIndex: 27, expBias: 39, cls: 'volatile' },
      SPCX: { globalIndex: 28, expBias: 35, cls: 'volatile' },
      AVGO: { globalIndex: 32, expBias: 37, cls: 'volatile' },
      TSLA: { globalIndex: 33, expBias: 37, cls: 'volatile' },
      MSFT: { globalIndex: 34, expBias: 37, cls: 'volatile' },
      ORCL: { globalIndex: 35, expBias: 35, cls: 'volatile' },
      META: { globalIndex: 36, expBias: 37, cls: 'volatile' },
    },
  },
];

/** Lane symbol -> the on-chain feed name (`feedIds` key in the venue record). */
export const oracleFeedName = (laneSymbol: string): string =>
  laneSymbol.includes('-') ? laneSymbol : `${laneSymbol}-USDC`;

/** The lane map addressing `oracle` on `chainId`, or null (V1 / unknown oracle has no lanes). */
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
