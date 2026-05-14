/**
 * Tick-level synth composition tests (Wave-3a).
 *
 * Asserts:
 *   - 2-leg multiplicative composition correct (BTCUSDT = BTCUSDC × USDCUSDT)
 *   - 1-leg inversion correct (USDCBTC = 1 / BTCUSDC) w/ bid↔ask swap
 *   - 2-leg ratio correct (ETHBTC = ETHUSDC / BTCUSDC)
 *   - bid ≤ mid ≤ ask preserved after composition
 *   - conf composes via min; any leg conf=0 ⇒ synth conf=0
 *   - degenerate inputs (missing leg, non-positive quote) → null
 *   - identity (0-leg, e.g. EUREUR) → 1.0
 */

import { expect, test, describe } from 'bun:test';
import { computeSynthTick, type LegTick } from '../src/types/synth-ohlc';
import type { Leg } from '../src/types/paths';

const tick = (bid: number, ask: number, conf = 10000): LegTick => ({
  bid, ask, mid: (bid + ask) / 2, conf,
});

describe('computeSynthTick', () => {
  test('2-leg product: BTCUSDT = BTCUSDC × USDCUSDT', () => {
    const legs: Leg[] = [['BTCUSDC', 1], ['USDCUSDT', 1]];
    const out = computeSynthTick(legs, {
      BTCUSDC:  tick(99_500, 100_500),
      USDCUSDT: tick(0.9999, 1.0001),
    });
    expect(out).not.toBeNull();
    // mid = 100_000 × 1.0 = 100_000
    expect(out!.mid).toBeCloseTo(100_000, 1);
    // bid = 99_500 × 0.9999, ask = 100_500 × 1.0001
    expect(out!.bid).toBeCloseTo(99_500 * 0.9999, 3);
    expect(out!.ask).toBeCloseTo(100_500 * 1.0001, 3);
    expect(out!.bid).toBeLessThanOrEqual(out!.mid);
    expect(out!.mid).toBeLessThanOrEqual(out!.ask);
    expect(out!.conf).toBe(10000);
  });

  test('1-leg inversion: USDCBTC = 1 / BTCUSDC (bid↔ask swap)', () => {
    const legs: Leg[] = [['BTCUSDC', -1]];
    const out = computeSynthTick(legs, {
      BTCUSDC: tick(99_500, 100_500),
    });
    expect(out).not.toBeNull();
    // inv.bid = 1/ask, inv.ask = 1/bid → bid < ask preserved
    expect(out!.bid).toBeCloseTo(1 / 100_500, 12);
    expect(out!.ask).toBeCloseTo(1 / 99_500, 12);
    expect(out!.mid).toBeCloseTo(1 / 100_000, 12);
    expect(out!.bid).toBeLessThan(out!.ask);
  });

  test('2-leg ratio: ETHBTC = ETHUSDC / BTCUSDC', () => {
    const legs: Leg[] = [['ETHUSDC', 1], ['BTCUSDC', -1]];
    const out = computeSynthTick(legs, {
      ETHUSDC: tick(2_790, 2_810),    // mid 2800
      BTCUSDC: tick(99_500, 100_500), // mid 100_000
    });
    expect(out).not.toBeNull();
    // mid ≈ 2800 / 100_000 = 0.028
    expect(out!.mid).toBeCloseTo(0.028, 5);
    // bid = ethBid/btcAsk, ask = ethAsk/btcBid
    expect(out!.bid).toBeCloseTo(2_790 / 100_500, 8);
    expect(out!.ask).toBeCloseTo(2_810 / 99_500, 8);
    expect(out!.bid).toBeLessThanOrEqual(out!.mid);
    expect(out!.mid).toBeLessThanOrEqual(out!.ask);
  });

  test('conf composes via min; any leg conf=0 ⇒ synth conf=0', () => {
    const legs: Leg[] = [['BTCUSDC', 1], ['USDCUSDT', 1]];
    // Stale BTCUSDC leg.
    const stale = computeSynthTick(legs, {
      BTCUSDC:  tick(99_500, 100_500, 0),
      USDCUSDT: tick(0.9999, 1.0001, 10000),
    });
    expect(stale!.conf).toBe(0);
    // Both fresh → 10000.
    const fresh = computeSynthTick(legs, {
      BTCUSDC:  tick(99_500, 100_500, 10000),
      USDCUSDT: tick(0.9999, 1.0001, 10000),
    });
    expect(fresh!.conf).toBe(10000);
    // Min applies on intermediate values too.
    const mid = computeSynthTick(legs, {
      BTCUSDC:  tick(99_500, 100_500, 5000),
      USDCUSDT: tick(0.9999, 1.0001, 8000),
    });
    expect(mid!.conf).toBe(5000);
  });

  test('missing leg → null', () => {
    const legs: Leg[] = [['BTCUSDC', 1], ['USDCUSDT', 1]];
    expect(computeSynthTick(legs, { BTCUSDC: tick(99_500, 100_500) })).toBeNull();
  });

  test('non-positive leg quote → null', () => {
    const legs: Leg[] = [['BTCUSDC', 1]];
    expect(computeSynthTick(legs, { BTCUSDC: { bid: 0, ask: 100_500, mid: 50_250, conf: 10000 } })).toBeNull();
  });

  test('identity (0-leg) → 1.0 w/ full conf', () => {
    const out = computeSynthTick([], {});
    expect(out).not.toBeNull();
    expect(out!.mid).toBe(1);
    expect(out!.bid).toBe(1);
    expect(out!.ask).toBe(1);
    expect(out!.conf).toBe(10000);
  });

  test('bid ≤ mid ≤ ask preserved across random 2-leg compositions', () => {
    const legs: Leg[] = [['ETHUSDC', 1], ['BTCUSDC', -1]];
    for (let s = 1; s <= 50; s++) {
      const eth = 1000 + s * 50;
      const btc = 50_000 + s * 1000;
      const out = computeSynthTick(legs, {
        ETHUSDC: tick(eth * 0.999, eth * 1.001),
        BTCUSDC: tick(btc * 0.999, btc * 1.001),
      });
      expect(out!.bid).toBeLessThanOrEqual(out!.mid + 1e-12);
      expect(out!.mid).toBeLessThanOrEqual(out!.ask + 1e-12);
    }
  });
});
