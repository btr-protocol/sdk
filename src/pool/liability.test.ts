import { describe, expect, test } from 'bun:test';
// bun test — pins the swapLiability mirror against fixture numbers derived from the contract
// source (PoolLiquidity.sol applyHaircut :93 / swapLiability :411, PoolConstantsLib.sol:15/:106).
import { STABLE_PROFILE, sigmaSeed } from '../amm/__fixtures__/profiles';
import { type PoolState, buildLeg, quoteExactIn } from '../amm/aimm.js';
import {
  HAIRCUT_SUPPRESSOR_FULL_BPS,
  LIABILITY_SWAP_ENABLED_BIT,
  WAD,
  haircutFace,
  liabilitySwapEnabled,
  minLpAmountOut,
  quoteSwapLiability,
  quoteSwapLiabilityCore,
} from './liability';

const legOf = (symbol: string, reserves: number, liabilities: number) => ({
  symbol,
  reserves,
  liabilities,
  haircutSuppressorBps: 0,
});

// Balanced stable core: USDC hub + two $1 spokes. Small size ⇒ no clamp, negligible impact.
function balancedState(): PoolState {
  const p = STABLE_PROFILE;
  const sigma = sigmaSeed('stable');
  return {
    base: 'USDC',
    legs: {
      AUDF: buildLeg('AUDF', 1, sigma, 1_000_000, 1_000_000, 2_000_000, 6, p),
      NZDF: buildLeg('NZDF', 1, sigma, 1_000_000, 1_000_000, 2_000_000, 6, p),
    },
    hub: { res: 2_000_000, liab: 2_000_000, kappaCovBps: 0 },
  };
}

describe('haircutFace (applyHaircut mirror)', () => {
  // Hand-derived from PoolLiquidity.sol:93-112: R=800k L=1M ⇒ deficit 0.2; suppressor 10000 of a
  // FULL 20000 ⇒ factor 0.5 ⇒ ratio 0.1.
  test('half-suppressed 20% deficit takes exactly 10% of face', () => {
    const { actual, haircut } = haircutFace(1_000_000, 800_000, 1_000_000, 10_000);
    expect(haircut).toBe(100_000);
    expect(actual).toBe(900_000);
  });

  test('haircut rounds UP so the dust stays with the pool (:108-110)', () => {
    const { actual, haircut } = haircutFace(333_333, 800_000, 1_000_000, 10_000);
    expect(haircut).toBe(33_334); // ceil(33333.3)
    expect(actual).toBe(333_333 - 33_334);
  });

  test('identity when covered or liabilities empty (:99)', () => {
    expect(haircutFace(500, 1_000_000, 1_000_000, 0)).toEqual({ actual: 500, haircut: 0 });
    expect(haircutFace(500, 900, 0, 0)).toEqual({ actual: 500, haircut: 0 });
  });

  test('suppressor FULL (20000 bps) zeroes the factor; ratio caps at 100%', () => {
    expect(HAIRCUT_SUPPRESSOR_FULL_BPS).toBe(20_000);
    expect(haircutFace(100, 0, 1_000, HAIRCUT_SUPPRESSOR_FULL_BPS).haircut).toBe(0);
    // R = 0 with a near-full suppressor: tiny ratio still rounds UP to its own dust.
    const tiny = haircutFace(1_000, 0, 1_000, 19_999);
    expect(tiny.haircut).toBe(1); // ceil(1000 · 0.00005)
  });

  test('out-of-range suppressor fails closed instead of increasing the payout', () => {
    for (const bad of [-1, HAIRCUT_SUPPRESSOR_FULL_BPS + 1]) {
      expect(() => haircutFace(1_000, 0, 1_000, bad)).toThrow(RangeError);
    }
  });
});

describe('liabilitySwapEnabled (flag bit gate)', () => {
  test('bit 2 of asset flags (PoolConstantsLib.sol:15)', () => {
    expect(LIABILITY_SWAP_ENABLED_BIT).toBe(0b100);
    expect(liabilitySwapEnabled(0b100)).toBe(true);
    expect(liabilitySwapEnabled(0b111)).toBe(true);
    expect(liabilitySwapEnabled(0b011)).toBe(false);
  });
});

describe('quoteSwapLiabilityCore (pipeline order)', () => {
  const inLeg = legOf('AUDF', 1_000_000, 1_000_000);
  const outLeg = legOf('NZDF', 1_000_000, 1_000_000);
  function makeConvert(amountOut: number, markPrice = 1) {
    const convert = (fairIn: number) => {
      void fairIn;
      return {
        amountOut,
        grossOut: amountOut,
        avgPrice: amountOut / Math.max(fairIn, 1e-9),
        midPrice: markPrice,
        markPrice,
        midPremiumBps: 0,
        netPremiumBps: 0,
        priceImpactBps: 0,
        spreadBps: 40,
        lpFeeBps: 0,
        protoFeeBps: 0,
        covTollBps: 0,
        maxIn: Number.POSITIVE_INFINITY,
        route: ['AUDF', 'USDC', 'NZDF'],
      };
    };
    return convert;
  }

  test('balanced legs at mark: no haircuts, conversion passes through unclamped', () => {
    const q = quoteSwapLiabilityCore(inLeg, outLeg, 10_000, makeConvert(9_990));
    expect(q).not.toBeNull();
    expect(q?.liabIn).toBe(10_000);
    expect(q?.fairIn).toBe(10_000);
    expect(q?.markCap).toBeCloseTo(10_000 * 1, 6);
    expect(q?.markCapBinding).toBe(false);
    expect(q?.conv).toBe(9_990);
    expect(q?.liabOut).toBeCloseTo(9_990, 6);
    expect(q?.lpAmountOut).toBeCloseTo(9_990, 6);
    // Impact vs the 1:1-face baseline is exactly the conversion shortfall.
    expect(q?.impactBps).toBeCloseTo((1 - 9_990 / 10_000) * 1e4, 6);
    expect(q?.haircutInBps).toBe(0);
    expect(q?.haircutOutBps).toBe(0);
  });

  test('Lemma B clamp: conv quoted past the oracle mark is capped at fairIn·markPrice (:442)', () => {
    // 2% skew premium quoted over a 1.0 mark ⇒ cap binds at 1% over face... here mark 1.0, fair 10k.
    const q = quoteSwapLiabilityCore(inLeg, outLeg, 10_000, makeConvert(10_400, 1));
    expect(q?.markCapBinding).toBe(true);
    expect(q?.conv).toBe(10_000); // fairIn · markPrice
    expect(q?.liabOut).toBe(10_000);
    expect(q?.markClampBps).toBeCloseTo(((10_400 - 10_000) / 10_400) * 1e4, 6);
  });

  test('in-leg haircut applies BEFORE conversion and pricing (:435-437)', () => {
    const shortIn = { ...inLeg, reserves: 800_000 }; // 20% deficit, suppressor 0 ⇒ 20% haircut
    let sawFairIn = 0;
    const q = quoteSwapLiabilityCore(shortIn, outLeg, 10_000, (fairIn) => {
      sawFairIn = fairIn;
      return makeConvert(9_990)(fairIn);
    });
    expect(q?.haircutIn).toBe(2_000);
    expect(q?.fairIn).toBe(8_000);
    // Conversion saw the POST-haircut face only.
    expect(sawFairIn).toBe(8_000);
  });

  test('out-leg haircut applies AGAIN after the mark cap (:454)', () => {
    const shortOut = { ...outLeg, reserves: 750_000 }; // 25% deficit, suppressor 0
    const q = quoteSwapLiabilityCore(inLeg, shortOut, 10_000, makeConvert(9_990));
    expect(q?.haircutOut).toBe(2_498); // ceil(9990 · 0.25 = 2497.5)
    expect(q?.liabOut).toBeCloseTo(9_990 - 2_498, 6);
  });

  test('zero-output guard: fully hair-cut out-leg reverts to null (:468)', () => {
    const deadOut = { ...outLeg, reserves: 0 }; // R=0, suppressor 0 ⇒ 100% haircut
    expect(quoteSwapLiabilityCore(inLeg, deadOut, 10_000, makeConvert(9_990))).toBeNull();
  });

  test('burn past live liabilities reverts to null (:429)', () => {
    expect(quoteSwapLiabilityCore(inLeg, outLeg, inLeg.liabilities + 1, makeConvert(1))).toBeNull();
    expect(
      quoteSwapLiabilityCore({ ...inLeg, liabilities: 0 }, outLeg, 1, makeConvert(1)),
    ).toBeNull();
  });

  test('share indices convert shares ↔ face on both legs', () => {
    const idx = WAD * 1.05;
    const q = quoteSwapLiabilityCore(
      { ...inLeg, indexWad: idx },
      { ...outLeg, indexWad: idx },
      10_000, // shares
      makeConvert(10_450), // 10k face · 1.05 → face out
    );
    expect(q?.liabIn).toBeCloseTo(10_500, 6); // 10_000 · 1.05
    expect(q?.lpAmountOut).toBeCloseTo(10_450 / 1.05, 4); // face back to shares
  });
});

describe('quoteSwapLiability (bound to aimm.quoteExactIn)', () => {
  test('balanced pool: small transfer loses only the path spread, never clamps', () => {
    const state = balancedState();
    const inLeg = { ...legOf('AUDF', 1_000_000, 1_000_000), haircutSuppressorBps: 0 };
    const q = quoteSwapLiability(state, inLeg, legOf('NZDF', 1_000_000, 1_000_000), 5_000);
    expect(q).not.toBeNull();
    expect(q?.markCapBinding).toBe(false);
    // Mark is 1.0 and the book quotes around it, so received face < moved face by spread only.
    expect(q?.liabOut).toBeLessThan(5_000);
    expect(q?.liabOut).toBeGreaterThan(4_900);
    const direct = quoteExactIn(state, 'AUDF', 'NZDF', 5_000);
    expect(q?.convQuoted).toBe(direct.amountOut);
    // Protocol fee exempt + no LP-fee booking: cost decomposition carries no fee rows.
    expect(direct.protoFeeBps).toBeGreaterThanOrEqual(0); // quoted, but NOT charged on this path
    expect(q?.haircutIn).toBe(0);
    expect(q?.haircutOut).toBe(0);
  });

  test('under-covered in-leg: haircut-in dominates and matches the standalone mirror', () => {
    const state = balancedState();
    const inLeg = legOf('AUDF', 600_000, 1_000_000); // 40% deficit
    const outLeg = legOf('NZDF', 1_000_000, 1_000_000);
    const q = quoteSwapLiability(state, inLeg, outLeg, 10_000);
    const { haircut } = haircutFace(10_000, 600_000, 1_000_000, 0);
    expect(q?.haircutIn).toBe(haircut);
    expect(q?.haircutInBps).toBeCloseTo(4_000, 6);
    expect(q?.convQuoted).toBe(quoteExactIn(state, 'AUDF', 'NZDF', 6_000).amountOut);
  });
});

describe('minLpAmountOut (applySlip semantics, rounds DOWN)', () => {
  test('0.5% default guard', () => {
    expect(minLpAmountOut(1_000_001n, 0.005)).toBe(995_000n); // floor(1000001·0.995)
    expect(minLpAmountOut(1_000_000n, 0.005)).toBe(995_000n);
  });
  test('zero slip is identity; invalid slip throws like planToLegs', () => {
    expect(minLpAmountOut(123n, 0)).toBe(123n);
    expect(() => minLpAmountOut(123n, 1)).toThrow();
    expect(() => minLpAmountOut(123n, Number.NaN)).toThrow();
  });
});
