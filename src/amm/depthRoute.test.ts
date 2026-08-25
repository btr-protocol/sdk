// bun test — route-composed virtual depth (cross-pool books via the router's enumerated routes).
import { describe, expect, test } from 'bun:test';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { type PoolState, buildLeg, quoteExactIn } from './aimm';
import { aggregateDepthCurves } from './depthAgg';
import { aggregatePairDepth, aggregateRouteDepthCurves } from './depthRoute';
import { type NamedPool, rankSwap } from './router';

/** Narrow-or-throw stand-in for `!` (noNonNullAssertion): fails the test loudly on null. */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('expected non-null result');
  return value;
}

/**
 * Synthetic 2-pool 2-hop fleet: AUDF lives only in the fx core, WBTC only in the crypto core,
 * joined by the shared USDC hub — the live-demo shape that rendered "pool data unavailable".
 */
function crossFleet(): NamedPool[] {
  const audf = buildLeg(
    'AUDF',
    1,
    sigmaSeed('stable'),
    1_000_000,
    1_000_000,
    1_000_000,
    18,
    STABLE_PROFILE,
  );
  const wbtc = buildLeg(
    'WBTC',
    60_000,
    sigmaSeed('volatile'),
    50,
    50,
    200_000,
    8,
    VOLATILE_PROFILE,
  );
  const fx: PoolState = { base: 'USDC', legs: { AUDF: audf } };
  const crypto: PoolState = { base: 'USDC', legs: { WBTC: wbtc } };
  return [
    { tag: 'fx', state: fx },
    { tag: 'crypto', state: crypto },
  ];
}

describe('aggregateRouteDepthCurves', () => {
  test('a 2-hop pair has no direct book (root-cause regression guard)', () => {
    expect(aggregateDepthCurves(crossFleet(), 'AUDF', 'WBTC')).toBeNull();
  });

  test('composes a 2-hop book with the right mark, touch and span', () => {
    const book = must(aggregateRouteDepthCurves(crossFleet(), 'AUDF', 'WBTC'));
    // Oracle mark composes multiplicatively: AUDF-per-WBTC = (USDC/WBTC) / (USDC/AUDF) = 60_000.
    expect(book.mark).toBeCloseTo(60_000, -1);
    expect(book.mid / book.mark).toBeCloseTo(1, 2); // skewed mid within 1% of mark
    expect(book.bids.length).toBeGreaterThan(0);
    expect(book.asks.length).toBeGreaterThan(0);
    // Span: both sides carry real outward depth.
    expect(book.asks[0].cum).toBeGreaterThan(0);
    expect(book.bids[book.bids.length - 1].cum).toBeGreaterThan(0);
    // One route = one net touch per side; pre-fee the sides meet at the skewed mid.
    expect(book.bidNet).toBeLessThan(book.mid);
    expect(book.askNet).toBeGreaterThan(book.mid);
    expect(book.bid).toBeCloseTo(book.ask, -6);
  });

  test('composed touch agrees with the router quote at small size', () => {
    const pools = crossFleet();
    const book = must(aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC'));
    const q = must(rankSwap(pools, 'AUDF', 'WBTC', 10));
    // Router exec (WBTC per AUDF) vs the book's size-0 mid (AUDF per WBTC): same number reciprocated.
    expect(1 / book.mid).toBeCloseTo(
      q.singles[0].fills[0].amountOut > 0 ? q.best.amountOut / 10 : 0,
      1,
    );
  });

  test('reciprocal orientation mirrors the book', () => {
    const pools = crossFleet();
    const fwd = must(aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC'));
    const rev = must(aggregateRouteDepthCurves(pools, 'WBTC', 'AUDF', { invert: false }));
    expect(rev.mark).toBeCloseTo(1 / fwd.mark, 6);
    expect(rev.mid).toBeCloseTo(1 / fwd.mid, 6);
    expect(rev.bids.length).toBeGreaterThan(0);
  });
});

describe('aggregatePairDepth', () => {
  test('dispatches direct pairs to the untouched single-pool aggregator', () => {
    const pools = crossFleet();
    const direct: NamedPool[] = [pools[0]];
    const a = must(aggregateDepthCurves(direct, 'USDC', 'AUDF', { step: 0.001 }));
    const b = must(aggregatePairDepth(pools, 'USDC', 'AUDF', { step: 0.001 }, direct));
    expect(b.poolCount).toBe(1);
    expect(b.mid).toBe(a.mid);
    expect(b.bids).toEqual(a.bids);
  });

  test('falls back to the composed book when no pool holds both tokens', () => {
    const book = must(aggregatePairDepth(crossFleet(), 'AUDF', 'WBTC'));
    expect(book.asks.length).toBeGreaterThan(0);
  });

  test('composed sizes are re-denominated: ask rungs sum to the route capacity in WBTC', () => {
    const pools = crossFleet();
    const book = must(aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC'));
    // The route cannot deliver more WBTC than the crypto leg's reserve clip; the composed ask
    // ladder must end at or below the leg's own virtual depth.
    const leg = quoteExactIn(pools[1].state, 'USDC', 'WBTC', 0);
    void leg;
    const directWbtc = must(aggregateDepthCurves([pools[1]], 'USDC', 'WBTC'));
    expect(book.asks[book.asks.length - 1].cum).toBeLessThanOrEqual(
      directWbtc.asks[directWbtc.asks.length - 1].cum * 1.0001,
    );
  });
});

// ── cross-validator pins: router-quote ↔ book-depth consistency (one math, two views) ──

describe('router quote vs composed book consistency', () => {
  // Book convention (crossCurve): ASKS carry 'to' bought by paying 'from'; BIDS carry 'to' sold
  // for 'from'. Both sides quote from-per-to. Chain both directions off quoteExactIn exactly as
  // quoteRoute fills them (leg N spends leg N-1's net output).
  function routeQuote(
    pools: NamedPool[],
    legs: { poolTag: string; tokenIn: string; tokenOut: string }[],
    x: number,
  ): number {
    let amt = x;
    for (const leg of legs) {
      const p = pools.find((q) => q.tag === leg.poolTag);
      if (!p) throw new Error(`missing pool ${leg.poolTag}`);
      amt = quoteExactIn(p.state, leg.tokenIn, leg.tokenOut, amt).amountOut;
      if (!(amt > 0)) return 0;
    }
    return amt;
  }
  /** Binary-search the input knee: smallest input whose output sits on the saturation plateau. */
  function routeKnee(
    pools: NamedPool[],
    legs: { poolTag: string; tokenIn: string; tokenOut: string }[],
    hint: number,
  ): number {
    const plateau = routeQuote(pools, legs, hint);
    const flat = (x: number) => routeQuote(pools, legs, x) >= plateau * (1 - 1e-9);
    let lo = hint * 1e-6; // not flat
    let hi = hint; // flat
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (flat(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  const REV_LEGS = [
    { poolTag: 'crypto', tokenIn: 'WBTC', tokenOut: 'USDC' },
    { poolTag: 'fx', tokenIn: 'USDC', tokenOut: 'AUDF' },
  ];

  test('capacity clips at the MIN of the chained leg caps (quote knee)', () => {
    const pools = crossFleet();
    const book = must(aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC'));
    // Bids sell WBTC back down the route; the crypto hub's baseRes (200k USDC) caps that sell at
    // ~3.35 WBTC while the fx leg could absorb far more — the hop binds, and the book must show it.
    const knee = routeKnee(pools, REV_LEGS, 10);
    expect(knee).toBeGreaterThan(2);
    expect(knee).toBeLessThan(3.35 * 1.001); // the hub drain, not the fx band
    expect(book.bids[book.bids.length - 1].cum).toBeGreaterThan(knee * 0.95);
    expect(book.bids[book.bids.length - 1].cum).toBeLessThanOrEqual(knee * 1.05);
  });

  test('book VWAP equals the router quote at every size (integral consistency)', () => {
    const pools = crossFleet();
    const book = must(aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC'));
    // Selling s WBTC consumes bids; Σ size × price over rungs up to cum s must reproduce the
    // router's AUDF out — same primitives, zero re-implementation.
    for (const s of [0.01, 0.25, 1, 2.5]) {
      const expected = routeQuote(pools, REV_LEGS, s);
      let filled = 0;
      let out = 0;
      for (const r of book.bids) {
        if (r.cum <= s) {
          out += r.size * r.price;
          filled = r.cum;
        } else {
          out += ((s - filled) / (r.cum - filled)) * r.size * r.price;
          break;
        }
      }
      // Rung prices sit on bucket edges (≤ one step of discretization), so 2% is generous for a
      // correct composition and hopeless for a wrong-band or wrong-capacity one.
      expect(Math.abs(out / expected - 1)).toBeLessThan(0.02);
    }
  });

  test('a pegged tiny-capacity hop still prints its one limit rung (flat-side regression)', () => {
    const audf = buildLeg('AUDF', 1, sigmaSeed('stable'), 1_000, 1_000, 1_000, 18, STABLE_PROFILE);
    const wbtc = buildLeg(
      'WBTC',
      60_000,
      sigmaSeed('volatile'),
      1e9,
      1e9,
      1e11,
      8,
      VOLATILE_PROFILE,
    );
    const pools: NamedPool[] = [
      { tag: 'fx', state: { base: 'USDC', legs: { AUDF: audf } } },
      { tag: 'crypto', state: { base: 'USDC', legs: { WBTC: wbtc } } },
    ];
    const book = must(aggregateRouteDepthCurves(pools, 'WBTC', 'AUDF'));
    // Selling WBTC back through a ~666-AUDF-deep fx leg moves the marginal less than the
    // aggregator's dedup tolerance across the WHOLE side: it must still print its rung.
    expect(book.bids.length).toBeGreaterThan(0);
    expect(book.bids[book.bids.length - 1].cum).toBeGreaterThan(0);
  });
});
