/**
 * MITCH ticker ids, and the feed identity the oracle migration keys on.
 *
 * The whole point of the scheme is that the id is CONTENT-derived, so a wrong bit field is not a
 * cosmetic decode bug: it names another instrument's feed and relays another asset's mark. The
 * pinned vector below is Arc's `WETH-USDC` entry, taken from the deployment record itself.
 */

import { describe, expect, test } from 'bun:test';
import {
  MITCH_INSTRUMENT,
  decodeMitchTicker,
  encodeMitchTicker,
  isMitchFeedId,
  mitchFeedId,
  mitchInstrumentName,
  mitchTickerOfFeedId,
} from '../src/oracle/mitch';
import { DEPLOYED_VENUES } from '../src/venues/deployments.generated';

const ARC = 5042002;
/** Arc `WETH-USDC`. Kept as a literal: re-reading it from the table would assert nothing. */
const WETH_USDC = 438724262896861184n;

describe('MITCH ticker codec', () => {
  test('the pinned vector decodes field by field', () => {
    expect(WETH_USDC.toString(16)).toBe('616a96484500000');
    expect(decodeMitchTicker(WETH_USDC)).toEqual({
      instrumentType: MITCH_INSTRUMENT.Spot,
      baseClass: 6,
      baseId: 5801,
      quoteClass: 6,
      quoteId: 18501,
      subType: 0,
    });
  });

  test('accepts the decimal STRING the venue table stores', () => {
    expect(decodeMitchTicker('438724262896861184')).toEqual(decodeMitchTicker(WETH_USDC));
    // Why a string and not a number: today's spot ids are all multiples of 2^20 and so happen to
    // survive a double, but the low 20 bits are a real field. The moment a sub-type is non-zero
    // the id is past 2^53 with significant low bits and a JSON number rounds it into a DIFFERENT,
    // valid-looking instrument.
    const subtyped = encodeMitchTicker({ ...decodeMitchTicker(WETH_USDC), subType: 1 });
    expect(BigInt(Number(subtyped.toString()))).not.toBe(subtyped);
    expect(decodeMitchTicker(subtyped.toString()).subType).toBe(1);
  });

  test('encode round-trips every entry in the record', () => {
    for (const v of Object.values(DEPLOYED_VENUES)) {
      for (const [name, id] of Object.entries(v.tickerIds ?? {})) {
        expect(encodeMitchTicker(decodeMitchTicker(id)), name).toBe(BigInt(id));
      }
    }
  });

  test('a field that does not fit throws rather than silently wrapping', () => {
    const t = decodeMitchTicker(WETH_USDC);
    expect(() => encodeMitchTicker({ ...t, baseId: 0x10000 })).toThrow();
  });

  test('instrument names', () => {
    expect(mitchInstrumentName(MITCH_INSTRUMENT.Spot)).toBe('Spot');
    expect(mitchInstrumentName(MITCH_INSTRUMENT.Perpetual)).toBe('Perpetual');
    expect(mitchInstrumentName(MITCH_INSTRUMENT.Fund)).toBe('Fund');
    expect(mitchInstrumentName(0xa)).toContain('Unknown');
  });
});

describe('MITCH feed identity', () => {
  test('the ticker sits in the low 8 bytes of the bytes32', () => {
    expect(mitchFeedId(WETH_USDC)).toBe(
      '0x0000000000000000000000000000000000000000000000000616a96484500000',
    );
    expect(mitchTickerOfFeedId(mitchFeedId(WETH_USDC))).toBe(WETH_USDC);
  });

  test('a real keccak feedId is NOT read as a MITCH id', () => {
    // Both schemes are live during the overlap, so this discrimination is load-bearing.
    const keccak = Object.values(DEPLOYED_VENUES[ARC]!.feedIds)[0]!;
    expect(keccak).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(isMitchFeedId(keccak)).toBe(false);
    expect(mitchTickerOfFeedId(keccak)).toBeNull();
  });

  test('an unset id is neither scheme', () => {
    expect(isMitchFeedId(`0x${'0'.repeat(64)}`)).toBe(false);
  });
});

describe(`chain ${ARC} tickerIds`, () => {
  const tickers = DEPLOYED_VENUES[ARC]!.tickerIds;

  test('the record carries them at all', () => {
    expect(Object.keys(tickers).length).toBeGreaterThan(0);
  });

  test('every entry is a spot instrument quoted in the base, and unique', () => {
    const seen = new Map<string, string>();
    for (const [name, id] of Object.entries(tickers)) {
      const t = decodeMitchTicker(id);
      expect({ name, type: t.instrumentType, sub: t.subType }).toEqual({
        name,
        type: MITCH_INSTRUMENT.Spot,
        sub: 0,
      });
      // Every leg is quoted in USDC (class 6, id 18501) except the base's own USD reference,
      // which is quoted in fiat USD (class 3, id 5001). A leg quoted in anything else would be
      // priced against a numeraire the pool does not hold.
      const quote = name === 'USDC-USD' ? { c: 3, i: 5001 } : { c: 6, i: 18501 };
      expect({ name, c: t.quoteClass, i: t.quoteId }).toEqual({ name, ...quote });

      const prior = seen.get(id);
      expect(prior === undefined || prior === name, `${name} aliases ${prior}`).toBe(true);
      seen.set(id, name);
    }
  });
});
