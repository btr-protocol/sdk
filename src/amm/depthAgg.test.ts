// bun test: the curves entry point (rows and the step ladder are the back's).
import { afterEach, describe, expect, test } from 'bun:test';
import { aggregateDepthCurvesAsync } from '../router/depth.js';
import { buildLeg } from './aimm.js';
import { STABLE_PROFILE, sigmaSeed } from './profiles';

describe('aggregateDepthCurvesAsync (backend SSOT)', () => {
  const wire = {
    mark: 1,
    mid: 1.0001,
    bid: 0.9999,
    ask: 1.0003,
    step: 0.0001,
    bids: [{ price: 0.9998, size: 10, cum: 10 }],
    asks: [{ price: 1.0004, size: 12, cum: 12 }],
    poolCount: 1,
  };

  afterEach(() => {
    // @ts-expect-error restore the real fetch
    globalThis.fetch = undefined;
  });

  test('async variant POSTs /depth and returns the wire book', async () => {
    let path = '';
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string) => {
      path = String(url);
      return { ok: true, headers: new Headers(), text: async () => JSON.stringify(wire) };
    };
    const pools = [
      {
        tag: 'stable',
        state: {
          base: 'USDC',
          legs: {
            USDT: buildLeg(
              'USDT',
              1,
              sigmaSeed('stable'),
              1_000_000,
              1_000_000,
              1_000_000,
              18,
              STABLE_PROFILE,
              0,
            ),
          },
        },
      },
    ];
    const book = await aggregateDepthCurvesAsync(pools, 'USDC', 'USDT', [], {
      base: 'https://q.example/v1',
    });
    expect(path).toBe('https://q.example/v1/depth');
    expect(book?.mid).toBe(1.0001);
    expect(book?.bids.length).toBe(1);
  });

  test('no pool holding the pair resolves to null without a round trip', async () => {
    let called = false;
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, headers: new Headers(), text: async () => JSON.stringify(wire) };
    };
    const pools = [{ tag: 'stable', state: { base: 'USDC', legs: {} } }];
    expect(await aggregateDepthCurvesAsync(pools, 'FOO', 'BAR', [])).toBeNull();
    expect(called).toBe(false);
  });
});
