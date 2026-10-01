import { describe, expect, test } from 'bun:test';
import {
  INTERIOR_ENDPOINT,
  type PoolState,
  type QuoteResponseWire,
  buildLeg,
  hubEndpointWire,
  legToQuoteBody,
  poolStateToWire,
  quoteFromWire,
} from './aimm';
import { STABLE_PROFILE } from './profiles';

// The wire is LEG-shaped; the chain settles PATHS. Everything here pins the two path quantities
// a leg cannot carry - the delivering endpoint's coverage wall (`_settleQuote` charges
// `_covToll(cOut, …)`) and the endpoint-max vega (`acc.vegaBps = max(cIn, cOut)`) - because the
// first cut of this codec dropped both and every spoke->base sell was quoted toll-free.

const HUB = { res: 200_000, liab: 250_000, vegaBps: 10_000, kappaCovBps: 600 };
const meta = { addressOf: (s: string): string => `0x${s}`, decimalsOf: (): number => 18 };

const state = (hub?: PoolState['hub']): PoolState => ({
  base: 'USDC',
  legs: {
    USDT: buildLeg(
      'USDT',
      1,
      300,
      1_000_000,
      1_000_000,
      200_000,
      18,
      {
        ...STABLE_PROFILE,
        vega: 3_000,
      },
      0,
    ),
  },
  hub,
});

describe('hubEndpointWire', () => {
  test('scales the hub book into the hub token raw and keeps its risk dials', () => {
    expect(hubEndpointWire(HUB, 6)).toEqual({
      reserves: '0x2e90edd000',
      liabilities: '0x3a35294400',
      vega_bps: 10_000,
      kappa_cov_bps: 600,
    });
  });
});

describe('hubEndpointWire decimals', () => {
  // A flat /quote has no decimal boundary: the hub book rides in the SPOKE's scale, so the same
  // human book is 1e12x larger for an 18-decimal spoke than for a 6-decimal one.
  test('the same human book scales to whichever decimals the surface reads', () => {
    const e6 = hubEndpointWire(HUB, 6);
    const e18 = hubEndpointWire(HUB, 18);
    // f64 products: exact at 6, within an ulp at 18
    expect(Number(BigInt(e18.reserves)) / Number(BigInt(e6.reserves))).toBeCloseTo(1e12, -3);
    expect(Number(BigInt(e18.liabilities)) / Number(BigInt(e6.liabilities))).toBeCloseTo(1e12, -3);
    expect(e18.vega_bps).toBe(e6.vega_bps);
    expect(e18.kappa_cov_bps).toBe(e6.kappa_cov_bps);
  });
});

describe('poolStateToWire', () => {
  test('publishes the WHOLE hub endpoint, not just its balance', () => {
    const w = poolStateToWire('p', undefined, state(HUB), meta, 6);
    expect(w.base_reserves).toBe('0x2e90edd000');
    expect(w.base_liabilities).toBe('0x3a35294400');
    expect(w.base_vega_bps).toBe(10_000);
    expect(w.base_kappa_cov_bps).toBe(600);
  });

  test('no hub book leaves every endpoint field null, so the backend drops the leg', () => {
    const w = poolStateToWire('p', undefined, state(undefined), meta, 6);
    expect(w.base_liabilities).toBeNull();
    expect(w.base_vega_bps).toBeNull();
    expect(w.base_kappa_cov_bps).toBeNull();
    // The per-leg balance copy still fills reserves: it is a capacity number, not an endpoint.
    expect(w.base_reserves).toBe('0x2e90edd000');
  });

  test('unknown confidence goes out null, never a fail-open zero', () => {
    const w = poolStateToWire('p', undefined, state(HUB), meta, 6);
    expect(w.spokes[0].confidence_bps).toBeNull();
  });
});

describe('depeg wire', () => {
  const banded = (): PoolState => {
    const s = state(HUB);
    Object.assign(s.legs.USDT, {
      refBandBps: (4 << 12) | 50,
      internal: true,
      baseMark: 0.5,
      baseRefBandBps: 8 << 12,
    });
    return s;
  };

  test('pools and spokes carry ref_band_bps + base_mark + base_ref_band_bps', () => {
    const w = poolStateToWire('p', undefined, banded(), meta, 6);
    expect(w.spokes[0].ref_band_bps).toBe((4 << 12) | 50);
    expect(w.spokes[0].internal).toBe(true);
    expect(w.base_mark).toBe('0x6f05b59d3b20000');
    expect(w.base_ref_band_bps).toBe(8 << 12);
  });

  test('legs carry the same three fields', () => {
    const b = legToQuoteBody(banded().legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b.ref_band_bps).toBe((4 << 12) | 50);
    expect(b.internal).toBe(true);
    expect(b.base_mark).toBe('0x6f05b59d3b20000');
    expect(b.base_ref_band_bps).toBe(8 << 12);
  });

  test('unknown base mark goes out null (no base check), bands default 0', () => {
    const b = legToQuoteBody(state(HUB).legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b).toMatchObject({
      ref_band_bps: 0,
      internal: false,
      peg_mark: null,
      base_mark: null,
      base_ref_band_bps: 0,
    });
  });

  test('a UOA leg sends its USD mark (twap·baseMark) as peg_mark', () => {
    const s = banded();
    Object.assign(s.legs.USDT, { uoa: true, twap: 2 });
    const b = legToQuoteBody(s.legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b.peg_mark).toBe('0xde0b6b3a7640000'); // 2 · 0.5 = 1.0 USD
    expect(poolStateToWire('p', undefined, s, meta, 6).spokes[0].peg_mark).toBe(b.peg_mark);
    Object.assign(s.legs.USDT, { baseMark: undefined });
    expect(legToQuoteBody(s.legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT).peg_mark).toBeNull();
  });
});

describe('legToQuoteBody', () => {
  const leg = state(HUB).legs.USDT;

  test('a sell carries the hub as the delivering endpoint', () => {
    const b = legToQuoteBody(leg, 1_000, true, 18, hubEndpointWire(HUB, 6));
    expect(b.selling).toBe(true);
    expect(b.counterparty).toEqual({
      reserves: '0x2e90edd000',
      liabilities: '0x3a35294400',
      vega_bps: 10_000,
      kappa_cov_bps: 600,
    });
  });

  test('an interior hop carries a blank endpoint: never `cOut`, never tolled', () => {
    const b = legToQuoteBody(leg, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b.counterparty).toEqual({
      reserves: '0x0',
      liabilities: '0x0',
      vega_bps: 0,
      kappa_cov_bps: 0,
    });
  });

  // The server prices a flat buy in the SPOKE scale, so the base amount is re-denominated to
  // `leg.decimals` whatever scale the caller held it in (`decimalsIn` is a sell-only input).
  test('a buy scales amount_in to the spoke decimals (6 base -> 18 spoke)', () => {
    const b = legToQuoteBody(leg, 1_000, false, 6, INTERIOR_ENDPOINT);
    expect(BigInt(b.amount_in)).toBe(1_000n * 10n ** 18n);
    expect(b.selling).toBe(false);
  });

  test('a buy scales amount_in to the spoke decimals (18 base -> 6 spoke)', () => {
    const l6 = buildLeg('USDC6', 1, 300, 1_000_000, 1_000_000, 200_000, 6, STABLE_PROFILE, 0);
    const b = legToQuoteBody(l6, 2.5, false, 18, INTERIOR_ENDPOINT);
    expect(BigInt(b.amount_in)).toBe(2_500_000n);
  });

  test('same decimals: a buy is unchanged', () => {
    const b = legToQuoteBody(leg, 1_000, false, 18, INTERIOR_ENDPOINT);
    expect(BigInt(b.amount_in)).toBe(1_000n * 10n ** 18n);
  });

  test('a sell still scales by decimalsIn', () => {
    const b = legToQuoteBody(leg, 1_000, true, 6, INTERIOR_ENDPOINT);
    expect(BigInt(b.amount_in)).toBe(1_000n * 10n ** 6n);
  });

  test('unknown confidence goes out null, never a fail-open zero', () => {
    const b = legToQuoteBody(leg, 1_000, true, 18, hubEndpointWire(HUB, 6));
    expect(b.confidence_bps).toBeNull();
  });
});

describe('quoteFromWire', () => {
  const wire = (saturated?: boolean): QuoteResponseWire =>
    ({
      amount_out: '0xde0b6b3a7640000',
      gross_out: '0xde0b6b3a7640000',
      avg_price: '0xde0b6b3a7640000',
      mid_price: '0xde0b6b3a7640000',
      mark_price: '0xde0b6b3a7640000',
      spread_pbps: 0,
      cov_toll: '0x0',
      proto_fee: '0x0',
      lp_fee: '0x0',
      saturated,
    }) as QuoteResponseWire;

  // A-188: a clamped size is the flat top of the coverage wall, and a UI can only refuse it if the
  // flag survives the wire.
  // A saturated huge sell fills far below mid by design: the scale guard must not refuse it.
  test('a saturated quote passes the fill/mid guard; the same fill unflagged is refused', () => {
    const w = (saturated: boolean): QuoteResponseWire => ({
      ...wire(saturated),
      amount_out: '0x38d7ea4c68000', // 0.001 of 1 in
      gross_out: '0x38d7ea4c68000',
    });
    expect(quoteFromWire(w(true), 18, [], 1)?.saturated).toBe(true);
    expect(quoteFromWire(w(false), 18, [], 1)).toBeNull();
  });

  test('carries the saturation flag, so a flat top is never shown as a price', () => {
    expect(quoteFromWire(wire(true), 18, [], 1)?.saturated).toBe(true);
    expect(quoteFromWire(wire(false), 18, [], 1)?.saturated).toBe(false);
  });

  test('a backend that predates the flag reads unsaturated, never undefined', () => {
    expect(quoteFromWire(wire(undefined), 18, [], 1)?.saturated).toBe(false);
  });

  // USDC (6) -> WMON (18): mid/mark are human-per-human, only amounts carry the 1e12 decimals gap.
  test('mixed 6 <-> 18 decimals read mid/mark as human, impact stays sane', () => {
    const wad = (x: number): string => `0x${BigInt(Math.round(x * 1e18)).toString(16)}`;
    const mid = 31.15; // WMON per USDC (~0.0321 USDC per WMON)
    const out = BigInt(Math.round(0.001 * mid * 1e6)) * 10n ** 12n; // 0.001 USDC in -> WMON raw
    const w = {
      amount_out: `0x${out.toString(16)}`,
      gross_out: `0x${out.toString(16)}`,
      avg_price: '0x0',
      mid_price: wad(mid),
      mark_price: wad(mid),
      spread_pbps: 0,
      cov_toll: '0x0',
      proto_fee: '0x0',
      lp_fee: '0x0',
    } as QuoteResponseWire;
    const q = quoteFromWire(w, 18, ['USDC', 'WMON'], 0.001)!;
    expect(1 / q.midPrice).toBeCloseTo(0.0321, 4);
    expect(q.markPrice).toBeCloseTo(mid, 9);
    expect(q.avgPrice).toBeCloseTo(mid, 6);
    expect(q.priceImpactBps).toBeLessThan(1);
  });
  // btr-quote f8a9c2a: a flat BUY answers mid/mark out-per-in human (same side as avg/gross_avg),
  // no longer the anchor-per-spoke reciprocal. 1000 USDC (6) in -> WMON (18) out at 31.15.
  describe('flat buy, server orientation (out-per-in)', () => {
    const wad = (x: number): string => `0x${BigInt(Math.round(x * 1e18)).toString(16)}`;
    const hex = (n: bigint): string => `0x${n.toString(16)}`;
    const mid = 31.15;
    const buy = (midW: string): QuoteResponseWire => {
      const gross = BigInt(Math.round(1_000 * mid * 0.999 * 1e6)) * 10n ** 12n;
      const out = (gross * 9_990n) / 10_000n;
      return {
        amount_out: hex(out),
        gross_out: hex(gross),
        avg_price: '0x0',
        mid_price: midW,
        mark_price: wad(mid),
        spread_pbps: 0,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: '0x0',
      } as QuoteResponseWire;
    };

    test('18 spoke vs 6 base: impact and premium stay sane', () => {
      const q = quoteFromWire(buy(wad(mid)), 18, ['USDC', 'WMON'], 1_000)!;
      expect(q.midPrice).toBeCloseTo(mid, 9);
      expect(q.avgPrice).toBeCloseTo(mid * 0.999 * 0.999, 4);
      expect(q.priceImpactBps).toBeCloseTo(10, 0);
      expect(Math.abs(q.midPremiumBps)).toBeLessThan(1);
    });

    test('the old base-per-spoke orientation is refused, not read as ~1e7 bps impact', () => {
      expect(quoteFromWire(buy(wad(1 / mid)), 18, ['USDC', 'WMON'], 1_000)).toBeNull();
    });

    test('same decimals: mid is the plain out-per-in, impact tracks the fill', () => {
      const w = {
        amount_out: hex(10n ** 21n),
        gross_out: hex(10n ** 21n),
        avg_price: '0x0',
        mid_price: wad(1),
        mark_price: wad(1),
        spread_pbps: 0,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: '0x0',
      } as QuoteResponseWire;
      const q = quoteFromWire(w, 18, ['USDC', 'USDT'], 1_000)!;
      expect(q.midPrice).toBe(1);
      expect(q.priceImpactBps).toBe(0);
    });
  });
});

// A flat /quote has no decimal boundary (btr-quote lib.rs `quote_exact_in`): amount_in, amount_out
// and gross_out are all raw in the SPOKE's decimals, whichever side is the base. Human amounts are
// equal across the boundary, so a caller decodes at the spoke's decimals and reads base-human.
describe('quoteFromWire: flat quote in SPOKE scale (mixed decimals)', () => {
  const wad = (x: number): string => `0x${BigInt(Math.round(x * 1e18)).toString(16)}`;
  const raw = (human: number, dec: number): string =>
    `0x${(BigInt(Math.round(human * 1e6)) * 10n ** BigInt(dec - 6)).toString(16)}`;
  const resp = (gross: number, net: number, dec: number, mid: number): QuoteResponseWire =>
    ({
      amount_out: raw(net, dec),
      gross_out: raw(gross, dec),
      avg_price: '0x0',
      mid_price: wad(mid),
      mark_price: wad(mid),
      spread_pbps: 0,
      cov_toll: '0x0',
      proto_fee: '0x0',
      lp_fee: '0x0',
    }) as QuoteResponseWire;

  // Sell 1000 of an 18-decimal spoke into a 6-decimal base at mid 1: out is 999 raw at 18, NOT
  // 999e6. Decoding it at the base's 6 would read 9.99e14.
  test('SELL 18-spoke / 6-base: decodes at spoke decimals', () => {
    const q = quoteFromWire(resp(999.5, 999, 18, 1), 18, ['SPK', 'BASE'], 1_000)!;
    expect(q.amountOut).toBeCloseTo(999, 9);
    expect(q.grossOut).toBeCloseTo(999.5, 9);
    expect(q.avgPrice).toBeCloseTo(0.999, 9);
    expect(q.priceImpactBps).toBeCloseTo(5, 6);
    // the base-decimals decode is the 1e12x overshoot the reviewer caught
    expect(quoteFromWire(resp(999.5, 999, 18, 1), 6, ['SPK', 'BASE'], 1_000)).toBeNull();
  });

  test('SELL 6-spoke / 18-base: decodes at spoke decimals', () => {
    const q = quoteFromWire(resp(999.5, 999, 6, 1), 6, ['SPK', 'BASE'], 1_000)!;
    expect(q.amountOut).toBeCloseTo(999, 9);
    expect(q.avgPrice).toBeCloseTo(0.999, 9);
    expect(q.priceImpactBps).toBeCloseTo(5, 6);
    // decoding at the base's 18 reads 1e-9: also refused
    expect(quoteFromWire(resp(999.5, 999, 6, 1), 18, ['SPK', 'BASE'], 1_000)).toBeNull();
  });

  // Buy a 6-decimal spoke with 1000 of an 18-decimal base at out-per-in 2: out is raw at 6.
  test('BUY 6-spoke / 18-base: out in spoke scale', () => {
    const q = quoteFromWire(resp(1_998, 1_996, 6, 2), 6, ['BASE', 'SPK'], 1_000)!;
    expect(q.amountOut).toBeCloseTo(1_996, 9);
    expect(q.avgPrice).toBeCloseTo(1.996, 9);
    expect(q.priceImpactBps).toBeCloseTo(10, 6);
  });

  // Buy an 18-decimal spoke with 1000 of a 6-decimal base at out-per-in 31.15.
  test('BUY 18-spoke / 6-base: out in spoke scale', () => {
    const mid = 31.15;
    const q = quoteFromWire(
      resp(1_000 * mid * 0.999, 1_000 * mid * 0.998, 18, mid),
      18,
      ['BASE', 'SPK'],
      1_000,
    )!;
    expect(q.amountOut).toBeCloseTo(1_000 * mid * 0.998, 6);
    expect(q.priceImpactBps).toBeCloseTo(10, 4);
    expect(q.avgPrice).toBeCloseTo(mid * 0.998, 9);
  });

  test('refuses a fill off the mid by more than 100x either way', () => {
    expect(quoteFromWire(resp(1_000, 1_000, 18, 1_000), 18, [], 1_000)).toBeNull();
    expect(quoteFromWire(resp(1_000, 1_000, 18, 0.001), 18, [], 1_000)).toBeNull();
    expect(quoteFromWire(resp(1_000, 1_000, 18, 1.5), 18, [], 1_000)).not.toBeNull();
  });
});
