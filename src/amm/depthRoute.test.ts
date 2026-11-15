// bun test: route-composed depth is backend SSOT (hub pairs via POST /v1/depth).
import { afterEach, describe, expect, test } from 'bun:test';
import { aggregateDepthCurvesAsync, aggregatePairDepthAsync } from '../router/depth.js';
import type { NamedPool } from '../router/route.js';

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

const pools = (): NamedPool[] => [
  {
    tag: 'core',
    state: {
      base: 'USDC',
      legs: { USDT: {} as never },
    },
  },
];

afterEach(() => {
  // @ts-expect-error restore the real fetch
  globalThis.fetch = undefined;
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
    expect(book?.bidNet).toBe(0.9999);
    expect(book?.poolCount).toBe(1);
  });

  test('invert sends from/to swapped and never flips the answer', async () => {
    const bodies: { from: string; to: string }[] = [];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => wire };
    };
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert: true });
    expect(bodies[0].from).toBe('USDT');
    expect(bodies[0].to).toBe('USDC');
    expect(book?.mid).toBe(1.0001);
    expect(book?.bids).toEqual([{ price: 0.9998, size: 10, cum: 10 }]);
    expect(book?.asks).toEqual([{ price: 1.0004, size: 12, cum: 12 }]);
  });

  test('step is sent only when provided', async () => {
    const bodies: Record<string, unknown>[] = [];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => wire };
    };
    await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
    await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { step: 0.0002 });
    await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert: true, step: 0.0005 });
    expect('step' in bodies[0]).toBe(false);
    expect(bodies[1].step).toBe(0.0002);
    expect(bodies[2].step).toBe(0.0005);
  });

  test('a bad step throws RangeError and sends nothing', async () => {
    let calls = 0;
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => wire };
    };
    for (const step of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1e-4]) {
      await expect(
        aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { step }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        aggregateDepthCurvesAsync(pools(), 'USDC', 'USDT', [], { step }),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(calls).toBe(0);
  });

  test('malformed rows are dropped', async () => {
    const bad = {
      ...wire,
      bids: [
        { price: 0.99, size: 1, cum: 1 },
        { price: Number.NaN, size: 1, cum: 2 },
        { price: 0.98, size: '3', cum: 3 },
        { price: 0.97, size: 1 },
        null,
      ],
    };
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => bad });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
    expect(book?.bids).toEqual([{ price: 0.99, size: 1, cum: 1 }]);
  });

  test('curves entry: validated wire, swapped body on invert', async () => {
    const bodies: { from: string; to: string }[] = [];
    const raw = {
      ...wire,
      steps: 'x',
      bids: [{ price: 0.9998, size: 10, cum: 10, tail: 'false' }, { price: 1 }],
      bid_end: { price: 1, size: 1, kind: 'weird' },
    };
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => raw };
    };
    const w = await aggregateDepthCurvesAsync(pools(), 'USDC', 'USDT', [], { invert: true });
    expect(bodies[0]).toMatchObject({ from: 'USDT', to: 'USDC' });
    expect(w?.steps).toBeUndefined();
    expect(w?.bid_end).toBeUndefined();
    expect(w?.bids).toEqual([{ price: 0.9998, size: 10, cum: 10 }]);
  });

  test('new back: fields carry through; fixture and body differ per orientation', async () => {
    const book = (px: number, steps: number[], step: number) => ({
      ...wire,
      mid: px,
      step,
      steps,
      bids: [
        {
          price: px - 0.0001,
          size: 10,
          cum: 10,
          cum_base: 10,
          cum_quote: 9.99,
          worst: px - 0.0002,
        },
        { price: px - 0.01, size: 5, cum: 15, cum_base: 5, cum_quote: 4.9, tail: true },
      ],
      asks: [{ price: px + 0.0001, size: 12, cum: 12 }],
      bid_end: { price: px - 0.01, size: 15, kind: 'reached_cap' },
      ask_end: null,
    });
    const bodies: { from: string; to: string }[] = [];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      return {
        ok: true,
        json: async () =>
          b.from === 'USDC' ? book(1.0001, [0.0001, 0.0002], 0.0002) : book(0.9999, [0.5, 1], 1),
      };
    };
    const fwd = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
    const inv = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert: true });
    expect(bodies).toEqual([
      expect.objectContaining({ from: 'USDC', to: 'USDT' }),
      expect.objectContaining({ from: 'USDT', to: 'USDC' }),
    ]);
    expect(fwd?.mid).toBe(1.0001);
    expect(fwd?.ladder).toEqual({ steps: [0.0001, 0.0002], defaultIdx: 1 });
    expect(inv?.mid).toBe(0.9999);
    expect(inv?.steps).toEqual([0.5, 1]);
    expect(inv?.ladder).toEqual({ steps: [0.5, 1], defaultIdx: 1 });
    expect(inv?.bids[0]).toEqual({
      price: 0.9998,
      size: 10,
      cum: 10,
      cum_base: 10,
      cum_quote: 9.99,
      worst: 0.9997,
    });
    expect(inv?.bids[1]).toMatchObject({ tail: true, cum_base: 5, cum_quote: 4.9 });
    expect(inv?.bids[0].tail).toBeUndefined();
    expect(inv?.bid_end).toEqual({ price: 0.9899, size: 15, kind: 'reached_cap' });
    expect(inv?.ask_end).toBeNull();
  });

  test('malformed new fields are absent, never guessed', async () => {
    const bad = {
      ...wire,
      step: 0.0003,
      steps: [0.0001, 0.0002],
      bids: [{ price: 0.9, size: 1, cum: 1, tail: 'false', worst: 'x', cum_base: Number.NaN }],
      bid_end: { price: 0.9, size: 1, kind: 'weird' },
      ask_end: { price: 1.1, size: 1 },
    };
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => bad });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
    expect(book?.bids[0]).toEqual({ price: 0.9, size: 1, cum: 1 });
    expect(book?.bid_end).toBeUndefined();
    expect(book?.ask_end).toBeUndefined();
    expect(book?.ladder).toBeNull(); // step off the ladder: no index 0 guess
    expect(book?.steps).toEqual([0.0001, 0.0002]);
    for (const steps of ['x', [0.1, 'a'], [0, 1], { 0: 1 }]) {
      // @ts-expect-error stub fetch
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...bad, steps }) });
      const b = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
      expect(b?.steps).toBeUndefined();
      expect(b?.ladder).toBeNull();
    }
  });

  test('empty steps: kept as the marker, no ladder', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ...wire, steps: [] }) });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', []);
    expect(book?.steps).toEqual([]);
    expect(book?.ladder).toBeNull();
  });

  test('old back: no steps, no ends, ladder null', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => wire });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], {});
    expect(book?.steps).toBeUndefined();
    expect(book?.ladder).toBeNull();
    expect(book?.bid_end).toBeUndefined();
    expect(book?.asks[0].tail).toBeUndefined();
  });

  test('gate fields carry through, plain and inverted', async () => {
    const gated = { ...wire, swap_gated: true, open_path: false, reason: 'future_reason' };
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => gated });
    for (const invert of [false, true]) {
      const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert });
      expect(book?.swap_gated).toBe(true);
      expect(book?.open_path).toBe(false);
      expect(book?.reason).toBe('future_reason');
    }
  });

  test('older back: gate fields absent, reason null', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => wire });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], {});
    expect(book?.swap_gated).toBeUndefined();
    expect(book?.open_path).toBeUndefined();
    expect(book?.reason).toBeNull();
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
