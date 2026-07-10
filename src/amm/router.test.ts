import { describe, expect, test } from 'bun:test';
import type { PoolAsset } from '../pool/index';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { type PoolState, buildLeg, quoteExactIn } from './aimm';
import { poolStateFrom } from './index';
import { type NamedPool, aggregateDepth, enumerateRoutes, quoteRoute, rankSwap } from './router';

const BASE = 'USDC';

function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error('expected value');
  return v;
}

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
});

describe('quoteRoute', () => {
  test('cross route composes leg outputs sequentially', () => {
    const p = pools();
    const cross = must(enumerateRoutes(p, 'USDT', 'BTCB').find((r) => r.hops === 2));
    const q = quoteRoute(p, cross, 10_000);
    expect(q.fills.length).toBe(2);
    // leg2 input equals leg1 output
    expect(q.fills[1].amountIn).toBeCloseTo(q.fills[0].amountOut, 6);
    expect(q.amountOut).toBe(q.fills[1].amountOut);
    expect(q.amountOut).toBeGreaterThan(0);
  });
});

describe('rankSwap', () => {
  test('small trade → single best pool, no split', () => {
    const r = must(rankSwap(pools(), BASE, 'USDT', 100));
    expect(r.best.isSplit).toBe(false);
    expect(r.best.parts.length).toBe(1);
    // #1 output ≥ every single-route inspection row
    expect(r.best.amountOut).toBeGreaterThanOrEqual(r.singles[0].amountOut - 1e-9);
  });

  test('large trade across two same-pair pools → split that beats the best single', () => {
    const p = pools();
    const amt = 900_000; // large vs each pool's depth ⇒ concentration is worse than spreading
    const r = must(rankSwap(p, BASE, 'USDT', amt));
    const bestSingle = r.singles[0].amountOut;
    expect(r.best.amountOut).toBeGreaterThanOrEqual(bestSingle - 1e-6);
    if (r.best.isSplit) {
      expect(r.best.parts.length).toBeGreaterThan(1);
      // allocations sum to the input, outputs sum to the plan total
      const inSum = r.best.parts.reduce((a, x) => a + x.fraction * amt, 0);
      expect(inSum).toBeCloseTo(amt, 2);
      expect(r.best.amountOut).toBeGreaterThan(bestSingle); // a real improvement
    }
  });

  test('singles are ranked by output descending', () => {
    const r = must(rankSwap(pools(), BASE, 'USDT', 50_000));
    for (let i = 1; i < r.singles.length; i++) {
      expect(r.singles[i - 1].amountOut).toBeGreaterThanOrEqual(r.singles[i].amountOut);
    }
  });

  test('no route → null', () => {
    const single: NamedPool[] = [{ tag: 'x', state: { base: BASE, legs: {} } }];
    expect(rankSwap(single, 'FOO', 'BAR', 100)).toBeNull();
  });
});

describe('aggregateDepth', () => {
  test('combined book spans both pools holding the pair', () => {
    const d = aggregateDepth(pools(), 'USDT', BASE);
    expect(d.mid).toBeGreaterThan(0);
    expect(d.bids.length).toBeGreaterThan(0);
    expect(d.asks.length).toBeGreaterThan(0);
    // aggregated depth ≥ a single pool's (two pools contribute)
    expect(d.bids[d.bids.length - 1].cum).toBeGreaterThan(0);
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
      asset(BASE, 6, 1_000_000_000_000n, 900_000_000_000n), // 1M / 0.9M @ 6 dec
      asset('USDT', 18, 500_000n * 10n ** 18n, 400_000n * 10n ** 18n),
      asset('WOOF', 18, 10n ** 18n, 10n ** 18n), // no feed → skipped
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
    // the converted state quotes like a hand-built one
    expect(quoteExactIn(state, 'USDT', BASE, 1_000).amountOut).toBeGreaterThan(0);
  });
});
