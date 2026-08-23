import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NXR_MARKS, closedUntil, nxrMark, nxrPair } from '../src/venues/nxr';
import { SEPOLIA_ORACLE_FEEDS } from '../src/venues/sepolia';

/**
 * `NXR_MARKS` is the only statement of where an asset's mark comes from, and the deploy ceremony
 * seeds every feed from it. A wrong row is not a crash: it is a plausible number seeded under the
 * wrong asset's name, which the on-chain deviation band then locks in.
 *
 * The dangerous failures are all silent, so each has its own test below: a symbol NXR does not
 * serve, a pair resolved by shape rather than declaration, an inverted FX row, and a wrapper marked
 * against its own thin ticker instead of the currency it tracks.
 */
const DEX = resolve(import.meta.dir, '../../dex/evm/deployments');
const roster = (chain: string): string[] => {
  const p = resolve(DEX, `${chain}-risk-params.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')).symbols as string[]) : [];
};

describe('NXR mark sources', () => {
  test.each(['sepolia', 'arc'])('every %s roster symbol has a declared mark source', (chain) => {
    const syms = roster(chain);
    if (!syms.length) return; // sdk-only checkout: dex is a sibling repo
    const missing = syms.filter((s) => !nxrMark(s));
    expect(missing, `add these to NXR_MARKS`).toEqual([]);
  });

  // The live Arc roster grew from the original four-core ceremony set. Keep a structural pin:
  // every symbol must resolve to a USDC mark (directly or through an approved bridge), without
  // freezing the deployment roster and forcing ceremony edits into SDK tests.
  test('every live arc roster symbol maps to a USDC-denominated pair', () => {
    const syms = roster('arc');
    if (!syms.length) return;
    expect(syms.length).toBeGreaterThan(0);
    const pair = (s: string) => {
      const p = nxrPair(s, s === 'USDC' ? 'USD' : 'USDC')!;
      return p.quoteVia ? `${p.nxrSymbol} x ${p.quoteVia}` : p.nxrSymbol;
    };
    for (const sym of syms) expect(pair(sym), sym).toMatch(/USDC|USD$/);
    // Held out of the four-core roster but keeping their NXR_MARKS rows, so re-listing is a roster
    // line and nothing more. Each is held for its own reason and none of them is USDC-seedable
    // today: USDE-USDC probed `dead`, USDG-USDC `stale`, BRLA-USDC served an empty body
    // (2026-08-14). One unseedable leg fails the fetch for the WHOLE roster, not just itself.
    for (const held of ['USDE', 'USDG', 'BRLA']) {
      expect(syms).not.toContain(held);
      expect(nxrMark(held), held).not.toBeNull();
      expect(
        nxrPair(held, 'USDC'),
        `${held} must not claim a USDC source it cannot serve`,
      ).toBeNull();
    }
    // RLUSD is held for a different reason and so asserts differently: its USDC row is well-formed
    // and stays, but every basis (USDC/USDT/USD) went dark upstream of any one venue in a
    // non-recovering resubscribe loop (dex 773cc31, 2026-08-14). Re-listing is a roster line.
    expect(syms).not.toContain('RLUSD');
    expect(nxrPair('RLUSD', 'USDC')).not.toBeNull();
    // The only mixed-case symbol in the Sepolia emit is renamed. `.` and case quirks are both
    // forbidden in a roster symbol: it is simultaneously the risk-params key, the seed-marks key,
    // the `feed_<SYM>` record key and the keeper feed name, and Foundry reads `.` as a JSONPath
    // separator, so `parseJsonAddress(sot, ".USDT.b")` looks up `{"USDT":{"b":…}}` and reads absent.
    for (const s of syms) expect(s, s).toMatch(/^[A-Z0-9]{1,16}$/);
    expect(syms).toContain('CBBTC');
    expect(syms).not.toContain('cbBTC');
  });

  // THE constraint on a quoteUnit-0 chain, stated once over whatever the roster happens to be: a
  // USD mark under a USDC-quoted feed is off by the USD/USDC basis with no on-chain correction
  // left, i.e. silently mispriced from the first swap. Neither the scale band nor the peg clamp
  // can see it, so it has to be caught here.
  test('every USDC-basis pair is denominated in USDC, directly or through a chaining bridge', () => {
    for (const [sym, m] of Object.entries(NXR_MARKS)) {
      const p = nxrPair(sym, 'USDC');
      if (!p) continue; // no USDC source: correctly unlistable on such a chain
      // A bridge only composes if the legs MEET: `USDS-USDT` x `USDT-USDC` is USDS-USDC, while
      // `USDS-USDT` x `EUR-USDC` is a product of two unrelated rates.
      if (p.quoteVia) {
        expect(p.nxrSymbol.split('-')[1], sym).toBe(p.quoteVia.split('-')[0]);
        expect(p.quoteVia.split('-')[1], sym).toBe('USDC');
      } else {
        expect(p.nxrSymbol.split('-')[1], sym).toBe('USDC');
      }
      // invert and bridge are different operations on different pairs; a row carrying both is
      // ambiguous, and every USDC cross is served the right way up in any case.
      expect(p.nxrQuote, `${sym} USDC row must not need inverting`).toBeUndefined();
      expect(m.refUsd, sym).toBeDefined();
    }
  });

  // A mark source is DECLARED, never inferred from the symbol. NXR's ticker parser is
  // delimiter-less, so a wrong-shaped symbol does not 404 — `/v1/price/CVX-USD` answers 200 with
  // Chevron at ~197 rather than Convex at ~3. A resolver that fell back to `<SYM>-USD` on a miss
  // would therefore never fail; it would seed a plausible wrong number under the right name.
  test('an unlisted symbol cannot silently resolve to a shaped-looking pair', () => {
    for (const bogus of ['NOTATOKEN', 'BRKB', 'BRK-B', 'BRK.B', 'CVX', 'USDT-USD', '']) {
      expect(nxrMark(bogus), bogus).toBeNull();
    }
    // …and no listed row may be a bare echo of its own symbol, which is what such a fallback
    // would produce and what makes it indistinguishable from a real mapping.
    for (const [sym, m] of Object.entries(NXR_MARKS)) {
      expect(m.nxrSymbol, sym).toMatch(/^[A-Z0-9]{1,16}-(USD|USDC)$/);
    }
  });

  // Case folding and the `.b` faucet suffix, so the ERC-20 `symbol()` of a mock and the legacy
  // Sepolia spelling both land on the canonical row instead of reading as an unknown asset.
  test('resolution folds case and the .b faucet suffix', () => {
    expect(nxrMark('cbBTC')).toBe(NXR_MARKS.CBBTC!);
    expect(nxrMark('USDT.b')).toBe(NXR_MARKS.USDT!);
    expect(nxrMark('weth')).toBe(NXR_MARKS.WETH!);
    // `USDT.b` must not fold onto USDTB, a different registered asset.
    expect(nxrMark('USDT.b')).not.toBe(NXR_MARKS.USDTB!);
  });

  // Owner rule: a fiat wrapper marks the UNDERLYING currency. Its own ticker is an issuer claim,
  // a thinner and more easily dark tape than the rate it tracks — EURC's own Pyth id went
  // unentitled on 2026-08-10 and pinned both oracle keepers in a liveness restart loop. NXR now
  // ANSWERS 200 on the wrapper tickers (QCAD-USD, BRLA-USD, … probed 2026-08-14) with the
  // underlying's mid re-badged at confidence 0, so a 200 is not evidence a wrapper feed exists.
  const WRAPPED_FX: Record<string, string> = {
    EURC: 'EUR',
    QCAD: 'CAD',
    AUDF: 'AUD',
    BRLA: 'BRL',
    JPYC: 'JPY',
    KRW1: 'KRW',
  };
  test.each(Object.entries(WRAPPED_FX))('%s marks %s, not itself', (wrapper, ccy) => {
    const m = nxrMark(wrapper)!;
    expect(m.nxrSymbol).toBe(`${ccy}-USD`);
    // The rule holds on the USDC basis too, and there it is forced rather than preferred: NXR
    // serves `<WRAPPER>-USDC` as a compose-on-read re-badge (flags 128, ci and confidence
    // hardcoded 0) with no live snapshot, and the signer resolves configured symbols against the
    // snapshot map and never composes — so such a pair is permanently unsignable. The leg would be
    // dropped from every blob, its sourceTs would never advance, and its ordinal would be burned.
    const usdc = nxrPair(wrapper, 'USDC');
    if (usdc) {
      expect(usdc.nxrSymbol, wrapper).toBe(`${ccy}-USDC`);
      expect(usdc.nxrSymbol, wrapper).not.toContain(wrapper);
    }
    // The served pair may be the reciprocal; the DENOMINATION must not be. An inverted row yields
    // a plausible number upside down, which only the scale band catches — so it must have one.
    expect(m.nxrQuote === undefined || m.nxrQuote === `USD-${ccy}`, m.nxrQuote).toBe(true);
    expect(m.band).toBeDefined();
    const [lo, hi] = m.band!;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    expect(m.refUsd!).toBeGreaterThanOrEqual(lo);
    expect(m.refUsd!).toBeLessThanOrEqual(hi);
  });

  // Nothing outside the peg band may fall through to the [0.98,1.02] peg clamp.
  test('every non-peg mark declares a scale band containing its own ref', () => {
    for (const [sym, m] of Object.entries(NXR_MARKS)) {
      expect(m.refUsd, sym).toBeDefined();
      if (m.refUsd === 1) continue; // peg stable: the clamp is the band
      expect(m.band, `${sym} would silently be peg-clamped and fail at 0.98`).toBeDefined();
      expect(m.refUsd!, sym).toBeGreaterThanOrEqual(m.band![0]);
      expect(m.refUsd!, sym).toBeLessThanOrEqual(m.band![1]);
    }
  });

  test('the sepolia feed table reads its mapping from this table, not a copy', () => {
    for (const f of SEPOLIA_ORACLE_FEEDS) {
      const m = nxrMark(f.symbol)!;
      expect({ s: f.nxrSymbol, q: f.nxrQuote }, f.name).toEqual({ s: m.nxrSymbol, q: m.nxrQuote });
    }
  });

  test('a session is a fault detector, so an unknown symbol reads as open', () => {
    // Sunday 12:00 UTC — inside the FX weekend halt, outside the BRL window.
    const sundayNoon = Date.UTC(2026, 7, 9, 12, 0);
    expect(closedUntil('QCAD', sundayNoon)).not.toBeNull();
    expect(closedUntil('BRLA', sundayNoon)).not.toBeNull();
    expect(closedUntil('WETH', sundayNoon)).toBeNull(); // 24/7 tape
    expect(closedUntil('NOTATOKEN', sundayNoon)).toBeNull(); // unresolvable ⇒ fault, not excuse
    expect(closedUntil('QCAD', Number.NaN)).toBeNull();
    // Wednesday 15:00 UTC — both open.
    const wed = Date.UTC(2026, 7, 12, 15, 0);
    expect(closedUntil('QCAD', wed)).toBeNull();
    expect(closedUntil('BRLA', wed)).toBeNull();
  });
});
