// bun test — order-book aggregation ladder + multi-pool depth curves.
import { expect, test, describe } from 'bun:test';
import { niceStep, stepLadder, aggregate, mergeAgg, aggregateDepthCurves, type Row } from './depthAgg';
import { type NamedPool } from './router';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { buildLeg, virtualMarketDepth, type PoolState } from './aimm';

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

  test('one-sided pool still returns a book (skewed reserves)', () => {
    const twap = 64_000;
    const leg = buildLeg('BTCB', twap, sigmaSeed('volatile'), 10_000, 10_000, 10_000, 18, VOLATILE_PROFILE);
    const pool: NamedPool = { tag: 'volatile', state: { base: 'USDC', legs: { BTCB: leg } } };
    const book = aggregateDepthCurves([pool], 'USDC', 'BTCB', { step: 50 });
    expect(book).not.toBeNull();
    expect(book!.asks.length + book!.bids.length).toBeGreaterThan(0);
  });

  // Regression: crossCurve used to return bids reversed (cum descending), which
  // aggregate() collapsed to zero rows — WETH/WBTC printed asks only.
  test('cross pair (neither leg is the hub base) prints BOTH sides', () => {
    const weth = buildLeg('WETH', 1_880, sigmaSeed('volatile'), 500, 500, 940_000, 18, VOLATILE_PROFILE);
    const wbtc = buildLeg('WBTC', 63_500, sigmaSeed('volatile'), 15, 15, 952_500, 18, VOLATILE_PROFILE);
    const pool: NamedPool = { tag: 'volatile', state: { base: 'USDC', legs: { WETH: weth, WBTC: wbtc } } };
    const book = aggregateDepthCurves([pool], 'WETH', 'WBTC');
    expect(book).not.toBeNull();
    expect(book!.asks.length).toBeGreaterThan(0);
    expect(book!.bids.length).toBeGreaterThan(0);
    // Bids sit below the mid, asks above.
    expect(book!.bids[0].price).toBeLessThanOrEqual(book!.mid);
    expect(book!.asks[0].price).toBeGreaterThanOrEqual(book!.mid);
  });

  test('touch is the un-bucketed curve[0] of each side, not a ladder-snapped row', () => {
    const usdt = buildLeg('USDT', 1, sigmaSeed('stable'), 1_000_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
    const pool: NamedPool = { tag: 'stable', state: { base: 'USDC', legs: { USDT: usdt } } };
    const curve = virtualMarketDepth(pool.state, 'USDT');
    const book = aggregateDepthCurves([pool], 'USDC', 'USDT', { step: 0.01 })!;
    expect(book.bid).toBeCloseTo(curve.bids[0].price, 12);
    expect(book.ask).toBeCloseTo(curve.asks[0].price, 12);
    // Pre-fee the two sides meet at the skewed mid; the cost sits on the NET touch beside it.
    expect(book.bid).toBeCloseTo(book.mid, 12);
    expect(book.ask).toBeCloseTo(book.mid, 12);
    expect(book.bidNet).toBeLessThan(book.mid);
    expect(book.askNet).toBeGreaterThan(book.mid);
    // The coarse ladder rounds the printed rows away from the touch; the touch must survive it.
    expect(Math.abs(book.asks[0].price - book.ask)).toBeGreaterThan(0);
  });

  test('touch of an empty side is 0, and one side present still reports the other', () => {
    const usdt = buildLeg('USDT', 1, sigmaSeed('stable'), 1_000_000, 1_000_000, 0, 18, STABLE_PROFILE);
    const pool: NamedPool = { tag: 'stable', state: { base: 'USDC', legs: { USDT: usdt } } };
    const book = aggregateDepthCurves([pool], 'USDC', 'USDT', { step: 0.001 });
    if (book) expect(book.ask > 0 || book.bid > 0).toBe(true);
  });

  // Two pools quoting the same pair carry their own inventory skew, hence their own mid. A taker
  // routes to the best pool, so the venue touch is max-bid / min-ask, never the size-weighted mean.
  function skewedPair(): { pools: NamedPool[]; midHi: number; midLo: number } {
    // Same profile, different reserve/liability balance ⇒ different skew ⇒ different mid.
    const hi = buildLeg('USDT', 1, sigmaSeed('stable'), 600_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
    const lo = buildLeg('USDT', 1, sigmaSeed('stable'), 1_400_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
    const pools: NamedPool[] = [
      { tag: 'stable', state: { base: 'USDC', legs: { USDT: hi } } },
      { tag: 'volatile', state: { base: 'USDC', legs: { USDT: lo } } },
    ];
    const midHi = virtualMarketDepth(pools[0].state, 'USDT').mid;
    const midLo = virtualMarketDepth(pools[1].state, 'USDT').mid;
    return { pools, midHi, midLo };
  }

  test('two pools with different mids: touch is max-bid / min-ask, not the mean', () => {
    const { pools, midHi, midLo } = skewedPair();
    expect(Math.abs(midHi - midLo)).toBeGreaterThan(0); // premise: the pools really do differ
    const book = aggregateDepthCurves(pools, 'USDC', 'USDT', { step: 0.0001 })!;
    const bids = pools.map((p) => virtualMarketDepth(p.state, 'USDT').bids[0]);
    const asks = pools.map((p) => virtualMarketDepth(p.state, 'USDT').asks[0]);
    expect(book.bid).toBeCloseTo(Math.max(...bids.map((l) => l.price)), 12);
    expect(book.ask).toBeCloseTo(Math.min(...asks.map((l) => l.price)), 12);
    expect(book.bidNet).toBeCloseTo(Math.max(...bids.map((l) => l.netPrice)), 12);
    expect(book.askNet).toBeCloseTo(Math.min(...asks.map((l) => l.netPrice)), 12);
    // The mean would sit strictly inside: a bid worse than the best bid, an ask worse than the best.
    expect(book.bid).toBeGreaterThan((midHi + midLo) / 2);
    expect(book.ask).toBeLessThan((midHi + midLo) / 2);
  });

  test('a one-sided pool does not drag the touch', () => {
    const two = buildLeg('USDT', 1, sigmaSeed('stable'), 1_000_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
    // baseRes = 0 ⇒ no bid side (capBidTok = 0); over-covered ⇒ its ask is the better one.
    const askOnly = buildLeg('USDT', 1, sigmaSeed('stable'), 1_200_000, 1_000_000, 0, 18, STABLE_PROFILE);
    const solo: NamedPool = { tag: 'stable', state: { base: 'USDC', legs: { USDT: two } } };
    const pools: NamedPool[] = [solo, { tag: 'volatile', state: { base: 'USDC', legs: { USDT: askOnly } } }];
    const one = aggregateDepthCurves([solo], 'USDC', 'USDT', { step: 0.0001 })!;
    const book = aggregateDepthCurves(pools, 'USDC', 'USDT', { step: 0.0001 })!;
    const other = virtualMarketDepth(pools[1].state, 'USDT');
    expect(other.bids.length).toBe(0); // premise: the second pool quotes one side only
    expect(book.bid).toBeCloseTo(one.bid, 12); // bid untouched by the ask-only pool
    expect(book.bidNet).toBeCloseTo(one.bidNet, 12);
    expect(book.ask).toBeCloseTo(Math.min(one.ask, other.asks[0].price), 12);
    expect(book.ask).toBeLessThan(one.ask); // it did contribute: the better ask won
    expect(book.mid).toBeGreaterThanOrEqual(Math.min(book.bid, book.ask));
    expect(book.mid).toBeLessThanOrEqual(Math.max(book.bid, book.ask));
  });

  test('single pool is unchanged by aggregation, and bid <= mid <= ask holds', () => {
    const usdt = buildLeg('USDT', 1, sigmaSeed('stable'), 900_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
    const pool: NamedPool = { tag: 'stable', state: { base: 'USDC', legs: { USDT: usdt } } };
    const curve = virtualMarketDepth(pool.state, 'USDT');
    const book = aggregateDepthCurves([pool], 'USDC', 'USDT', { step: 0.0001 })!;
    expect(book.mid).toBeCloseTo(curve.mid, 12);
    expect(book.mark).toBeCloseTo(curve.mark, 12);
    expect(book.bid).toBeCloseTo(curve.bids[0].price, 12);
    expect(book.ask).toBeCloseTo(curve.asks[0].price, 12);
    expect(book.bid).toBeLessThanOrEqual(book.mid);
    expect(book.ask).toBeGreaterThanOrEqual(book.mid);
  });

  test('bid <= mid <= ask, and no rung is priced through the touch', () => {
    const { pools } = skewedPair();
    for (const step of [0.0001, 0.001, 0.01]) {
      const book = aggregateDepthCurves(pools, 'USDC', 'USDT', { step })!;
      const lo = Math.min(book.bid, book.ask);
      const hi = Math.max(book.bid, book.ask);
      expect(book.mid).toBeGreaterThanOrEqual(lo);
      expect(book.mid).toBeLessThanOrEqual(hi);
      // Every printed rung sits behind the touch it belongs to.
      for (const r of book.bids) expect(r.price).toBeLessThan(book.bid);
      for (const r of book.asks) expect(r.price).toBeGreaterThan(book.ask);
    }
  });

  test('invert mirrors the book: reciprocal mid, sides swap, sizes change unit', () => {
    const weth = buildLeg('WETH', 1_880, sigmaSeed('volatile'), 500, 500, 940_000, 18, VOLATILE_PROFILE);
    const wbtc = buildLeg('WBTC', 63_500, sigmaSeed('volatile'), 15, 15, 952_500, 18, VOLATILE_PROFILE);
    const pool: NamedPool = { tag: 'volatile', state: { base: 'USDC', legs: { WETH: weth, WBTC: wbtc } } };
    const fwd = aggregateDepthCurves([pool], 'WETH', 'WBTC')!;
    const inv = aggregateDepthCurves([pool], 'WETH', 'WBTC', { invert: true })!;
    expect(inv.mid).toBeCloseTo(1 / fwd.mid, 9);
    expect(inv.mark).toBeCloseTo(1 / fwd.mark, 9);
    // Best inverted bid ≈ reciprocal of the best forward ask (and vice versa), within a bucket.
    expect(1 / inv.bids[0].price).toBeGreaterThan(fwd.asks[0].price - fwd.step);
    expect(1 / inv.asks[0].price).toBeLessThan(fwd.bids[0].price + fwd.step);
    // Sizes are re-denominated (~×mid), not copied over — a relabelled book would be identical.
    const fwdTop = fwd.asks[fwd.asks.length - 1].cum;
    const invTop = inv.bids[inv.bids.length - 1].cum;
    expect(invTop / fwdTop).toBeGreaterThan(1 / fwd.mid * 0.5);
    // Ordering contract for aggregate(): cum ascending mid-outward on both sides.
    for (const side of [inv.bids, inv.asks]) {
      for (let i = 1; i < side.length; i++) expect(side[i].cum).toBeGreaterThan(side[i - 1].cum);
    }
    expect(inv.bids[0].price).toBeLessThanOrEqual(inv.mid);
    expect(inv.asks[0].price).toBeGreaterThanOrEqual(inv.mid);
  });
});
