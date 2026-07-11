// bun test — proves the shared model self-consistent (chart == quote) and a faithful port of aimm.rs.
import { describe, expect, test } from 'bun:test';
import goldenRaw from './__fixtures__/aimm-golden.json';
import { STABLE_PROFILE, VOLATILE_PROFILE, sigmaSeed } from './__fixtures__/profiles';
import {
  type DepthLevel,
  PBPS,
  type PoolState,
  areaSpline,
  buildLeg,
  calcDepth,
  computeSkew,
  covQ,
  covToll,
  depthCurve,
  dispersion,
  evalSpline,
  quoteExactIn,
  splinePoints,
  spreadPbps,
  virtualMarketDepth,
} from './aimm';

const BASE = 'USDC';

// A one-leg (direct) volatile book and a two-leg (cross) book, c=1.
function volState(res = 9.4, twap = 62_000): PoolState {
  const leg = buildLeg(
    'BTCB',
    twap,
    sigmaSeed('volatile'),
    res,
    res,
    res * twap,
    18,
    VOLATILE_PROFILE,
  );
  return { base: BASE, legs: { BTCB: leg } };
}
function crossState(): PoolState {
  const btc = buildLeg(
    'BTCB',
    62_000,
    sigmaSeed('volatile'),
    9.4,
    9.4,
    9.4 * 62_000,
    18,
    VOLATILE_PROFILE,
  );
  const eth = buildLeg(
    'ETH',
    3_100,
    sigmaSeed('volatile'),
    150,
    150,
    150 * 3_100,
    18,
    VOLATILE_PROFILE,
  );
  return { base: BASE, legs: { BTCB: btc, ETH: eth } };
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// Integrate the RENDERED marginal ladder (trapezoid; marginal is linear in cumTok within a knot
// segment ⇒ exact) up to cumulative token size S → the base filled. This is literally "integrate the
// rendered depth" and must equal the quote's gross output.
function integrateLadder(levels: DepthLevel[], S: number): number {
  const asc = [...levels].sort((a, b) => a.cumTok - b.cumTok);
  let acc = 0;
  for (let i = 1; i < asc.length; i++) {
    const a = asc[i - 1];
    const b = asc[i];
    if (b.cumTok <= S) {
      acc += 0.5 * (a.price + b.price) * (b.cumTok - a.cumTok);
    } else {
      const frac = (S - a.cumTok) / (b.cumTok - a.cumTok);
      const priceAtS = a.price + frac * (b.price - a.price);
      acc += 0.5 * (a.price + priceAtS) * (S - a.cumTok);
      break;
    }
  }
  return acc;
}

describe('primitives port (aimm.rs)', () => {
  test('splinePoints places knots on the [0,10000] depth axis', () => {
    const pts = splinePoints(VOLATILE_PROFILE, 1000);
    expect(pts.map((p) => p[0])).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(pts[2][1]).toBe(0); // center knot = 0 offset
  });
  test('evalSpline is flat outside the knot span, linear within', () => {
    const pts = splinePoints(VOLATILE_PROFILE, 1000);
    expect(evalSpline(pts, -5)).toBe(pts[0][1]);
    expect(evalSpline(pts, 99999)).toBe(pts[4][1]);
    expect(evalSpline(pts, 3750)).toBeCloseTo(0.5 * (pts[1][1] + pts[2][1]), 9);
  });
  test('areaSpline == analytic trapezoid of the collinear default knots', () => {
    const pts = splinePoints(VOLATILE_PROFILE, 1000);
    const a = areaSpline(pts, 2500, 7500);
    expect(a).toBeCloseTo(0.5 * (evalSpline(pts, 2500) + evalSpline(pts, 7500)) * 5000, 6);
  });
  test('computeSkew symmetric around c=1; clamps at coverage bounds', () => {
    expect(computeSkew(1, 1, VOLATILE_PROFILE)).toBeCloseTo(0, 9);
    expect(computeSkew(0.4, 1, VOLATILE_PROFILE)).toBe(100); // c ≤ covMin
    expect(computeSkew(3, 1, VOLATILE_PROFILE)).toBe(-100); // c ≥ covMax
  });
  test('calcDepth == reserves when c ≥ 1; virtual-depth amplification toward L when under-covered', () => {
    expect(calcDepth(9.4, 9.4, VOLATILE_PROFILE)).toBe(9.4); // c = 1
    const d = calcDepth(800, 1000, VOLATILE_PROFILE); // c = 0.8 ⇒ depth ∈ (R, L]
    expect(d).toBeGreaterThan(800);
    expect(d).toBeLessThanOrEqual(1000);
  });
  test('dispersion / spread clamp to profile bounds', () => {
    expect(dispersion(sigmaSeed('stable'), STABLE_PROFILE)).toBeGreaterThanOrEqual(
      STABLE_PROFILE.minDisp,
    );
    expect(spreadPbps(0, STABLE_PROFILE)).toBe(STABLE_PROFILE.minFee); // σ=0 → floor
    expect(spreadPbps(1e9, VOLATILE_PROFILE)).toBe(VOLATILE_PROFILE.maxFee); // saturate
  });
});

describe('invariant: integrating the rendered depth == quote.grossOut', () => {
  test('SELL ladder integral reproduces grossOut (direct)', () => {
    const state = volState();
    const curve = depthCurve(state, 'BTCB', BASE);
    for (const S of [0.05, 0.5, 1.5, 3.2, 4.6]) {
      const q = quoteExactIn(state, 'BTCB', BASE, S);
      expect(rel(integrateLadder(curve.bids, S), q.grossOut)).toBeLessThan(1e-9);
    }
  });
  test('BUY book vertices are quote-consistent (direct)', () => {
    const state = volState();
    const curve = depthCurve(state, BASE, 'BTCB');
    for (const lvl of curve.asks) {
      if (lvl.cumBase <= 0) continue;
      const q = quoteExactIn(state, BASE, 'BTCB', lvl.cumBase);
      expect(rel(q.grossOut, lvl.cumTok)).toBeLessThan(1e-9);
    }
  });
  test('CROSS swept nodes reproduce quoteExactIn', () => {
    const state = crossState();
    const curve = depthCurve(state, 'BTCB', 'ETH');
    for (const lvl of curve.asks) {
      const q = quoteExactIn(state, 'BTCB', 'ETH', lvl.cumBase); // spend `from`, receive `to`
      expect(rel(q.grossOut, lvl.cumTok)).toBeLessThan(1e-9);
    }
  });
});

describe('monotonicity + spread gap', () => {
  test('ask marginal ↑, bid marginal ↓, cumTok strictly ↑ outward', () => {
    const curve = depthCurve(volState(), 'BTCB', BASE);
    for (let i = 1; i < curve.asks.length; i++) {
      expect(curve.asks[i].price).toBeGreaterThanOrEqual(curve.asks[i - 1].price - 1e-9);
      expect(curve.asks[i].cumTok).toBeGreaterThan(curve.asks[i - 1].cumTok - 1e-12);
    }
    const bidsOut = [...curve.bids].sort((a, b) => a.cumTok - b.cumTok);
    for (let i = 1; i < bidsOut.length; i++) {
      expect(bidsOut[i].price).toBeLessThanOrEqual(bidsOut[i - 1].price + 1e-9);
      expect(bidsOut[i].cumTok).toBeGreaterThan(bidsOut[i - 1].cumTok - 1e-12);
    }
  });
  test('visible gap (askBest−bidBest)/mid == spread as S→0', () => {
    const curve = depthCurve(volState(), 'BTCB', BASE);
    const q = quoteExactIn(volState(), 'BTCB', BASE, 0);
    expect(rel(((curve.askBest - curve.bidBest) / curve.mid) * 1e4, q.spreadBps)).toBeLessThan(
      1e-9,
    );
  });
});

describe('fees == actual haircut (no double-count)', () => {
  test('lpFeeBps + protoFeeBps equals the real deduction (grossOut→amountOut), = spreadBps/2', () => {
    const state = volState();
    const q = quoteExactIn(state, 'BTCB', BASE, 1);
    const realBps = ((q.grossOut - q.amountOut) / q.grossOut) * 1e4;
    expect(rel(q.lpFeeBps + q.protoFeeBps, realBps)).toBeLessThan(1e-9);
    expect(rel(q.lpFeeBps + q.protoFeeBps, q.spreadBps / 2)).toBeLessThan(1e-9);
    // the reported LP-fee base amount must not exceed the ENTIRE fee taken
    expect((q.grossOut * q.lpFeeBps) / 1e4).toBeLessThanOrEqual(q.grossOut - q.amountOut + 1e-9);
  });
});

// GATE-07: covToll/covQ port faithfulness — mirrors the Lemma-C properties machine-checked in
// dex/evm/test/unit/CoverageProofs.t.sol (Pricing._covToll fuzz suite) as deterministic examples.
describe('coverage-wall toll (GATE-07; ports Pricing.sol._covToll)', () => {
  test('κ=0 must be free regardless of drain size', () => {
    expect(covToll(1000, 1000, 0, 500)).toBe(0);
  });
  test('full drain (grossOut ≥ reserves) is fully tolled — the wall blocks the whole fill', () => {
    expect(covToll(1000, 1000, 15_000, 1000)).toBe(1000);
    expect(covToll(1000, 1000, 15_000, 1500)).toBe(1500); // over-drain clamps the same way
  });
  test('charge-only: draining an over-covered leg toward/at the peg is free (dQ ≤ 0)', () => {
    // c0 = 2000/1000 = 2 (clamped to 1 = peg); c1 = (2000-500)/1000 = 1.5 (clamped to 1) ⇒ dQ = 0.
    expect(covToll(2000, 1000, 15_000, 500)).toBe(0);
  });
  test('bounds: 0 ≤ toll ≤ grossOut for an under-covered drain', () => {
    const t = covToll(1000, 1000, 15_000, 100); // c0=1 (peg) → c1=0.9 (under peg) ⇒ real charge
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(100);
  });
  test('monotone in size: a bigger drain of the same leg never tolls less', () => {
    const t1 = covToll(1000, 1000, 15_000, 100);
    const t2 = covToll(1000, 1000, 15_000, 300);
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
  test('covQ peaks at 0 (c=1) and is negative on both sides', () => {
    expect(covQ(1)).toBeCloseTo(0, 12);
    expect(covQ(0.5)).toBeLessThan(0);
    expect(covQ(2)).toBeLessThan(0);
  });

  // Wiring: quoteExactIn only tolls the DRAINED (output) leg — never a DIRECT SELL (output=base),
  // since the base numeraire can never carry kappaCovBps (protocol invariant) — matches
  // Pricing.sol's cacheOut = tokenOut, and test_base_kappa_rejected_at_addAsset on-chain.
  test('DIRECT SELL (token→base) never tolls, even if the leg carries κ>0', () => {
    const leg = buildLeg(
      'BTCB',
      62_000,
      sigmaSeed('volatile'),
      9.4,
      9.4,
      9.4 * 62_000,
      18,
      VOLATILE_PROFILE,
      15_000,
    );
    const state: PoolState = { base: BASE, legs: { BTCB: leg } };
    const q = quoteExactIn(state, 'BTCB', BASE, 1);
    expect(q.covTollBps).toBe(0);
  });
  test('DIRECT BUY (base→token) tolls the token leg when under-covered with κ>0, reducing amountOut', () => {
    const under = buildLeg(
      'BTCB',
      62_000,
      sigmaSeed('volatile'),
      800,
      1000,
      800 * 62_000,
      18,
      VOLATILE_PROFILE,
      15_000,
    );
    const free = buildLeg(
      'BTCB',
      62_000,
      sigmaSeed('volatile'),
      800,
      1000,
      800 * 62_000,
      18,
      VOLATILE_PROFILE,
      0,
    );
    const stateTolled: PoolState = { base: BASE, legs: { BTCB: under } };
    const stateFree: PoolState = { base: BASE, legs: { BTCB: free } };
    const qTolled = quoteExactIn(stateTolled, BASE, 'BTCB', 1_000_000);
    const qFree = quoteExactIn(stateFree, BASE, 'BTCB', 1_000_000);
    expect(qTolled.covTollBps).toBeGreaterThan(0);
    expect(qTolled.amountOut).toBeLessThan(qFree.amountOut);
    expect(qTolled.grossOut).toBeCloseTo(qFree.grossOut, 9); // toll doesn't touch the pure spline curve
  });
});

describe('orientation', () => {
  test('asks sit at/above mid, bids at/below', () => {
    const curve = depthCurve(volState(), 'BTCB', BASE);
    for (const a of curve.asks) expect(a.price).toBeGreaterThanOrEqual(curve.mid - 1e-6);
    for (const b of curve.bids) expect(b.price).toBeLessThanOrEqual(curve.mid + 1e-6);
  });
  test('flip swaps the overlaid side but not the book', () => {
    const state = volState();
    const sell = quoteExactIn(state, 'BTCB', BASE, 1); // hits BID
    const buy = quoteExactIn(state, BASE, 'BTCB', 62_000); // hits ASK
    expect(sell.route).toEqual(['BTCB', BASE]);
    expect(buy.route).toEqual([BASE, 'BTCB']);
    expect(sell.midPrice).toBeCloseTo(1 / buy.midPrice, 6); // reciprocal mids, same book
  });
});

describe('virtualMarketDepth (hub-spoke fillable ladder)', () => {
  test('USD-balanced seed ⇒ both sides have comparable tok depth', () => {
    // volState sets baseRes = res × twap ⇒ notionals match at mark.
    const d = virtualMarketDepth(volState(10), 'BTCB');
    expect(d.maxTokBid).toBeGreaterThan(0);
    expect(d.maxTokAsk).toBeGreaterThan(0);
    expect(d.maxTokAsk / d.maxTokBid).toBeGreaterThan(0.4);
    expect(d.maxTokAsk / d.maxTokBid).toBeLessThan(2.5);
    expect(d.bids.length).toBeGreaterThan(0);
    expect(d.asks.length).toBeGreaterThan(0);
    // Ladder ends at (or just under) the fillable caps — ask vertices use mid-sized
    // bands so the last knot can sit a hair below maxTokAsk without a forced terminal.
    expect(d.bids[d.bids.length - 1].cumTok).toBeLessThanOrEqual(d.maxTokBid + 1e-9);
    expect(d.asks[d.asks.length - 1].cumTok).toBeLessThanOrEqual(d.maxTokAsk + 1e-9);
    expect(d.bids[d.bids.length - 1].cumTok).toBeGreaterThan(d.maxTokBid * 0.99);
    expect(d.asks[d.asks.length - 1].cumTok).toBeGreaterThan(d.maxTokAsk * 0.99);
  });

  test('book is centered on skewed mid, not oracle mark', () => {
    // Mild under-coverage ⇒ positive inventory skew ⇒ mid ≠ mark; touch = mid.
    const twap = 64_000;
    const leg = buildLeg('BTCB', twap, sigmaSeed('volatile'), 8_000, 10_000, 8_000 * twap, 18, VOLATILE_PROFILE);
    const d = virtualMarketDepth({ base: BASE, legs: { BTCB: leg } }, 'BTCB');
    expect(d.mark).toBe(twap);
    expect(Math.abs(d.mid - d.mark) / d.mark).toBeGreaterThan(1e-6);
    // Both sides still have fillable depth at moderate skew.
    expect(d.asks.length).toBeGreaterThan(0);
    expect(d.bids.length).toBeGreaterThan(0);
    // First printed levels sit at the mid vertex (cumTok=0), not at mark.
    expect(d.asks[0].cumTok).toBe(0);
    expect(d.bids[0].cumTok).toBe(0);
    expect(d.asks[0].price).toBeCloseTo(d.mid, 6);
    expect(d.bids[0].price).toBeCloseTo(d.mid, 6);
    // Asks above mid, bids below — book fans from mid, not mark.
    if (d.asks.length > 1) expect(d.asks[1].price).toBeGreaterThanOrEqual(d.mid - 1e-9);
    if (d.bids.length > 1) expect(d.bids[1].price).toBeLessThanOrEqual(d.mid + 1e-9);
  });

  test('10k BTCB + 10k USDC (token seed) clips bid to ~USDC/mark, ask to ~½ BTCB', () => {
    const twap = 64_000;
    const leg = buildLeg('BTCB', twap, sigmaSeed('volatile'), 10_000, 10_000, 10_000, 18, VOLATILE_PROFILE);
    const d = virtualMarketDepth({ base: BASE, legs: { BTCB: leg } }, 'BTCB');
    // Bid limited by hub USDC ≈ 10k/64000 ≈ 0.156
    expect(d.maxTokBid).toBeLessThan(0.2);
    expect(d.maxTokBid).toBeGreaterThan(0.1);
    // Ask limited by half of spoke depth at center=5000
    expect(d.maxTokAsk).toBeGreaterThan(4_000);
    expect(d.maxTokAsk).toBeLessThan(10_000);
    // Printed ladder never exceeds the fillable caps
    expect(d.bids.every((l) => l.cumTok <= d.maxTokBid + 1e-9)).toBe(true);
    expect(d.asks.every((l) => l.cumTok <= d.maxTokAsk + 1e-9)).toBe(true);
  });
});

describe('compose + degenerate', () => {
  test('cross amountOut == gross two-leg composition with ONE path spread', () => {
    const state = crossState();
    const q = quoteExactIn(state, 'BTCB', 'ETH', 0.5);
    // manual: sell BTCB→USDC gross, buy ETH gross, then one half-spread haircut.
    const s1 = quoteExactIn({ base: BASE, legs: { BTCB: state.legs.BTCB } }, 'BTCB', BASE, 0.5);
    const s2 = quoteExactIn(
      { base: BASE, legs: { ETH: state.legs.ETH } },
      BASE,
      'ETH',
      s1.grossOut,
    );
    const half = (q.spreadBps * 100) / 2 / PBPS;
    expect(rel(q.amountOut, s2.grossOut * (1 - half))).toBeLessThan(1e-9);
  });
  test('S ≫ maxIn clamps grossOut to reserve·0.999 (staircase terminates)', () => {
    const state = volState();
    const q = quoteExactIn(state, BASE, 'BTCB', 1e12); // buy far past capacity
    expect(q.grossOut).toBeLessThanOrEqual(9.4 * 0.999 + 1e-9);
    expect(q.maxIn).toBeGreaterThan(0);
  });
  test('degenerate: same-token and zero-size', () => {
    const state = volState();
    expect(quoteExactIn(state, 'BTCB', 'BTCB', 1).amountOut).toBe(0);
    expect(quoteExactIn(state, 'BTCB', BASE, 0).amountOut).toBe(0);
    expect(quoteExactIn(state, 'BTCB', BASE, 0).midPrice).toBeGreaterThan(0); // rate still shown
  });
});

// Golden vectors emitted by aimm.rs quote() — proves faithfulness to the Rust reference, not just
// self-consistency. Each vector: a leg (twap/sigma/res) + amountIn/selling → gross exec price.
describe('golden vectors (faithful port of aimm.rs)', () => {
  const golden = goldenRaw as {
    profile: 'stable' | 'volatile';
    twap: number;
    sigma: number;
    res: number;
    liab: number;
    amountIn: number;
    selling: boolean;
    grossOut: number;
  }[];
  test('TS gross matches Rust across pairs × sizes × skews × σ', () => {
    expect(golden.length).toBeGreaterThan(0);
    for (const v of golden) {
      const profile = v.profile === 'stable' ? STABLE_PROFILE : VOLATILE_PROFILE;
      const leg = buildLeg('T', v.twap, v.sigma, v.res, v.liab, v.res * v.twap * 4, 18, profile);
      const state: PoolState = { base: BASE, legs: { T: leg } };
      const q = v.selling
        ? quoteExactIn(state, 'T', BASE, v.amountIn)
        : quoteExactIn(state, BASE, 'T', v.amountIn);
      expect(rel(q.grossOut, v.grossOut)).toBeLessThan(1e-6);
    }
  });
});
