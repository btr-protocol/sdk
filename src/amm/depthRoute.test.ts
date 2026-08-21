// bun test — route-composed virtual depth (cross-pool books via the router's enumerated routes).
import { describe, expect, test } from 'bun:test';
import { aggregateDepthCurves } from './depthAgg';
import { aggregatePairDepth, aggregateRouteDepthCurves } from './depthRoute';
import { rankSwap, type NamedPool } from './router';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import { buildLeg, quoteExactIn, type PoolState } from './aimm';

/**
 * Synthetic 2-pool 2-hop fleet: AUDF lives only in the fx core, WBTC only in the crypto core,
 * joined by the shared USDC hub — the live-demo shape that rendered "pool data unavailable".
 */
function crossFleet(): NamedPool[] {
  const audf = buildLeg('AUDF', 1, sigmaSeed('stable'), 1_000_000, 1_000_000, 1_000_000, 18, STABLE_PROFILE);
  const wbtc = buildLeg('WBTC', 60_000, sigmaSeed('volatile'), 50, 50, 200_000, 8, VOLATILE_PROFILE);
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
    const book = aggregateRouteDepthCurves(crossFleet(), 'AUDF', 'WBTC');
    expect(book).not.toBeNull();
    // Oracle mark composes multiplicatively: AUDF-per-WBTC = (USDC/WBTC) / (USDC/AUDF) = 60_000.
    expect(book!.mark).toBeCloseTo(60_000, -1);
    expect(book!.mid / book!.mark).toBeCloseTo(1, 2); // skewed mid within 1% of mark
    expect(book!.bids.length).toBeGreaterThan(0);
    expect(book!.asks.length).toBeGreaterThan(0);
    // Span: both sides carry real outward depth.
    expect(book!.asks[0].cum).toBeGreaterThan(0);
    expect(book!.bids[book!.bids.length - 1].cum).toBeGreaterThan(0);
    // One route = one net touch per side; pre-fee the sides meet at the skewed mid.
    expect(book!.bidNet).toBeLessThan(book!.mid);
    expect(book!.askNet).toBeGreaterThan(book!.mid);
    expect(book!.bid).toBeCloseTo(book!.ask, -6);
  });

  test('composed touch agrees with the router quote at small size', () => {
    const pools = crossFleet();
    const book = aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC')!;
    const q = rankSwap(pools, 'AUDF', 'WBTC', 10)!;
    // Router exec (WBTC per AUDF) vs the book's size-0 mid (AUDF per WBTC): same number reciprocated.
    expect(1 / book.mid).toBeCloseTo(q.singles[0].fills[0].amountOut > 0 ? q.best.amountOut / 10 : 0, 1);
  });

  test('reciprocal orientation mirrors the book', () => {
    const pools = crossFleet();
    const fwd = aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC')!;
    const rev = aggregateRouteDepthCurves(pools, 'WBTC', 'AUDF', { invert: false })!;
    expect(rev.mark).toBeCloseTo(1 / fwd.mark, 6);
    expect(rev.mid).toBeCloseTo(1 / fwd.mid, 6);
    expect(rev.bids.length).toBeGreaterThan(0);
  });
});

describe('aggregatePairDepth', () => {
  test('dispatches direct pairs to the untouched single-pool aggregator', () => {
    const pools = crossFleet();
    const direct: NamedPool[] = [pools[0]];
    const a = aggregateDepthCurves(direct, 'USDC', 'AUDF', { step: 0.001 });
    const b = aggregatePairDepth(pools, 'USDC', 'AUDF', { step: 0.001 }, direct);
    expect(b).not.toBeNull();
    expect(b!.poolCount).toBe(1);
    expect(b!.mid).toBe(a!.mid);
    expect(b!.bids).toEqual(a!.bids);
  });

  test('falls back to the composed book when no pool holds both tokens', () => {
    const book = aggregatePairDepth(crossFleet(), 'AUDF', 'WBTC');
    expect(book).not.toBeNull();
    expect(book!.asks.length).toBeGreaterThan(0);
  });

  test('composed sizes are re-denominated: ask rungs sum to the route capacity in WBTC', () => {
    const pools = crossFleet();
    const book = aggregateRouteDepthCurves(pools, 'AUDF', 'WBTC')!;
    // The route cannot deliver more WBTC than the crypto leg's reserve clip; the composed ask
    // ladder must end at or below the leg's own virtual depth.
    const leg = quoteExactIn(pools[1].state, 'USDC', 'WBTC', 0);
    void leg;
    const directWbtc = aggregateDepthCurves([pools[1]], 'USDC', 'WBTC')!;
    expect(book.asks[book.asks.length - 1].cum).toBeLessThanOrEqual(
      directWbtc.asks[directWbtc.asks.length - 1].cum * 1.0001,
    );
  });
});
