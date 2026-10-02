import { describe, expect, test } from 'bun:test';
import { withChainId } from '../src/api.js';
import { CHAINS, getAllRpcs } from '../src/eth/chains.js';
import { CHAIN_RPCS } from '../src/eth/rpcs.generated.js';
import {
  BTR_CHAINS,
  chainVenue,
  defaultChainId,
  deployedChainIds,
  lpReceipt,
  lpToken,
} from '../src/venues/index.js';

describe('served chains', () => {
  test('lists BNB, Arc, Monad, live iff a record exists', () => {
    expect(BTR_CHAINS).toEqual([
      { chainId: 56, slug: 'bnb', status: 'pending' },
      { chainId: 5042002, slug: 'arc', status: 'live' },
      { chainId: 143, slug: 'monad', status: 'live' },
    ]);
    expect(deployedChainIds()).toEqual([143, 5042002]);
  });

  test('every deployed chain is a served chain', () => {
    const served = BTR_CHAINS.map((c) => c.chainId);
    for (const id of deployedChainIds()) expect(served).toContain(id);
  });

  test('default = first live chain', () => {
    expect(defaultChainId()).toBe(5042002);
  });

  test('pending chain throws naming its ceremony', () => {
    expect(() => chainVenue(56)).toThrow(/56 \(bnb\) is served but pending its ceremony record/);
    expect(() => chainVenue(1)).toThrow(/No SDK record exists/);
  });

  test('withChainId appends the chain', () => {
    expect(withChainId('/v1/pools', 56)).toBe('/v1/pools?chainId=56');
    expect(withChainId('/v1/pools?x=1', 5042002)).toBe('/v1/pools?x=1&chainId=5042002');
  });
});

describe('chain registry', () => {
  // The owner's list: BNB, Monad, X Layer, Base, Avalanche, Arbitrum, Ethereum, Robinhood, Arc
  // (mainnet + testnet), Polygon, HyperEVM; plus local Anvil. A chain not here is not offered.
  const LISTED = [1, 56, 137, 143, 196, 999, 4663, 5042, 5042002, 8453, 42161, 43114, 31337];

  test('is the listed chains plus Anvil, and covers every served chain', () => {
    expect(
      Object.keys(CHAINS)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...LISTED].sort((a, b) => a - b));
    for (const c of BTR_CHAINS) expect(CHAINS[c.chainId]).toBeDefined();
  });

  // The list goes to the wallet verbatim and is the browser's read endpoint: the top rows of the
  // one list (chains.json), so no chain carries a URL of its own here.
  test('one or two https RPCs per chain, all from the one list (Anvil: localhost)', () => {
    for (const c of Object.values(CHAINS)) {
      const urls = getAllRpcs(c.id);
      expect(urls.length).toBeGreaterThanOrEqual(1);
      expect(urls.length).toBeLessThanOrEqual(2);
      for (const u of urls) {
        expect(u).toMatch(c.id === 31337 ? /^http:\/\/localhost:/ : /^https:\/\//);
        if (c.id !== 31337) expect(CHAIN_RPCS[c.id]).toContain(u);
      }
    }
  });
});

describe('quote posts keep the chain', () => {
  test('a base carrying ?chainId= posts the path before it', async () => {
    const { routeAsync } = await import('../src/amm/aimm.js');
    const real = globalThis.fetch;
    let seen = '';
    globalThis.fetch = (async (url: string) => {
      seen = url;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await routeAsync({} as never, withChainId('/api/v1/', 56));
    } finally {
      globalThis.fetch = real;
    }
    expect(seen).toBe('/api/v1/route?chainId=56');
  });
});

test('lpToken: B{code}-{SYM} on a BTR core, LP-{SYM} elsewhere', () => {
  expect(lpToken(chainVenue(143).lp['btr-core'], 'USDC')).toEqual({
    symbol: 'BC-USDC',
    name: 'BTR Core Pool USDC',
  });
  expect(lpToken(undefined, 'USDC')).toEqual({ symbol: 'LP-USDC' });
});

test('lpReceipt: SYM is the manifest listed symbol, key matched case-insensitively', () => {
  expect(lpReceipt(143, 'btr-core', 'WMON')).toEqual({
    symbol: 'BC-WMON',
    name: 'BTR Core Pool WMON',
  });
  expect(lpReceipt(143, 'btr-core', 'XAUT0').symbol).toBe('BC-XAUT');
  expect(lpReceipt(143, 'btr-core', 'cbBTC').symbol).toBe('BC-cbBTC');
  expect(lpReceipt(5042002, 'btr-stable-core', 'USDCB')).toEqual({
    symbol: 'BS-USDC',
    name: 'BTR Stable Pool USDC',
  });
  expect(lpReceipt(5042002, 'btr-fx-core', 'EURC').symbol).toBe('BF-EURC');
  expect(lpReceipt(5042002, 'btr-nope', 'USDCB').symbol).toBe('LP-USDC');
  expect(lpReceipt(1, 'btr-core', 'USDC')).toEqual({ symbol: 'LP-USDC' });
});
