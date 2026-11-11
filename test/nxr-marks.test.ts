import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NXR_MARKS, closedUntil, mdBase, nxrMark, nxrPair, staticRefUsd } from '../src/venues/nxr';
import { activeRefMarksUsd, chainVenue } from '../src/venues/registry';

/**
 * `NXR_MARKS` is the only statement of where an asset's mark comes from, and the deploy ceremony
 * seeds every feed from it. A wrong row is not a crash: it is a plausible number seeded under the
 * wrong asset's name, which the on-chain deviation band then locks in.
 *
 * The dangerous failures are all silent, so each has its own test below: a symbol NXR does not
 * serve, a pair resolved by shape rather than declaration, an inverted FX row, and a wrapper marked
 * against its own thin ticker instead of the currency it tracks.
 */
const DEX = resolve(import.meta.dir, '../../dex-evm/deployments');

describe('NXR mark sources', () => {
  test('every bnb manifest asset has a mark on its quoteUnit basis', () => {
    const p = resolve(DEX, 'bnb.manifest.json');
    if (!existsSync(p)) return;
    const assets = JSON.parse(readFileSync(p, 'utf8')).assets as Record<
      string,
      { ref?: boolean; quoteUnit?: number }
    >;
    const missing = Object.entries(assets)
      .filter(([s, a]) => !s.startsWith('_') && !a.ref)
      .filter(([s, a]) => !nxrPair(s, s === 'USDC' || a.quoteUnit === 1 ? 'USD' : 'USDC'))
      .map(([s]) => s);
    expect(missing, 'add these to NXR_MARKS').toEqual([]);
  });

  // THE constraint on a quoteUnit-0 chain, stated once over whatever the roster happens to be: a
  // USD mark under a USDC-quoted feed is off by the USD/USDC basis with no on-chain correction
  // left, i.e. silently mispriced from the first swap. Neither the scale band nor the peg clamp
  // can see it, so it has to be caught here.
  test('every USDC-basis pair is denominated in USDC', () => {
    for (const [sym, m] of Object.entries(NXR_MARKS)) {
      const p = nxrPair(sym, 'USDC');
      if (!p) continue; // no USDC source: correctly unlistable on such a chain
      expect(p.nxrSymbol.split('-')[1], sym).toBe('USDC');
      // every USDC cross is served the right way up, so the USDC row never needs inverting.
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

  // Case folding and the `.b` faucet suffix, so the ERC-20 `symbol()` of a mock and a legacy
  // mixed-case spelling both land on the canonical row instead of reading as an unknown asset.
  test('resolution folds case and the .b faucet suffix', () => {
    expect(nxrMark('cbBTC')).toBe(NXR_MARKS.CBBTC!);
    expect(nxrMark('USDT.b')).toBe(NXR_MARKS.USDT!);
    expect(nxrMark('weth')).toBe(NXR_MARKS.WETH!);
    // USDF-USD / USDTB-USD were dead on NXR (USDTB 94 days) and backed no leg, feed or display:
    // no row, so they resolve to nothing rather than to a tape that never ticks.
    expect(nxrMark('USDTB')).toBeNull();
    expect(nxrMark('USDF')).toBeNull();
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

  // Every on-chain feed name resolves its mark source THROUGH this table. A feed the deployment
  // record carries but `NXR_MARKS` does not is a leg nothing can seed or push, and it would only
  // surface at ceremony time.
  test('every deployed monad feed resolves its mapping from this table, not a copy', () => {
    const feeds = Object.keys(chainVenue(143).feedIds);
    expect(feeds.length).toBeGreaterThan(0);
    for (const name of feeds) {
      const symbol = name.slice(0, name.lastIndexOf('-'));
      expect(nxrMark(symbol), name).not.toBeNull();
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

test('custodial BTC wrappers use distinct signed asset identities', () => {
  expect(nxrPair('WBTC', 'USDC')!.nxrSymbol).toBe('WBTC-USDC');
  expect(nxrPair('CBBTC', 'USDC')!.nxrSymbol).toBe('CBBTC-USDC');
  expect(nxrMark('WBTC')!.nxrSymbol).not.toBe(nxrMark('CBBTC')!.nxrSymbol);
});

test('mdBase: charts/tickers key on the NXR ticker, not the roster leg', () => {
  const want: Record<string, string> = {
    USDC: 'USDC',
    USDT0: 'USDT',
    WETH: 'ETH',
    WMON: 'MON',
    CBBTC: 'BTC',
    cbBTC: 'BTC',
    WBTC: 'WBTC',
    XAUT0: 'XAUT',
    MUSD: 'MUSD',
    AUSD: 'AUSD',
    GHO: 'GHO',
    USDE: 'USDE',
  };
  for (const [leg, base] of Object.entries(want)) expect(mdBase(leg)).toBe(base);
  expect(mdBase('NOPE')).toBe('NOPE');
});

test('an accruing vault share has no static USD ref (sizing falls back)', () => {
  expect(nxrMark('SYRUPUSDC')?.refUsd).toBeGreaterThan(0); // still the band anchor
  expect(staticRefUsd('SYRUPUSDC')).toBeUndefined();
  expect(staticRefUsd('WETH')).toBeGreaterThan(0);
  for (const id of [143]) expect(activeRefMarksUsd(id).SYRUPUSDC).toBeUndefined();
});
