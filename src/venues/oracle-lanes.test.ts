import { describe, expect, test } from 'bun:test';
import { ORACLE_LANE_MAPS, oracleFeedName, oracleLaneMap } from './oracle-lanes.generated';

// The Pool v2 PoolFactory (wire 9) and the v1 venue oracle (wire 8) are both on chain 143, and the
// front picks a store by the push's wire: the join is by address, so each must resolve to its own map.
const V2_FACTORY = '0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0';
const V1_ORACLE = '0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF';

describe('oracle lane maps', () => {
  test('wire 9 (Pool v2) resolves to the v2 PoolFactory, not the v1 venue oracle', () => {
    const v2 = oracleLaneMap(143, V2_FACTORY);
    expect(v2?.wire).toBe('v9');
    expect(v2?.role).toBe('primary');
    expect(v2?.lanesPerSlot).toBe(64);
    expect(oracleLaneMap(143, V1_ORACLE)?.wire).toBe('v8');
  });

  test('wire 9 lanes carry their deploy-record index and feed id', () => {
    const feeds = oracleLaneMap(143, V2_FACTORY)?.feeds ?? {};
    expect(feeds.WETH?.globalIndex).toBe(4);
    expect(feeds.WETH?.feedId).toBe(
      '0x0000000000000000000000000000000000000000000000000616a96484500000',
    );
    expect(feeds['USDC-USD']?.ref).toBe(true);
    expect(oracleFeedName('WETH')).toBe('WETH-USDC');
    expect(oracleFeedName('USDC-USD')).toBe('USDC-USD');
  });

  test('wire 9 lane table: leg, NXR feed, index and ticker id for all 13 legs', () => {
    // dex-evm lane list (143-v2.lanes.json): the ticker id is what the signers sign under.
    const table: Array<[string, number, string, string]> = [
      ['USDC-USD', 0, 'USDC-USD', '452687840255410176'],
      ['WMON', 1, 'MON-USDC', '457965716382941184'],
      ['CBBTC', 2, 'BTC-USDC', '436635190804086784'],
      ['WBTC', 3, 'WBTC-USDC', '453457718709059584'],
      ['WETH', 4, 'ETH-USDC', '438724262896861184'],
      ['XAUT0', 5, 'XAUT-USDC', '454557230336835584'],
      ['MUSD', 6, 'MUSD-USDC', '458845325685161984'],
      ['AUSD', 7, 'AUSD-USDC', '432896851269648384'],
      ['GHO', 8, 'GHO-USDC', '432566997781315584'],
      ['USDT0', 9, 'USDT-USDC', '451698500104617984'],
      ['USDE', 10, 'USDE-USDC', '438284458245750784'],
      ['USDAT', 11, 'USDAT-USDC', '459285130336272384'],
      ['SYRUPUSDC', 12, 'SYRUPUSDC-USDC', '458075667545718784'],
    ];
    const feeds = oracleLaneMap(143, V2_FACTORY)?.feeds ?? {};
    expect(Object.keys(feeds).sort()).toEqual(table.map(([leg]) => leg).sort());
    for (const [leg, gi, feed, ticker] of table) {
      expect(feeds[leg]?.globalIndex).toBe(gi);
      expect(feeds[leg]?.feed).toBe(feed);
      expect(feeds[leg]?.tickerId).toBe(ticker);
      // bytes32(uint256(ticker)): the id is derived, never looked up in the venue record.
      expect(feeds[leg]?.feedId).toBe(`0x${BigInt(ticker).toString(16).padStart(64, '0')}`);
    }
  });

  test('wire 9 lane indices are unique and fit one 64-lane mask', () => {
    const gis = Object.values(oracleLaneMap(143, V2_FACTORY)?.feeds ?? {}).map(
      (f) => f.globalIndex,
    );
    expect(new Set(gis).size).toBe(gis.length);
    expect(Math.max(...gis)).toBeLessThan(64);
  });

  test('every map keys on its own chain and address', () => {
    for (const m of ORACLE_LANE_MAPS) expect(oracleLaneMap(m.chainId, m.oracle)).toBe(m);
  });
});
