import { describe, expect, test } from 'bun:test';
// bun test — proves the shared model self-consistent (chart == quote) and the quartic curve
// primitives (evalQ/areaQ/buildCurve) bit-faithful to NUQuartic.sol via the on-chain parity vectors.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CURVE_PRESETS,
  STABLE_PROFILE,
  VOLATILE_PROFILE,
  presetCurve,
  sigmaSeed,
} from './__fixtures__/profiles';
import {
  type DepthLevel,
  PBPS,
  type PoolState,
  areaQ,
  buildCurve,
  buildLeg,
  calcDepth,
  computeSkew,
  covQ,
  covToll,
  depthCurve,
  dispersion,
  evalQ,
  quoteExactIn,
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

// Integrate the RENDERED marginal ladder (trapezoid) up to cumulative token size S → the base
// filled. Must track the quote's gross output (chart == quote). The quartic marginal is degree-4
// in the depth coord, so the polyline trapezoid is an approximation — tolerance reflects that.
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

describe('model primitives (Pricing.sol mirrors)', () => {
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

// ── NUQuartic mirror: exact-integer parity vs the on-chain vectors ──────────────
// Same fixture the Solidity suite (dex/evm/test/unit/NUQuartic.t.sol) certifies against; the
// vectors' yQ/aQ were emitted by the float fitter, so parity carries the SAME tolerances as the
// Sol test (eval ≤ 200 pbps·1e-9 units; area ≤ 1e-6 rel + 0.1 pbps·x abs). BigInt evalQ/areaQ
// reproduce Solidity truncation exactly, so agreeing within those bands ⇒ on-chain agreement.
const VECTORS_PATH = resolve(
  new URL('.', import.meta.url).pathname,
  '../../..',
  'dex/evm/test/proto/quartic_vectors.json',
);
interface ParityVec {
  interior: number[];
  wQ: number[];
  xs: number[];
  yQ: number[];
  areas: { x1: number; x2: number; aQ: number }[];
}
const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf8')) as Record<string, ParityVec>;

describe('NUQuartic parity (quartic_vectors.json — same integer math as evalQ/areaQ on-chain)', () => {
  test('evalQ matches every shape family within the on-chain parity band', () => {
    let worst = 0n;
    let worstAt = '';
    for (const [name, v] of Object.entries(vectors)) {
      const c = buildCurve(v.interior, v.wQ.map(BigInt), 500);
      for (let i = 0; i < v.xs.length; i++) {
        let d = evalQ(c, v.xs[i]) - BigInt(v.yQ[i]);
        if (d < 0n) d = -d;
        if (d > worst) {
          worst = d;
          worstAt = `${name} @ x=${v.xs[i]}`;
        }
      }
    }
    // Report the worst |Δ| (pbps·1e-9 units) — mirrors NUQuartic.t.sol's assertLe(worst, 200).
    console.log(`evalQ parity worst |Δ| = ${worst} (pbps·1e-9) at ${worstAt}`);
    expect(worst).toBeLessThanOrEqual(200n);
  });

  test('areaQ matches every shape family within the on-chain parity band', () => {
    for (const [name, v] of Object.entries(vectors)) {
      const c = buildCurve(v.interior, v.wQ.map(BigInt), 500);
      for (const a of v.areas) {
        let d = areaQ(c, a.x1, a.x2) - BigInt(a.aQ);
        if (d < 0n) d = -d;
        const mag = a.aQ < 0 ? -a.aQ : a.aQ;
        expect(Number(d)).toBeLessThanOrEqual(mag / 1_000_000 + 100_000_000);
        if (Number(d) > mag / 1_000_000 + 100_000_000) console.log(`area ${name}`, a, d);
      }
    }
  });

  test('monotone: Δw≥0 ⇒ nondecreasing evalQ on every shape', () => {
    for (const v of Object.values(vectors)) {
      const c = buildCurve(v.interior, v.wQ.map(BigInt), 500);
      let prev = evalQ(c, 0);
      for (let x = 10; x <= 10_000; x += 10) {
        const y = evalQ(c, x);
        expect(y).toBeGreaterThanOrEqual(prev - 10n); // 1e-8 pbps slack (NUQuartic.t.sol)
        prev = y;
      }
    }
  });

  test('areaQ == Riemann sum of evalQ (internal consistency)', () => {
    const v = vectors.hyper;
    const c = buildCurve(v.interior, v.wQ.map(BigInt), 500);
    const [lo, hi] = [200, 9800];
    let riemann = 0;
    const n = 9600;
    for (let i = 0; i < n; i++) {
      const x0 = lo + ((hi - lo) * i) / n;
      const x1 = lo + ((hi - lo) * (i + 1)) / n;
      riemann += 0.5 * (Number(evalQ(c, x0)) + Number(evalQ(c, x1))) * (x1 - x0);
    }
    const exact = Number(areaQ(c, lo, hi));
    expect(rel(exact, riemann)).toBeLessThan(1e-4);
  });

  test('buildCurve validation mirrors NUQuartic.set reverts', () => {
    const v = vectors.hyper;
    const wQ = v.wQ.map(BigInt);
    const dec = [...wQ];
    dec[dec.length - 1] = dec[0] - 1n;
    expect(() => buildCurve(v.interior, dec, 500)).toThrow(); // Δw<0
    expect(() =>
      buildCurve(
        v.interior,
        wQ.map(() => wQ[0]),
        500,
      ),
    ).toThrow(); // flat
    const badKnot = [...v.interior];
    badKnot[badKnot.length - 1] = 10_000;
    expect(() => buildCurve(badKnot, wQ, 500)).toThrow(); // knot ≥ BPS
  });

  test('fixture preset table: portable-only, wQ quantization identical to the exported vectors', () => {
    expect(CURVE_PRESETS.length).toBeGreaterThan(0);
    // W5 presets are the unprefixed vector families — same quantized wQ by construction.
    for (const p of CURVE_PRESETS.filter((x) => x.W === 5)) {
      const v = vectors[p.regime];
      if (!v) continue; // pin variants have no exported vector family
      expect(p.interior).toEqual(v.interior);
      expect(p.wQ.map(Number)).toEqual(v.wQ);
      expect(() => presetCurve(p)).not.toThrow();
    }
  });
});

describe('invariant: integrating the rendered depth tracks quote.grossOut', () => {
  test('SELL ladder integral reproduces grossOut (direct)', () => {
    const state = volState();
    const curve = depthCurve(state, 'BTCB', BASE);
    for (const S of [0.05, 0.5, 1.5, 3.2, 4.6]) {
      const q = quoteExactIn(state, 'BTCB', BASE, S);
      // Quartic marginal is degree-4 between vertices ⇒ trapezoid ladder ≈ exact area.
      expect(rel(integrateLadder(curve.bids, S), q.grossOut)).toBeLessThan(2e-3);
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
    expect(qTolled.grossOut).toBeCloseTo(qFree.grossOut, 9); // toll doesn't touch the pure curve
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
    expect(d.bids[d.bids.length - 1].cumTok).toBeGreaterThan(d.maxTokBid * 0.95);
    expect(d.asks[d.asks.length - 1].cumTok).toBeGreaterThan(d.maxTokAsk * 0.95);
  });

  test('book is centered on skewed mid, not oracle mark', () => {
    // Mild under-coverage ⇒ positive inventory skew ⇒ mid ≠ mark; touch = mid.
    const twap = 64_000;
    const leg = buildLeg(
      'BTCB',
      twap,
      sigmaSeed('volatile'),
      8_000,
      10_000,
      8_000 * twap,
      18,
      VOLATILE_PROFILE,
    );
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
    const leg = buildLeg(
      'BTCB',
      twap,
      sigmaSeed('volatile'),
      10_000,
      10_000,
      10_000,
      18,
      VOLATILE_PROFILE,
    );
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

describe('fallback quote (presetId 0 — skew-anchored linear impact)', () => {
  const noCurve = { ...VOLATILE_PROFILE, curve: null };
  test('quotes stay live without a preset; impact grows with size', () => {
    const leg = buildLeg(
      'BTCB',
      62_000,
      sigmaSeed('volatile'),
      9.4,
      9.4,
      9.4 * 62_000,
      18,
      noCurve,
    );
    const state: PoolState = { base: BASE, legs: { BTCB: leg } };
    const small = quoteExactIn(state, 'BTCB', BASE, 0.1);
    const large = quoteExactIn(state, 'BTCB', BASE, 3);
    expect(small.amountOut).toBeGreaterThan(0);
    expect(large.amountOut).toBeGreaterThan(0);
    // avg fill degrades with size (selling: mid·(1 − impact/2))
    expect(large.grossOut / 3).toBeLessThan(small.grossOut / 0.1);
    // size-0 mid = skewToPrice(mark, skew=0) = mark at c=1
    expect(small.midPrice).toBeCloseTo(62_000, 6);
  });
  test('depth chart still renders off the fallback marginal', () => {
    const leg = buildLeg(
      'BTCB',
      62_000,
      sigmaSeed('volatile'),
      9.4,
      9.4,
      9.4 * 62_000,
      18,
      noCurve,
    );
    const d = virtualMarketDepth({ base: BASE, legs: { BTCB: leg } }, 'BTCB');
    expect(d.asks.length).toBeGreaterThan(0);
    expect(d.bids.length).toBeGreaterThan(0);
  });
});
