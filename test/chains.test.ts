import { describe, expect, test } from 'bun:test';
import { withChainId } from '../src/api.js';
import {
  BTR_CHAINS,
  chainVenue,
  defaultChainId,
  deployedChainIds,
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
