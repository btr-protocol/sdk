import { describe, expect, test } from 'bun:test';
// bun test: pins the swapLiability mirror against fixture numbers derived from the contract
// source (PoolLiquidity.sol applyHaircut :93 / swapLiability :411, PoolConstantsLib.sol:15/:106).
import { STABLE_PROFILE, sigmaSeed } from '../amm/__fixtures__/profiles';
import { type PoolState, buildLeg } from '../amm/aimm.js';
import {
  HAIRCUT_SUPPRESSOR_FULL_BPS,
  LIABILITY_SWAP_ENABLED_BIT,
  WAD,
  haircutFace,
  liabilitySwapEnabled,
  minLpAmountOut,
  quoteSwapLiabilityAsync,
  quoteSwapLiabilityCore,
  quoteSwapLiabilityCoreAsync,
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

describe('quoteSwapLiabilityCore (sync stub)', () => {
  test('sync entry throws: conversion is backend SSOT, use the Async core', () => {
    expect(() => quoteSwapLiabilityCore()).toThrow();
  });
});

describe('quoteSwapLiabilityCoreAsync (pipeline order)', () => {
  const inLeg = legOf('AUDF', 1_000_000, 1_000_000);
  const outLeg = legOf('NZDF', 1_000_000, 1_000_000);
  function makeConvert(amountOut: number, markPrice = 1) {
    const convert = async (fairIn: number) => {
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

  test('balanced legs at mark: no haircuts, conversion passes through unclamped', async () => {
    const q = await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, makeConvert(9_990));
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

  test('Lemma B clamp: conv quoted past the oracle mark is capped at fairIn·markPrice (:442)', async () => {
    // 2% skew premium quoted over a 1.0 mark ⇒ cap binds at 1% over face... here mark 1.0, fair 10k.
    const q = await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, makeConvert(10_400, 1));
    expect(q?.markCapBinding).toBe(true);
    expect(q?.conv).toBe(10_000); // fairIn · markPrice
    expect(q?.liabOut).toBe(10_000);
    expect(q?.markClampBps).toBeCloseTo(((10_400 - 10_000) / 10_400) * 1e4, 6);
  });

  test('in-leg haircut applies BEFORE conversion and pricing (:435-437)', async () => {
    const shortIn = { ...inLeg, reserves: 800_000 }; // 20% deficit, suppressor 0 ⇒ 20% haircut
    let sawFairIn = 0;
    const q = await quoteSwapLiabilityCoreAsync(shortIn, outLeg, 10_000, async (fairIn) => {
      sawFairIn = fairIn;
      return makeConvert(9_990)(fairIn);
    });
    expect(q?.haircutIn).toBe(2_000);
    expect(q?.fairIn).toBe(8_000);
    // Conversion saw the POST-haircut face only.
    expect(sawFairIn).toBe(8_000);
  });

  test('out-leg haircut applies AGAIN after the mark cap (:454)', async () => {
    const shortOut = { ...outLeg, reserves: 750_000 }; // 25% deficit, suppressor 0
    const q = await quoteSwapLiabilityCoreAsync(inLeg, shortOut, 10_000, makeConvert(9_990));
    expect(q?.haircutOut).toBe(2_498); // ceil(9990 · 0.25 = 2497.5)
    expect(q?.liabOut).toBeCloseTo(9_990 - 2_498, 6);
  });

  test('zero-output guard: fully hair-cut out-leg reverts to null (:468)', async () => {
    const deadOut = { ...outLeg, reserves: 0 }; // R=0, suppressor 0 ⇒ 100% haircut
    expect(
      await quoteSwapLiabilityCoreAsync(inLeg, deadOut, 10_000, makeConvert(9_990)),
    ).toBeNull();
  });

  test('burn past live liabilities reverts to null (:429)', async () => {
    expect(
      await quoteSwapLiabilityCoreAsync(inLeg, outLeg, inLeg.liabilities + 1, makeConvert(1)),
    ).toBeNull();
    expect(
      await quoteSwapLiabilityCoreAsync({ ...inLeg, liabilities: 0 }, outLeg, 1, makeConvert(1)),
    ).toBeNull();
  });

  test('share indices convert shares ↔ face on both legs', async () => {
    const idx = WAD * 1.05;
    const q = await quoteSwapLiabilityCoreAsync(
      { ...inLeg, indexWad: idx },
      { ...outLeg, indexWad: idx },
      10_000, // shares
      makeConvert(10_450), // 10k face · 1.05 → face out
    );
    expect(q?.liabIn).toBeCloseTo(10_500, 6); // 10_000 · 1.05
    expect(q?.lpAmountOut).toBeCloseTo(10_450 / 1.05, 4); // face back to shares
  });
});

describe('quoteSwapLiabilityAsync (backend POST /v1/quote legs)', () => {
  const meta = {
    addressOf: () => null,
    decimalsOf: () => 6,
  };
  const backendOpts = { meta, baseDecimals: 6, backendBase: 'https://q.example/v1' };

  const quoteWire = (amountOutRaw: bigint, midWad = 10n ** 18n) => ({
    amount_out: `0x${amountOutRaw.toString(16)}`,
    gross_out: `0x${amountOutRaw.toString(16)}`,
    avg_price: `0x${midWad.toString(16)}`,
    mid_price: `0x${midWad.toString(16)}`,
    mark_price: `0x${midWad.toString(16)}`,
    spread_pbps: 40,
    cov_toll: '0x0',
    proto_fee: '0x0',
    lp_fee: '0x0',
  });

  test('balanced pool: spoke cross routes over POST /v1/route, never clamps', async () => {
    const outs = [4_990_000_000n, 4_985_000_000n];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string, init: { body?: string }) => {
      if (String(url).endsWith('/route')) {
        const body = JSON.parse(init.body ?? '{}');
        return {
          ok: true,
          json: async () => ({
            best_amount_out: body.amount_in,
            best_is_split: false,
            best_parts: [],
            singles: [],
          }),
        };
      }
      return { ok: true, json: async () => quoteWire(outs.shift() ?? 0n) };
    };
    try {
      const state = balancedState();
      const inLeg = { ...legOf('AUDF', 1_000_000, 1_000_000), haircutSuppressorBps: 0 };
      const q = await quoteSwapLiabilityAsync(
        state,
        inLeg,
        legOf('NZDF', 1_000_000, 1_000_000),
        5_000,
        backendOpts,
      );
      expect(q).not.toBeNull();
      expect(q?.markCapBinding).toBe(false);
      expect(q?.convQuoted).toBeCloseTo(5_000, 6);
      expect(q?.haircutIn).toBe(0);
      expect(q?.haircutOut).toBe(0);
    } finally {
      // @ts-expect-error restore the real fetch
      globalThis.fetch = undefined;
    }
  });

  test('under-covered in-leg: haircut-in dominates before the backend conversion', async () => {
    const outs = [5_940_000_000n, 5_934_000_000n];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string, init: { body?: string }) => {
      if (String(url).endsWith('/route')) {
        const body = JSON.parse(init.body ?? '{}');
        return {
          ok: true,
          json: async () => ({
            best_amount_out: body.amount_in,
            best_is_split: false,
            best_parts: [],
            singles: [],
          }),
        };
      }
      return { ok: true, json: async () => quoteWire(outs.shift() ?? 0n) };
    };
    try {
      const state = balancedState();
      const inLeg = legOf('AUDF', 600_000, 1_000_000); // 40% deficit
      const outLeg = legOf('NZDF', 1_000_000, 1_000_000);
      const q = await quoteSwapLiabilityAsync(state, inLeg, outLeg, 10_000, backendOpts);
      const { haircut } = haircutFace(10_000, 600_000, 1_000_000, 0);
      expect(q?.haircutIn).toBe(haircut);
      expect(q?.haircutInBps).toBeCloseTo(4_000, 6);
      expect(q?.fairIn).toBe(6_000);
    } finally {
      // @ts-expect-error restore the real fetch
      globalThis.fetch = undefined;
    }
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
