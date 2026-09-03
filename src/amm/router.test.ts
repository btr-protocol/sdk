import { describe, expect, test } from 'bun:test';
import type { PoolAsset } from '../pool/index';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { type PoolState, buildLeg } from './aimm';
import { poolStateFrom } from './index';
import { type NamedPool, aggregateDepth, enumerateRoutes, quoteRoute, rankSwap } from './router';

const BASE = 'USDC';

// Stable-core: USDC hub + USDT spoke. Volatile-core: USDC hub + USDT + BTCB. USDT lives in BOTH
// pools ⇒ a USDC↔USDT swap can split; BTCB only in the volatile pool.
function pools(): NamedPool[] {
  const usdtStable = buildLeg(
    'USDT',
    1,
    sigmaSeed('stable'),
    1_000_000,
    1_000_000,
    1_000_000,
    18,
    STABLE_PROFILE,
  );
  const usdtVol = buildLeg(
    'USDT',
    1,
    sigmaSeed('volatile'),
    800_000,
    800_000,
    800_000,
    18,
    VOLATILE_PROFILE,
  );
  const btcb = buildLeg(
    'BTCB',
    62_000,
    sigmaSeed('volatile'),
    9.4,
    9.4,
    9.4 * 62_000,
    18,
    VOLATILE_PROFILE,
  );
  const stable: PoolState = { base: BASE, legs: { USDT: usdtStable } };
  const volatile: PoolState = { base: BASE, legs: { USDT: usdtVol, BTCB: btcb } };
  return [
    { tag: 'stable', addr: '0x0000000000000000000000000000000000000001', state: stable },
    { tag: 'volatile', addr: '0x0000000000000000000000000000000000000002', state: volatile },
  ];
}

describe('enumerateRoutes', () => {
  test('USDC→USDT yields a direct route in each pool that holds the pair', () => {
    const rs = enumerateRoutes(pools(), BASE, 'USDT');
    expect(rs.length).toBe(2);
    expect(rs.every((r) => r.hops === 1)).toBe(true);
    expect(new Set(rs.map((r) => r.legs[0].poolTag))).toEqual(new Set(['stable', 'volatile']));
  });

  test('USDT→BTCB yields the direct volatile route + a cross-pool route via the USDC hub', () => {
    const rs = enumerateRoutes(pools(), 'USDT', 'BTCB');
    const direct = rs.filter((r) => r.hops === 1);
    const cross = rs.filter((r) => r.hops === 2);
    expect(direct.length).toBe(1); // only the volatile pool holds both USDT and BTCB
    expect(direct[0].legs[0].poolTag).toBe('volatile');
    expect(cross.length).toBeGreaterThanOrEqual(1);
    // cross must transit the shared hub USDC and end in the volatile pool
    expect(cross[0].tokens).toEqual(['USDT', 'USDC', 'BTCB']);
    expect(cross[0].legs[1].poolTag).toBe('volatile');
  });

  test('same token in/out yields no routes', () => {
    expect(enumerateRoutes(pools(), BASE, BASE)).toEqual([]);
  });

  test('3-hop when two pools share no token, via a bridge pool', () => {
    const aLeg = buildLeg('AAA', 1, sigmaSeed('stable'), 1e6, 1e6, 1e6, 18, STABLE_PROFILE);
    const xLegA = buildLeg('XXX', 1, sigmaSeed('stable'), 1e6, 1e6, 1e6, 18, STABLE_PROFILE);
    const xLegM = buildLeg('XXX', 1, sigmaSeed('stable'), 1e6, 1e6, 1e6, 18, STABLE_PROFILE);
    const yLegM = buildLeg('YYY', 1, sigmaSeed('stable'), 1e6, 1e6, 1e6, 18, STABLE_PROFILE);
    const yLegB = buildLeg('YYY', 1, sigmaSeed('volatile'), 1e6, 1e6, 1e6, 18, VOLATILE_PROFILE);
    const bLeg = buildLeg('BBB', 1, sigmaSeed('volatile'), 1e6, 1e6, 1e6, 18, VOLATILE_PROFILE);
    const three: NamedPool[] = [
      { tag: 'pA', state: { base: 'AAA', legs: { XXX: xLegA } } },
      { tag: 'pM', state: { base: 'XXX', legs: { YYY: yLegM } } },
      { tag: 'pB', state: { base: 'BBB', legs: { YYY: yLegB } } },
    ];
    // silence unused
    void aLeg;
    void xLegM;
    void bLeg;
    const rs = enumerateRoutes(three, 'AAA', 'BBB');
    expect(rs.some((r) => r.hops === 1)).toBe(false);
    expect(rs.some((r) => r.hops === 2)).toBe(false);
    const hop3 = rs.filter((r) => r.hops === 3);
    expect(hop3.length).toBeGreaterThanOrEqual(1);
    expect(hop3[0].tokens[0]).toBe('AAA');
    expect(hop3[0].tokens[3]).toBe('BBB');
  });
});

describe('deleted local ranking', () => {
  test('quoteRoute / rankSwap / aggregateDepth throw: rank over POST /v1/route', () => {
    expect(() => quoteRoute()).toThrow();
    expect(() => rankSwap()).toThrow();
    expect(() => aggregateDepth()).toThrow();
  });
});

describe('poolStateFrom (on-chain bigint reads → PoolState)', () => {
  const asset = (symbol: string, decimals: number, res: bigint, liab: bigint): PoolAsset => ({
    token: '0x0000000000000000000000000000000000000003',
    symbol,
    name: symbol,
    decimals,
    reserves: res,
    liabilities: liab,
    coverage: 0n,
  });

  test('base carries no leg; spokes convert via their decimals; feedless spokes skipped', () => {
    const assets = [
      asset(BASE, 6, 1_000_000_000_000n, 900_000_000_000n),
      asset('USDT', 18, 500_000n * 10n ** 18n, 400_000n * 10n ** 18n),
      asset('WOOF', 18, 10n ** 18n, 10n ** 18n),
    ];
    const state = poolStateFrom(assets, BASE, (sym) =>
      sym === 'USDT' ? { twap: 1, sigma: sigmaSeed('stable'), profile: STABLE_PROFILE } : undefined,
    );
    expect(state.base).toBe(BASE);
    expect(Object.keys(state.legs)).toEqual(['USDT']);
    expect(state.legs.USDT.res).toBeCloseTo(500_000, 6);
    expect(state.legs.USDT.liab).toBeCloseTo(400_000, 6);
    expect(state.legs.USDT.baseRes).toBeCloseTo(1_000_000, 6);
    expect(state.legs.USDT.decimals).toBe(18);
    expect(state.legs.USDT.kappaCovBps).toBe(0);
    // the converted state carries the leg for the backend wire build
    expect(state.legs.USDT.profile.curve.m).toBeGreaterThan(0);
  });
});
