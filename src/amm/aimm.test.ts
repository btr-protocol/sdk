import { describe, expect, test } from 'bun:test';
// bun test — proves the shared model self-consistent (chart == quote) and the quartic curve
// primitives (evalQ/areaQ/buildCurve) bit-faithful to NUQuartic.sol via the on-chain parity vectors.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOOTSTRAP_VOLATILE_CURVE,
  CURVE_PRESETS,
  STABLE_PROFILE,
  VOLATILE_PROFILE,
  findPreset,
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
  curveDensity,
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

// One under-covered spoke (c<1, toll binds) and one over-covered (c>1, toll-free) — both κ>0.
function tolledState(): PoolState {
  const mk = (t: string, res: number) =>
    buildLeg(t, 1, sigmaSeed('stable'), res, 1e6, 5e6, 18, STABLE_PROFILE, 5_000);
  return { base: BASE, legs: { RLUSD: mk('RLUSD', 999e3), DAI: mk('DAI', 1.2e6) } };
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// Integrate the RENDERED marginal ladder (trapezoid) up to cumulative token size S → the base
// filled. Must track the quote's NET output (chart == quote). The quartic marginal is degree-4
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

// The printed ladder is the SKEW-implied curve, so it integrates to `grossOut`; `netPrice` carries
// the fee/toll haircut and recovers `amountOut`. Both must hold, or the book has lost the cost.
describe('invariant: rendered depth tracks grossOut, netPrice tracks amountOut', () => {
  test('SELL ladder integral reproduces grossOut (direct)', () => {
    const state = volState();
    const curve = depthCurve(state, 'BTCB', BASE);
    for (const S of [0.05, 0.5, 1.5, 3.2, 4.6]) {
      const q = quoteExactIn(state, 'BTCB', BASE, S);
      // Quartic marginal is degree-4 between vertices ⇒ trapezoid ladder ≈ exact area.
      expect(rel(integrateLadder(curve.bids, S), q.grossOut)).toBeLessThan(2e-3);
    }
  });
  test('BUY book vertices are quote-consistent (direct), gross and net', () => {
    const state = volState();
    const curve = depthCurve(state, BASE, 'BTCB');
    for (const lvl of curve.asks) {
      if (lvl.cumBase <= 0) continue;
      const q = quoteExactIn(state, BASE, 'BTCB', lvl.cumBase);
      expect(rel(q.grossOut, lvl.cumTok)).toBeLessThan(1e-9);
      // netPrice is the marginal executable rate; the average over the whole rung reproduces the
      // fill, so cumBase / netPrice at the terminal vertex is what the trader receives.
      expect(rel(q.amountOut, lvl.cumTok * (lvl.price / lvl.netPrice))).toBeLessThan(1e-9);
    }
  });
  test('CROSS swept nodes reproduce quoteExactIn', () => {
    const state = crossState();
    const curve = depthCurve(state, 'BTCB', 'ETH');
    for (const lvl of curve.asks) {
      if (lvl.cumBase <= 0) continue;
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
  // The PRINTED book has no touch spread: pre-fee and pre-toll, this AMM's bid and ask coincide
  // at size 0 (both are priceAt(center)). Every bp of bid/ask gap is fee or toll, and it belongs
  // in `netPrice`, not in the rung. Rendering it as the rung is what printed a ±45 bp WBTC/WETH
  // touch that was entirely minFee plus oracle confidence.
  test('printed touch has ZERO spread; the whole gap lives in netPrice', () => {
    const curve = depthCurve(volState(), 'BTCB', BASE);
    const q = quoteExactIn(volState(), 'BTCB', BASE, 0);
    expect(curve.asks[0].price).toBe(curve.mid);
    expect(curve.bids[0].price).toBe(curve.mid);
    expect(
      rel(((curve.asks[0].netPrice - curve.bids[0].netPrice) / curve.mid) * 1e4, q.spreadBps),
    ).toBeLessThan(1e-3); // κ=0 ⇒ gap is 1/(1−h)−(1−h), i.e. 2h to O(h²)
  });
});

// GATE-07 is charged once on the TERMINAL out asset and the base can never carry κ, so a sell into
// the base is toll-free while a buy of an under-covered spoke pays from the first wei.
describe('skew book + separately disclosed cost: touch, toll asymmetry, reserve cliff', () => {
  const offBp = (price: number, mid: number) => (price / mid - 1) * 1e4;
  // The touch the UI PRINTS (skew) and the cost it discloses beside it (netPrice vs the rung).
  const touch = (state: PoolState, tok: string) => {
    const c = depthCurve(state, BASE, tok);
    return {
      ask: offBp(c.asks[0].price, c.mid),
      bid: offBp(c.bids[0].price, c.mid),
      askCost: offBp(c.asks[0].netPrice, c.mid),
      bidCost: offBp(c.bids[0].netPrice, c.mid),
      c,
    };
  };

  test('printed touch is the skew anchor on BOTH sides, whatever the fee and toll do', () => {
    for (const tok of ['DAI', 'RLUSD']) {
      const { ask, bid, c } = touch(tolledState(), tok);
      expect(ask).toBe(0);
      expect(bid).toBe(0);
      expect(c.spreadBps).toBeGreaterThan(0); // a real fee exists; it just is not the touch
    }
  });

  // Regression on the shipped bug: a WBTC/WETH book printed a ±45 bp touch that was minFee plus
  // an oracle-confidence surcharge, against a few bp of real skew. The touch must track the skew
  // premium and must NOT scale with the fee, on a quiet pair or a wide one.
  test.each([
    ['stable', () => tolledState(), 'DAI'],
    ['volatile', () => volState(), 'BTCB'],
  ])('%s touch is the skew premium, never spreadBps/2', (_kind, mk, tok) => {
    const state = mk();
    const c = depthCurve(state, BASE, tok);
    const touchBp = (c.asks[0].price / c.mark - 1) * 1e4;
    const skewBp = (c.mid / c.mark - 1) * 1e4;
    expect(touchBp).toBe(skewBp); // the touch IS the skew, by construction
    expect(Math.abs(touchBp)).toBeLessThan(50); // believable: inventory skew, not a fee
    // Widening the fee 10x must not move the printed touch by a single bp.
    const wide = {
      ...state,
      legs: {
        ...state.legs,
        [tok]: {
          ...state.legs[tok]!,
          profile: {
            ...state.legs[tok]!.profile,
            minFee: state.legs[tok]!.profile.minFee * 10,
            maxFee: state.legs[tok]!.profile.maxFee * 10, // else the ceiling clamps the widening
          },
        },
      },
    };
    const cw = depthCurve(wide, BASE, tok);
    expect(cw.spreadBps).toBeGreaterThan(c.spreadBps * 2); // the fee really did widen
    expect(cw.asks[0].price).toBe(c.asks[0].price); // …and the touch did not move
    expect(cw.asks[0].netPrice).toBeGreaterThan(c.asks[0].netPrice); // the COST did
  });

  test('over-covered leg (c ≥ 1): toll is 0 ⇒ cost symmetric about mid', () => {
    const { askCost, bidCost, c } = touch(tolledState(), 'DAI');
    expect(Math.abs(askCost + bidCost)).toBeLessThan(0.01); // bp
    expect(rel(askCost - bidCost, c.spreadBps)).toBeLessThan(1e-3);
  });

  test('under-covered leg (c < 1, κ > 0): ask cost carries the toll, bid cost does not', () => {
    const state = tolledState();
    const { askCost, bidCost, c } = touch(state, 'RLUSD');
    const leg = state.legs.RLUSD!;
    const tollBp = (leg.kappaCovBps / 1e4) * (leg.liab / leg.res - 1) * 1e4;
    expect(tollBp).toBeGreaterThan(1);
    expect(rel(-bidCost, c.spreadBps / 2)).toBeLessThan(1e-3); // sell into base: half-spread only
    expect(rel(askCost - c.spreadBps / 2, tollBp)).toBeLessThan(2e-2); // buy: half-spread + toll
    expect(askCost + bidCost).toBeGreaterThan(0.9 * tollBp); // asymmetric by the toll
  });

  // Past the reserve clip `_covToll` returns grossOut, so amountOut is 0 with a normally populated
  // struct (no revert). The ladder must stop at the last size that actually fills.
  test.each([
    ['direct', BASE, 'RLUSD'],
    ['cross', 'DAI', 'RLUSD'],
  ])('%s ladder terminates before the reserve cliff', (_kind, from, to) => {
    const state = tolledState();
    const c = depthCurve(state, from, to);
    expect(c.asks.length).toBeGreaterThan(1);
    for (const l of c.asks) {
      if (l.cumBase <= 0) continue;
      expect(l.cumTok).toBeGreaterThan(0);
      expect(quoteExactIn(state, from, to, l.cumBase).amountOut).toBeGreaterThan(0);
    }
    const end = c.asks[c.asks.length - 1].cumBase;
    expect(quoteExactIn(state, from, to, end * 2).amountOut).toBe(0); // the cliff is real…
    expect(quoteExactIn(state, from, to, end).amountOut).toBeGreaterThan(0); // …and never printed
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
    // First printed levels are the TOUCH at the mid vertex (cumTok=0): the skewed mid itself,
    // never mark and never a half-spread off it. The half-spread is the COST, on netPrice.
    expect(d.asks[0].cumTok).toBe(0);
    expect(d.bids[0].cumTok).toBe(0);
    expect(d.asks[0].price).toBe(d.mid);
    expect(d.bids[0].price).toBe(d.mid);
    const h = d.spreadBps / 2 / 1e4;
    expect(rel(d.asks[0].netPrice, d.mid / (1 - h))).toBeLessThan(1e-12);
    expect(rel(d.bids[0].netPrice, d.mid * (1 - h))).toBeLessThan(1e-12);
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
  // The clip is EXACT on chain (`_legScaleOut`, Pricing.sol:561-562). A `res·0.999` haircut here
  // made `_covToll`'s full-block branch (`grossOut >= r0` ⇒ toll eats the fill ⇒ the swap reverts
  // ZeroValue) structurally unreachable in the mirror, so the UI advertised fills the chain refuses.
  test('S ≫ maxIn clips grossOut EXACTLY to reserves; κ>0 then blocks the whole fill', () => {
    const q = quoteExactIn(volState(), BASE, 'BTCB', 1e12); // buy far past capacity
    expect(q.grossOut).toBe(9.4);
    expect(q.amountOut).toBeGreaterThan(0); // κ=0: the clipped fill still pays out
    expect(q.maxIn).toBeGreaterThan(0);

    const state = volState();
    state.legs.BTCB = { ...state.legs.BTCB!, kappaCovBps: 100 };
    const qk = quoteExactIn(state, BASE, 'BTCB', 1e12);
    expect(qk.grossOut).toBe(9.4);
    expect(qk.amountOut).toBe(0);
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

describe('curveDensity (offset-space liquidity density)', () => {
  const trapz = (pts: [number, number][]): number => {
    let a = 0;
    for (let i = 1; i < pts.length; i++) {
      a += 0.5 * (pts[i][1] + pts[i - 1][1]) * (pts[i][0] - pts[i - 1][0]);
    }
    return a;
  };

  test('unit area, ascending offsets, all-finite on the bootstrap ramp', () => {
    const pts = curveDensity(BOOTSTRAP_VOLATILE_CURVE, 1000);
    expect(pts.length).toBeGreaterThan(100);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    for (const [o, d] of pts) {
      expect(Number.isFinite(o)).toBe(true);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
    expect(Math.abs(trapz(pts) - 1)).toBeLessThan(0.02);
  });

  test('symmetric ramp → symmetric density', () => {
    const pts = curveDensity(BOOTSTRAP_VOLATILE_CURVE, 1000);
    const n = pts.length;
    const span = pts[n - 1][0] - pts[0][0];
    for (let i = 0; i < n; i++) {
      expect(Math.abs(pts[i][0] + pts[n - 1 - i][0])).toBeLessThan(span * 1e-9 + 1e-9);
      expect(Math.abs(pts[i][1] - pts[n - 1 - i][1]) / pts[i][1]).toBeLessThan(1e-6);
    }
  });

  test('dispersion scales offsets ∝ s and density ∝ 1/s', () => {
    const a = curveDensity(BOOTSTRAP_VOLATILE_CURVE, 1000);
    const b = curveDensity(BOOTSTRAP_VOLATILE_CURVE, 2000);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i][0]).toBeCloseTo(2 * a[i][0], 8);
      expect(b[i][1]).toBeCloseTo(a[i][1] / 2, 8);
    }
  });

  test('lepto W5 preset: finite density, ascending offsets', () => {
    const p = findPreset('lepto', 5);
    expect(p).toBeDefined();
    if (!p) return;
    const pts = curveDensity(presetCurve(p), p.dispRef);
    expect(pts.length).toBeGreaterThan(50);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    for (const [, d] of pts) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
    expect(Math.abs(trapz(pts) - 1)).toBeLessThan(0.05);
  });

  test('hard plateau segments merge — no Inf/NaN (scaleY-truncation guard)', () => {
    // Flat edges (Δw=0 on the first/last spans) would make scaleY-based Δy = 0 → density Inf.
    const step = 125_000_000_000n;
    const flat = buildCurve(
      [2000, 4000, 6000, 8000],
      [-4n, -4n, -4n, -4n, 0n, 4n, 4n, 4n, 4n].map((v) => v * step),
      1000,
    );
    const pts = curveDensity(flat, 1000);
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
    for (const [, d] of pts) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
    const area = trapz(pts);
    expect(area).toBeGreaterThan(0.7);
    expect(area).toBeLessThan(1.3);
  });
});
