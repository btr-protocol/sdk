// bun test — order-book aggregation ladder + multi-pool depth curves.
import { expect, test, describe } from 'bun:test';
import { niceStep, stepLadder, aggregate, mergeAgg, aggregateDepthCurves, type Row } from './depthAgg';
import { type NamedPool } from './router';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { buildLeg, type PoolState } from './aimm';

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

describe('aggregate', () => {
  const bids: Row[] = [
    { price: 106, size: 0, cum: 0 },
    { price: 100.8, size: 2, cum: 2 },
    { price: 100.2, size: 1, cum: 3 },
  ];

  test('densifies sparse curve: smaller step → more rows, larger → fewer', () => {
    const fine = aggregate(bids, 0.5, 'bid', 'base');
    const mid = aggregate(bids, 2, 'bid', 'base');
    const coarse = aggregate(bids, 5, 'bid', 'base');
    expect(fine.length).toBeGreaterThan(mid.length);
    expect(mid.length).toBeGreaterThanOrEqual(coarse.length);
    expect(coarse.length).toBeGreaterThanOrEqual(1);
    expect(fine[fine.length - 1].cum).toBeCloseTo(3, 9);
    expect(coarse[coarse.length - 1].cum).toBeCloseTo(3, 9);
  });

  test('ask side densifies mid→far with monotone cum', () => {
    const asks: Row[] = [
      { price: 100, size: 0, cum: 0 },
      { price: 110, size: 4, cum: 4 },
      { price: 120, size: 6, cum: 10 },
    ];
    const out = aggregate(asks, 5, 'ask', 'base');
    expect(out.length).toBeGreaterThan(2);
    expect(out[0].price).toBeLessThan(out[out.length - 1].price);
    expect(out[out.length - 1].cum).toBeCloseTo(10, 9);
    for (let i = 1; i < out.length; i++) expect(out[i].cum).toBeGreaterThan(out[i - 1].cum);
  });

  test('quote denom scales token→quote by bucket price', () => {
    const rows: Row[] = [
      { price: 100, size: 0, cum: 0 },
      { price: 105, size: 2, cum: 2 },
    ];
    const out = aggregate(rows, 5, 'ask', 'quote');
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[out.length - 1].cum).toBeGreaterThan(0);
    expect(out[out.length - 1].cum).toBeGreaterThan(2 * 100);
    expect(out[out.length - 1].cum).toBeLessThanOrEqual(2 * 105 + 1e-9);
  });
});

describe('mergeAgg', () => {
  test('sums same-price buckets across pools', () => {
    const a = [
      { price: 100, size: 1, cum: 1 },
      { price: 99, size: 2, cum: 3 },
    ];
    const b = [
      { price: 100, size: 3, cum: 3 },
      { price: 98, size: 1, cum: 4 },
    ];
    const out = mergeAgg([a, b], 'bid');
    expect(out.find((r) => r.price === 100)?.size).toBe(4);
    expect(out[0].price).toBeGreaterThan(out[out.length - 1].price);
  });
});

function miniPools(): NamedPool[] {
  const usdtStable = buildLeg('USDT', 1, sigmaSeed('stable'), 1_000_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
  const usdtVol = buildLeg('USDT', 1, sigmaSeed('volatile'), 800_000, 800_000, 800_000, 18, VOLATILE_PROFILE);
  const stable: PoolState = { base: 'USDC', legs: { USDT: usdtStable } };
  const volatile: PoolState = { base: 'USDC', legs: { USDT: usdtVol } };
  return [
    { tag: 'stable', state: stable },
    { tag: 'volatile', state: volatile },
  ];
}

describe('aggregateDepthCurves', () => {
  test('merges N pools holding the pair; finer step → more bands', () => {
    const pools = miniPools();
    const coarse = aggregateDepthCurves(pools, 'USDC', 'USDT', { step: 0.01 });
    const fine = aggregateDepthCurves(pools, 'USDC', 'USDT', { step: 0.001 });
    expect(coarse).not.toBeNull();
    expect(fine).not.toBeNull();
    expect(coarse!.poolCount).toBe(2);
    expect(coarse!.mid).toBeGreaterThan(0);
    expect(coarse!.bids.length).toBeGreaterThan(0);
    expect(coarse!.asks.length).toBeGreaterThan(0);
    expect(fine!.asks.length + fine!.bids.length).toBeGreaterThanOrEqual(
      coarse!.asks.length + coarse!.bids.length,
    );
  });
});
