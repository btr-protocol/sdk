// bun test: step ladder and the curves entry point (rows are the back's).
import { afterEach, describe, expect, test } from 'bun:test';
import { aggregateDepthCurvesAsync, niceStep, stepLadder } from '../router/depth.js';
import { buildLeg } from './aimm.js';
import { STABLE_PROFILE, sigmaSeed } from './profiles';

describe('niceStep', () => {
  test('snaps to 1/2/5 ladder (near)', () => {
    expect(niceStep(62_700 * 0.00015)).toBe(10); // 9.4 → 10
    expect(niceStep(0.00013)).toBe(0.0001);
    expect(niceStep(9.4, 'down')).toBe(5);
    expect(niceStep(9.4, 'up')).toBe(10);
  });
});

describe('stepLadder', () => {
  test('BTC price yields coarse round steps ⊇ {10,50}', () => {
    const { steps, defaultIdx } = stepLadder(62_700);
    for (const s of [10, 50]) expect(steps).toContain(s);
    expect(steps[defaultIdx]).toBe(10); // ~1.6bps
  });
  test('$1 stable pair yields sub-cent steps', () => {
    const { steps } = stepLadder(1.0);
    expect(steps.every((s) => s < 0.01)).toBe(true);
  });
});

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
      return { ok: true, json: async () => wire };
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
      return { ok: true, json: async () => wire };
    };
    const pools = [{ tag: 'stable', state: { base: 'USDC', legs: {} } }];
    expect(await aggregateDepthCurvesAsync(pools, 'FOO', 'BAR', [])).toBeNull();
    expect(called).toBe(false);
  });
});
