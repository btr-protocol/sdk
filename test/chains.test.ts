import { describe, expect, test } from 'bun:test';
import { withChainId } from '../src/api.js';
import { BTR_CHAINS, chainVenue, defaultChainId, deployedChainIds } from '../src/venues/index.js';

describe('served chains', () => {
  test('lists BNB then Arc, live iff a record exists', () => {
    expect(BTR_CHAINS).toEqual([
      { chainId: 56, slug: 'bnb', status: 'pending' },
      { chainId: 5042002, slug: 'arc', status: 'live' },
    ]);
    expect(deployedChainIds()).toEqual([5042002]);
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
