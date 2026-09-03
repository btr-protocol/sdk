// bun test: route-composed depth is backend SSOT (hub pairs via POST /v1/depth).
import { afterEach, describe, expect, test } from 'bun:test';
import {
  aggregatePairDepth,
  aggregatePairDepthAsync,
  aggregateRouteDepthCurves,
} from './depthRoute.js';
import type { NamedPool } from './router.js';

const wire = {
  mark: 1,
  mid: 1.0001,
  bid: 0.9999,
  ask: 1.0003,
  bid_net: 0.9998,
  ask_net: 1.0004,
  step: 0.0001,
  bids: [{ price: 0.9998, size: 10, cum: 10 }],
  asks: [{ price: 1.0004, size: 12, cum: 12 }],
  poolCount: 1,
};

const pools = (): NamedPool[] => [
  {
    tag: 'core',
    state: {
      base: 'USDC',
      legs: {},
    },
  },
];

afterEach(() => {
  // @ts-expect-error restore the real fetch
  globalThis.fetch = undefined;
});

describe('deleted local composition', () => {
  test('sync entry points throw instead of pricing locally', () => {
    expect(() => aggregateRouteDepthCurves()).toThrow();
    expect(() => aggregatePairDepth()).toThrow();
  });
});

describe('aggregatePairDepthAsync', () => {
  test('hub pair POSTs /depth and maps the wire book', async () => {
    let path = '';
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string) => {
      path = String(url);
      return { ok: true, json: async () => wire };
    };
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], {
      base: 'https://q.example/v1',
    });
    expect(path).toBe('https://q.example/v1/depth');
    expect(book?.mid).toBe(1.0001);
    expect(book?.bidNet).toBe(0.9998);
    expect(book?.poolCount).toBe(1);
  });

  test('invert reciprocates the wire book', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => wire });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert: true });
    expect(book?.mid).toBeCloseTo(1 / 1.0001, 12);
    expect(book?.bids.length).toBe(1);
  });

  test('same-token pair resolves to null without a round trip', async () => {
    let called = false;
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, json: async () => wire };
    };
    expect(await aggregatePairDepthAsync(pools(), 'USDC', 'USDC', [])).toBeNull();
    expect(called).toBe(false);
  });
});
