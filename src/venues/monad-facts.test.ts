import { describe, expect, test } from 'bun:test';
import { DEPLOYED_VENUES } from './deployments.generated.js';

// Monad row pinned to the on-chain records an aggregator integration reads (chain 143, core pool,
// factory, six tokens). Verified 2026-10-13 via eth_call: getRiskFlags = 3632 on all six legs,
// isOfficialPool(core) = true, decimals USDC/XAUT0 = 6, cbBTC/WBTC = 8, WMON/WETH = 18.

describe('monad aggregator facts', () => {
  const monad = DEPLOYED_VENUES[143];

  test('monad venue exists', () => {
    expect(monad).toBeDefined();
    expect(monad.chainId).toBe(143);
  });

  test('core pool and factory match the on-chain records', () => {
    expect(monad.contracts.poolFactory).toBe('0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0');
    expect(monad.contracts.ac).toBe('0xbbbbbbb10CD446E774fAFE513Bb2B7669Fe823D5');
    const core = monad.pools.find((p) => p.tag === 'btr-core');
    expect(core?.address).toBe('0xbbbbbbbd7060b1CED79c381eAD40d73FcB9Ae0C6');
  });

  test('btr-core roster covers the six aggregator tokens', () => {
    // pool-v2 lists 13 legs: the six aggregator tokens plus seven stables.
    expect(monad.rosters['btr-core']).toEqual(
      expect.arrayContaining(['USDC', 'WMON', 'CBBTC', 'WBTC', 'WETH', 'XAUT0']),
    );
    expect(monad.rosters['btr-core']).toHaveLength(13);
    expect(monad.tokens).toMatchObject({
      USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
      CBBTC: '0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b',
      WBTC: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
      WETH: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242',
      XAUT0: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071',
    });
  });
});

describe('venue decimals pin', () => {
  // The front refuses a `decimals()` read that disagrees with this table (r2 C-F-2: a relay
  // answering 8 for 6-dp USDC inflated a 100 USDC approval 100x).
  test('monad decimals match the eth_call facts above', () => {
    expect(DEPLOYED_VENUES[143].decimals).toMatchObject({
      USDC: 6,
      XAUT0: 6,
      CBBTC: 8,
      WBTC: 8,
      WMON: 18,
      WETH: 18,
    });
  });

  test('every venue token has an integer decimals pin', () => {
    for (const v of Object.values(DEPLOYED_VENUES))
      for (const s of Object.keys(v.tokens)) expect(Number.isInteger(v.decimals[s])).toBe(true);
  });
});
