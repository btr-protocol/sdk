import { describe, expect, test } from 'bun:test';
import type { Address } from '../eth/types.js';
import { type LegMark, legMarkUsd, lpUsdPerUnit, readLegLpValues, shareIndexWad } from './lpValue';

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

describe('readLegLpValues', () => {
  test('joins index, mark and receipt per token address', async () => {
    const A = '0x00000000000000000000000000000000000000a1' as Address;
    const B = '0x00000000000000000000000000000000000000b2' as Address;
    const out = await readLegLpValues(
      {} as never,
      '0x00000000000000000000000000000000000000f0' as Address,
      [A, B],
      1500,
      {
        asset: async (_p, _pool, t) =>
          ({ liquidityIndexWad: t === A ? WAD : 2n * WAD, liabilities: 1n }) as never,
        marks: async (_p, _pool, t) =>
          t === A ? { primary: mk(1, { obs: 100 }) } : Promise.reject(new Error('no lane')),
        lpToken: async (_p, _pool, t) =>
          (t === A
            ? '0x00000000000000000000000000000000000000c1'
            : '0x00000000000000000000000000000000000000c2') as Address,
      },
    );
    expect(out[0]).toMatchObject({ token: A, usdPerLp: 1, stale: true, indexWad: WAD });
    expect(out[1]).toMatchObject({ token: B, markUsd: null, usdPerLp: null, indexWad: 2n * WAD });
  });
});
