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
      baseMark: 0.5,
      baseRefBandBps: 8 << 12,
    });
    return s;
  };

  test('pools and spokes carry ref_band_bps + base_mark + base_ref_band_bps', () => {
    const w = poolStateToWire('p', undefined, banded(), meta, 6);
    expect(w.spokes[0].ref_band_bps).toBe((4 << 12) | 50);
    expect(w.base_mark).toBe('0x6f05b59d3b20000');
    expect(w.base_ref_band_bps).toBe(8 << 12);
  });

  test('legs carry the same three fields', () => {
    const b = legToQuoteBody(banded().legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b.ref_band_bps).toBe((4 << 12) | 50);
    expect(b.base_mark).toBe('0x6f05b59d3b20000');
    expect(b.base_ref_band_bps).toBe(8 << 12);
  });

  test('unknown base mark goes out null (no base check), bands default 0', () => {
    const b = legToQuoteBody(state(HUB).legs.USDT, 1_000, true, 18, INTERIOR_ENDPOINT);
    expect(b).toMatchObject({ ref_band_bps: 0, base_mark: null, base_ref_band_bps: 0 });
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

  test('unknown confidence goes out null, never a fail-open zero', () => {
    const b = legToQuoteBody(leg, 1_000, true, 18, hubEndpointWire(HUB, 6));
    expect(b.confidence_bps).toBeNull();
  });
});

describe('quoteFromWire', () => {
  const wire = (saturated?: boolean): QuoteResponseWire =>
    ({
      amount_out: '0x3e8',
      gross_out: '0x3e8',
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
  test('carries the saturation flag, so a flat top is never shown as a price', () => {
    expect(quoteFromWire(wire(true), 18, 18, [], 1).saturated).toBe(true);
    expect(quoteFromWire(wire(false), 18, 18, [], 1).saturated).toBe(false);
  });

  test('a backend that predates the flag reads unsaturated, never undefined', () => {
    expect(quoteFromWire(wire(undefined), 18, 18, [], 1).saturated).toBe(false);
  });
});
