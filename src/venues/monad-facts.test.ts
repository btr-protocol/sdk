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
    expect(monad.contracts.poolFactory).toBe('0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF');
    expect(monad.contracts.ac).toBe('0xbbbbbbbb3473f8433A8A1a044E8a102D39dC8779');
    const core = monad.pools.find((p) => p.tag === 'btr-core');
    expect(core?.address).toBe('0xbbbbbbb04f5b762A4CdD1d89E341e2537e3267e4');
  });

  test('btr-core roster = 11 v2 legs, incl. the six aggregator tokens', () => {
    expect(monad.rosters['btr-core']).toEqual([
      'USDC',
      'MUSD',
      'AUSD',
      'GHO',
      'USDT0',
      'WMON',
      'CBBTC',
      'WBTC',
      'WETH',
      'XAUT0',
      'USDE',
    ]);
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
