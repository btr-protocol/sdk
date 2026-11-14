import { describe, expect, test } from 'bun:test';
import type { Address } from '../eth/types.js';
import {
  type LegMark,
  type LegReaders,
  legMarkUsd,
  lpUsdPerUnit,
  pinBlock,
  readLegLpValues,
  shareIndexWad,
} from './lpValue';

const WAD = 10n ** 18n;
const mk = (usd: number, o: Partial<LegMark> = {}): LegMark => ({
  mark1e18: BigInt(Math.round(usd * 1e6)) * 10n ** 12n,
  internal: false,
  uoa: false,
  halted: false,
  obs: 1000,
  ttlSecs: 600,
  ...o,
});

describe('shareIndexWad', () => {
  test('stored index wins; 0 with liabilities is the legacy 1e12 base; 0 with none is written down', () => {
    expect(shareIndexWad({ liquidityIndexWad: 2n * WAD, liabilities: 5n })).toBe(2n * WAD);
    expect(shareIndexWad({ liquidityIndexWad: 0n, liabilities: 5n })).toBe(10n ** 12n);
    expect(shareIndexWad({ liquidityIndexWad: 0n, liabilities: 0n })).toBe(0n);
  });
});

describe('lpUsdPerUnit', () => {
  test('index x mark', () => {
    expect(lpUsdPerUnit({ liquidityIndexWad: WAD, liabilities: 1n }, mk(0.9998))).toBeCloseTo(
      0.9998,
      6,
    );
    expect(
      lpUsdPerUnit({ liquidityIndexWad: (WAD * 105n) / 100n, liabilities: 1n }, mk(2000)),
    ).toBeCloseTo(2100, 6);
  });
  test('no mark is unknown (null), a written-down leg is a real 0', () => {
    expect(lpUsdPerUnit({ liquidityIndexWad: WAD, liabilities: 1n }, null)).toBeNull();
    expect(lpUsdPerUnit({ liquidityIndexWad: WAD, liabilities: 1n }, mk(0))).toBeNull();
    expect(lpUsdPerUnit({ liquidityIndexWad: 0n, liabilities: 0n }, mk(3))).toBe(0);
  });
  test('internal leg quotes the 1.0 peg, a UOA mark is not a USD price', () => {
    expect(legMarkUsd(mk(0.5, { internal: true }))).toBe(1);
    expect(legMarkUsd(mk(0.5, { uoa: true }))).toBeNull();
  });
});

const POOL = '0x00000000000000000000000000000000000000f0' as Address;
const A = '0x00000000000000000000000000000000000000a1' as Address;
const B = '0x00000000000000000000000000000000000000b2' as Address;
const LPA = '0x00000000000000000000000000000000000000c1' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const NOW = 1500;
const readers = (
  over: Partial<LegReaders> & { marks?: LegReaders['marks'] } = {},
): LegReaders & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    head: async () => ({ number: 77, ts: NOW }),
    asset: async (_p, _pool, t) =>
      ({ liquidityIndexWad: t === A ? WAD : 2n * WAD, liabilities: 1n }) as never,
    marks: async (_p, _pool, t) => {
      calls.push(`marks:${t}`);
      return { primary: mk(1, { obs: 1400 }) };
    },
    lpToken: async (_p, _pool, t) =>
      t === A ? LPA : t === B ? ('0x00000000000000000000000000000000000000c2' as Address) : ZERO,
    ...over,
  };
};

describe('readLegLpValues', () => {
  test('joins index, mark, receipt and the mark observation per token address, all at one block', async () => {
    const out = await readLegLpValues({} as never, POOL, [A, B], readers());
    expect(out[0]).toMatchObject({
      token: A,
      lp: LPA,
      usdPerLp: 1,
      obs: 1400,
      stale: false,
      halted: false,
      peg: false,
      block: 77,
      indexWad: WAD,
    });
    expect(out[1]).toMatchObject({ token: B, usdPerLp: 2, indexWad: 2n * WAD });
  });
  test('an unlisted token (lpToken 0) is all null and its mark is NEVER read (the sdk mark reader would fall back to lane 0)', async () => {
    const r = readers();
    const [u] = await readLegLpValues(
      {} as never,
      POOL,
      ['0x00000000000000000000000000000000000000dd' as Address],
      r,
    );
    expect(u).toMatchObject({
      lp: null,
      indexWad: null,
      markUsd: null,
      usdPerLp: null,
      obs: null,
      stale: null,
      halted: null,
      peg: null,
      block: null,
    });
    expect(r.calls).toEqual([]);
  });
  test('a revert on lpToken is unknown too, not an error', async () => {
    const [u] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({
        lpToken: async () => {
          throw new Error('revert');
        },
      }),
    );
    expect(u!.usdPerLp).toBeNull();
  });
  test('halted and stale marks are flagged, the value stays', async () => {
    const [h] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({ marks: async () => ({ primary: mk(1, { halted: true, obs: 1499 }) }) }),
    );
    expect(h).toMatchObject({ halted: true, stale: false, usdPerLp: 1 });
    const [s] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({ marks: async () => ({ primary: mk(1, { obs: 100, ttlSecs: 600 }) }) }),
    );
    expect(s).toMatchObject({ stale: true, halted: false, obs: 100 });
  });
  test('an INTERNAL-peg leg keeps its number and says peg', async () => {
    const [p] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({ marks: async () => ({ primary: mk(0.5, { internal: true }) }) }),
    );
    expect(p).toMatchObject({ peg: true, markUsd: 1, usdPerLp: 1 });
  });
  test('no readable mark: markUsd/usdPerLp and the mark flags are null, not false', async () => {
    const [n] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({
        marks: async () => {
          throw new Error('no lane');
        },
      }),
    );
    expect(n).toMatchObject({
      lp: LPA,
      indexWad: WAD,
      markUsd: null,
      usdPerLp: null,
      obs: null,
      stale: null,
      halted: null,
      peg: null,
    });
  });
  test('a node that cannot serve the head block gives all-null values', async () => {
    const [n] = await readLegLpValues(
      {} as never,
      POOL,
      [A],
      readers({
        head: async () => {
          throw new Error('nope');
        },
      }),
    );
    expect(n).toMatchObject({ lp: null, usdPerLp: null, block: null });
  });
});

describe('pinBlock', () => {
  test('rewrites latest to the pinned block on eth_call and eth_getStorageAt only', async () => {
    const seen: unknown[][] = [];
    const p = pinBlock(
      {
        request: async (a: { params?: unknown[] }) => {
          seen.push(a.params ?? []);
          return '0x' as never;
        },
      } as never,
      255,
    );
    await p.request({ method: 'eth_call', params: [{}, 'latest'] } as never);
    await p.request({ method: 'eth_getStorageAt', params: ['0x1', '0x2', 'latest'] } as never);
    await p.request({ method: 'eth_getBlockByNumber', params: ['latest', false] } as never);
    expect(seen).toEqual([
      [{}, '0xff'],
      ['0x1', '0x2', '0xff'],
      ['latest', false],
    ]);
  });
});
