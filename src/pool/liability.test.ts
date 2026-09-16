import { describe, expect, test } from 'bun:test';
import { LIABILITY_SWAP_ENABLED_BIT } from '../abis/solidity.generated.js';
import { type PoolState, buildLeg } from '../amm/aimm.js';
// bun test: pins the pool-level LP settlement mirror (LED-A) against the contract source:
// PoolSolvencyLib.solvency/previewCap, PoolLiquidityLib.exitMu and swapLiability.
import { STABLE_PROFILE, sigmaSeed } from '../amm/profiles';
import {
  WAD,
  exitCap,
  exitValue,
  legCoverage,
  liabilitySwapEnabled,
  minLpAmountOut,
  poolSolvency,
  quoteSwapLiabilityAsync,
  quoteSwapLiabilityCore,
  quoteSwapLiabilityCoreAsync,
} from './liability';

const legOf = (symbol: string, reserves: number, liabilities: number) => ({
  symbol,
  reserves,
  liabilities,
});

// Balanced stable core: USDC hub + two $1 spokes. Small size ⇒ no clamp, negligible impact.
function balancedState(): PoolState {
  const p = STABLE_PROFILE;
  const sigma = sigmaSeed('stable');
  return {
    base: 'USDC',
    legs: {
      AUDF: buildLeg('AUDF', 1, sigma, 1_000_000, 1_000_000, 2_000_000, 6, p, 0),
      NZDF: buildLeg('NZDF', 1, sigma, 1_000_000, 1_000_000, 2_000_000, 6, p, 0),
    },
    hub: { res: 2_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0 },
  };
}

describe('LEDA-7: the ONE off-chain replica of pool-level settlement', () => {
  // A USDC hub (mark 1) and a spoke at mark 2: C = (R_hub + R_x·2) / (L_hub + L_x·2).
  const stateAt = (hubRes: number, hubLiab: number, xRes: number, xLiab: number, mark = 2) => ({
    base: 'USDC',
    legs: { X: buildLeg('X', mark, 300, xRes, xLiab, hubRes, 6, STABLE_PROFILE, 0) },
    hub: { res: hubRes, liab: hubLiab, vegaBps: 0, kappaCovBps: 0 },
  });

  test('poolSolvency is Σ R·m / Σ L·m, marks in base per token', () => {
    expect(poolSolvency(stateAt(1_000, 1_000, 500, 500))).toBe(1);
    // NAV 900 + 400·2 = 1700 over claims 1000 + 500·2 = 2000.
    expect(poolSolvency(stateAt(900, 1_000, 400, 500))).toBeCloseTo(0.85, 12);
    // Surplus nets into C for every LP: 1100 + 600·2 over 2000.
    expect(poolSolvency(stateAt(1_100, 1_000, 600, 500))).toBeCloseTo(1.15, 12);
  });

  test('an unusable mark leaves NO rate (the chain reverts FeedUnavailable); an empty book reads 1', () => {
    expect(poolSolvency(stateAt(1_000, 1_000, 500, 500, 0))).toBeNull();
    expect(poolSolvency(stateAt(1_000, 1_000, 500, 500, Number.NaN))).toBeNull();
    expect(poolSolvency(stateAt(0, 0, 0, 0))).toBe(1);
  });

  test('A-1121: a 0/0 leg is skipped before its mark is read', () => {
    expect(poolSolvency(stateAt(900, 1_000, 0, 0, 0))).toBeCloseTo(0.9, 12);
  });

  test('A-1304: zero claim over stranded value is no rate', () => {
    expect(poolSolvency(stateAt(1_000, 0, 500, 0))).toBeNull();
  });

  test('exitValue = face · min(c_leg, cap) for C < 1, C == 1 and C > 1', () => {
    // C < 1 binds a leg that is covered on its own books.
    expect(exitValue(1_000, legCoverage(1_200, 1_000), 0.9)).toBeCloseTo(900, 9);
    // C == 1 on a covered leg pays face.
    expect(exitValue(1_000, legCoverage(1_000, 1_000), 1)).toBe(1_000);
    // C > 1: in-kind delivery is still bounded by the leg's own coverage…
    expect(exitValue(1_000, legCoverage(800, 1_000), 1.1)).toBeCloseTo(800, 9);
    // …and a leg holding more than face·C pays face·C, the claim.
    expect(exitValue(1_000, legCoverage(2_000, 1_000), 1.1)).toBeCloseTo(1_100, 9);
    // No liabilities: `exitMu` returns the cap.
    expect(exitValue(1_000, legCoverage(5, 0), 0.95)).toBeCloseTo(950, 9);
  });

  test('the degraded cap is min(1, lastGoodC), never a bare 1 over a known shortfall', () => {
    expect(exitCap(1.07)).toBe(1.07);
    expect(exitCap(null, 970_000_000_000_000_000n)).toBeCloseTo(0.97, 12);
    expect(exitCap(null, 1_050_000_000_000_000_000n)).toBe(1);
    expect(exitCap(null, 0n)).toBe(1);
    expect(exitCap(null)).toBe(1);
  });
});

describe('liabilitySwapEnabled (flag bit gate)', () => {
  test('bit 5 of asset flags (PoolConstantsLib)', () => {
    expect(LIABILITY_SWAP_ENABLED_BIT).toBe(1 << 5);
    expect(liabilitySwapEnabled(1 << 5)).toBe(true);
    expect(liabilitySwapEnabled(0b111111)).toBe(true);
    expect(liabilitySwapEnabled(0b011111)).toBe(false);
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
        route: ['AUDF', 'USDC', 'NZDF'],
      };
    };
    return convert;
  }

  test('balanced legs at mark: no haircuts, conversion passes through unclamped', async () => {
    const q = await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, 1, makeConvert(9_990));
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
  });

  test('Lemma B clamp: conv quoted past the oracle mark is capped at fairIn·markPrice (:442)', async () => {
    // 2% skew premium quoted over a 1.0 mark ⇒ cap binds at 1% over face... here mark 1.0, fair 10k.
    const q = await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, 1, makeConvert(10_400, 1));
    expect(q?.markCapBinding).toBe(true);
    expect(q?.conv).toBe(10_000); // fairIn · markPrice
    expect(q?.liabOut).toBe(10_000);
    expect(q?.markClampBps).toBeCloseTo(((10_400 - 10_000) / 10_400) * 1e4, 6);
  });

  test('the burn settles at pool C BEFORE conversion, never at c_leg', async () => {
    // A 20% under-covered in-leg in a pool at C = 0.95 settles at 0.95: the leg's own deficit is
    // inventory location, not loss.
    const shortIn = { ...inLeg, reserves: 800_000 };
    let sawFairIn = 0;
    const q = await quoteSwapLiabilityCoreAsync(shortIn, outLeg, 10_000, 0.95, async (fairIn) => {
      sawFairIn = fairIn;
      return makeConvert(9_490)(fairIn);
    });
    expect(q?.fairIn).toBeCloseTo(9_500, 9);
    expect(sawFairIn).toBeCloseTo(9_500, 9);
    expect(q?.haircutIn).toBeCloseTo(500, 9);
    expect(q?.poolC).toBe(0.95);
    // A-1000: the out leg is a FACE book, so the token conversion is re-denominated: conv / C.
    expect(q?.liabOut).toBeCloseTo(9_490 / 0.95, 6);
  });

  test('at C > 1 there is no haircut and the burn converts its surplus-backed claim', async () => {
    const q = await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, 1.02, makeConvert(10_190));
    expect(q?.fairIn).toBeCloseTo(10_200, 9);
    expect(q?.haircutIn).toBe(0);
    expect(q?.liabOut).toBeCloseTo(10_190 / 1.02, 6);
  });

  test('NO output-leg haircut: an under-covered destination is credited at C, not token-face', async () => {
    const shortOut = { ...outLeg, reserves: 750_000 };
    const q = await quoteSwapLiabilityCoreAsync(inLeg, shortOut, 10_000, 1, makeConvert(9_990));
    expect(q?.liabOut).toBe(9_990);
  });

  test('zero-output guard and a missing rate both resolve null', async () => {
    expect(await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, 1, makeConvert(0))).toBeNull();
    expect(
      await quoteSwapLiabilityCoreAsync(inLeg, outLeg, 10_000, Number.NaN, makeConvert(9_990)),
    ).toBeNull();
  });

  test('burn past live liabilities reverts to null (:429)', async () => {
    expect(
      await quoteSwapLiabilityCoreAsync(inLeg, outLeg, inLeg.liabilities + 1, 1, makeConvert(1)),
    ).toBeNull();
    expect(
      await quoteSwapLiabilityCoreAsync({ ...inLeg, liabilities: 0 }, outLeg, 1, 1, makeConvert(1)),
    ).toBeNull();
  });

  test('share indices convert shares ↔ face on both legs', async () => {
    const idx = WAD * 1.05;
    const q = await quoteSwapLiabilityCoreAsync(
      { ...inLeg, indexWad: idx },
      { ...outLeg, indexWad: idx },
      10_000, // shares
      1,
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

  test('balanced pool: spoke cross settles ONCE over POST /v1/quote-path, never clamps', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string, init: { body?: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body ?? '{}') });
      return { ok: true, json: async () => quoteWire(5_000_000_000n) };
    };
    try {
      const state = balancedState();
      const inLeg = legOf('AUDF', 1_000_000, 1_000_000);
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

      // A cross is ONE settlement, not two leg quotes summed: exactly one POST, to /quote-path,
      // carrying both hops. The spread comes back whole rather than re-charged per hop.
      expect(calls).toHaveLength(1);
      expect(calls[0].url.endsWith('/quote-path')).toBe(true);
      const legs = calls[0].body.legs as Record<string, unknown>[];
      expect(legs).toHaveLength(2);
      expect(legs[0].selling).toBe(true);
      expect(legs[1].selling).toBe(false);
      expect(legs[0].decimals_out).toBe(backendOpts.baseDecimals);
      expect(legs[1].decimals_in).toBe(backendOpts.baseDecimals);
      // The hub is interior to the path on both hops.
      for (const l of legs) expect((l.counterparty as { reserves: string }).reserves).toBe('0x0');
      // Half of ONE 40 pbps path spread. Two summed leg quotes would have landed at 0.4.
      expect(q?.convSpreadBps).toBeCloseTo(40 / 100 / 2, 9);
    } finally {
      // @ts-expect-error restore the real fetch
      globalThis.fetch = undefined;
    }
  });

  test('an under-covered in-leg in a whole pool settles at C = 1, not at its own 60%', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => quoteWire(9_990_000_000n) });
    try {
      const state = balancedState(); // C = 1 across the pool
      const inLeg = legOf('AUDF', 600_000, 1_000_000); // the leg alone is 40% short
      const outLeg = legOf('NZDF', 1_000_000, 1_000_000);
      const q = await quoteSwapLiabilityAsync(state, inLeg, outLeg, 10_000, backendOpts);
      expect(q?.poolC).toBe(1);
      expect(q?.haircutIn).toBe(0);
      expect(q?.fairIn).toBe(10_000);
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
