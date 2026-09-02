/**
 * Where each BTR asset's mark comes from on NX Rates: the ONE table that maps a roster symbol to
 * an NXR pair, and the only thing a deploy ceremony consults before it seeds a feed.
 *
 * The mapping is a property of the ASSET, not of the chain: `WETH` marks `ETH-USDC` on Arc and on
 * anything after it. So this table is chain-free and every chain's roster is resolved
 * THROUGH it (`registry.ts` resolves a chain's feed rows from it; `scripts/fetch-seed-marks.ts`
 * reads it for whichever chain it was pointed at). A second per-chain copy would drift silently, and the drift
 * would be a mark relayed under the wrong asset's name.
 *
 * What IS per-chain is the BASIS: the unit the chain's pools consume a mark in, i.e. its
 * `quoteUnit` column. A QUOTE_UNIT_UOA pool divides the mark by the USDC/USD reference, so it wants
 * the USD row; a QUOTE_UNIT_ANCHOR pool re-denominates nothing, so it wants the `usdc` row and a
 * USD mark there is silently mispriced from the first swap. Both live on the same asset row and
 * `nxrPair(symbol, basis)` picks between them; there is still one table.
 *
 * ⚠ THE MAPPING IS DECLARED, NEVER DERIVED FROM THE SYMBOL. `nxrMark` returns `null` for an
 * unlisted symbol and every caller is required to fail on it, because NXR's ticker parser is
 * delimiter-less and answers 200 to shapes that are not the pair you asked for: `/v1/price/CVX-USD`
 * serves Chevron at ~197, not Convex at ~3, and every wrapped-FX ticker (`QCAD-USD`, `BRLA-USD`, …)
 * answers 200 with the underlying's mid re-badged and `confidence: 0`. A resolver that guessed
 * `<SYM>-USD` would therefore never 404; it would seed a plausible wrong number. Probe an addition
 * with the EXPLICIT pair, treat 404 as absent, and never accept a variant that happens to answer.
 */

/**
 * Weekly OPEN windows as `[openMin, closeMin)` offsets from Sunday 00:00 UTC, ascending and
 * non-overlapping. Absent = the tape never stops. Sole home for BTR market hours: NXR measures them
 * (`.s10` tick_count buckets) but serves them on no endpoint.
 */
export type MarketSession = readonly (readonly [number, number])[];
const DAY_MIN = 1440;
/** FX majors. Sun 21:00 to Fri 22:00 UTC: the venue week is pinned to 17:00 New York, so both
 *  edges move an hour across US DST (21:00 on EDT, 22:00 on EST). Each edge takes the value
 *  that errs OPEN, widening the window by the ambiguous hour on purpose: an hour we are unsure
 *  about reads as a live market, so a dead feed still shows stale rather than being excused as
 *  a scheduled close. The cost is the reverse hour reading stale while genuinely shut. */
const FX_24X5: MarketSession = [[1260, 5 * DAY_MIN + 1320]];
/** USD/BRL on Pyth Lazer: MEASURED Mon-Fri 12:00-21:00 UTC on the live .s10 corpus
 *  2026-07-25..08-03 (nx-rates config.yml:1280-1288). No DST margin needed: the window is
 *  09:00-18:00 in Brazil, which has been UTC-3 year-round since 2019. */
const BRL_SESSION: MarketSession = [1, 2, 3, 4, 5].map(
  (d) => [d * DAY_MIN + 720, d * DAY_MIN + 1260] as const,
);
// US equities carry NO session: the NXR stock tape is 24h (overnight + pre/post market,
// price moves around the clock), so a cash-session window would freeze a live market into
// "markets closed". Operator rule 2026-08-21: never assume market opening hours. If an
// underlying ever goes dark, the mark reads STALE, a fault, which is the honest display.

/** One resolved mark source: which pair to fetch and how to turn it into the feed's quantity. */
export interface NxrPair {
  /** The pair the feed is DENOMINATED in: what the mark means, and what is written to the record. */
  nxrSymbol: string;
  /** The pair actually SERVED, when NXR only carries the reciprocal. The fetched mid is inverted
   *  back into `nxrSymbol` (see the FX rows). Absent = `nxrSymbol` is served directly. */
  nxrQuote?: string;
  /** Bridge leg for a composed mark: the mark is `mid(nxrSymbol) * mid(quoteVia)`. Used where an
   *  asset's only first-class tape is quoted in something other than the unit the feed needs:
   *  `USDS-USDT` x `USDT-USDC` is `USDS-USDC`. Mutually exclusive with `nxrQuote`. */
  quoteVia?: string;
}

export interface NxrMark extends NxrPair {
  /** The same asset on the USDC BASIS, for a chain whose pools consume a mark as attested
   *  (quoteUnit 0). Absent = the asset has no USDC-denominated source and cannot be listed there;
   *  callers must fail rather than fall back to the USD row, which is the silent-mispricing case. */
  usdc?: NxrPair;
  /** Weekly open windows; absent = 24/7. */
  session?: MarketSession;
  /** Plausibility window for a seed mid, in units of `nxrSymbol`. A SCALE guard, deliberately wide:
   *  it catches a 1e3 fat-finger or an inverted pair, not a market move. Absent ⇒ the caller applies
   *  its peg band, so a non-peg asset MUST carry one or it fails at 0.98. */
  band?: readonly [number, number];
  /** Sizing fallback in USD while the live oracle is stale. Never a price source. */
  refUsd?: number;
}

const PEG_STABLE = (nxrSymbol: string, usdc?: NxrPair): NxrMark => ({ nxrSymbol, usdc, refUsd: 1 });

/**
 * Roster symbol ⇒ its NXR mark source. Keys are canonical roster symbols: punctuation stripped,
 * UPPER-CASE (`arc-risk-params.json` `.noteSymbolConvention`). `CBBTC`, not `cbBTC`: the mixed-case
 * spelling mismatches the `TOKENS` registry key and is already rejected by the collector's
 * `/^[A-Z0-9]{1,16}-…/` pair regex, so it resolves here only through `nxrMark`'s case folding.
 */
export const NXR_MARKS: Record<string, NxrMark> = {
  // ── peg stables. The USD row is Pyth `X-USD`, correct only where the pool re-denominates
  // on-chain (Pricing._denominate divides by the USDC-USD reference); it is NOT the retired
  // "USDC≈1 proxy", which was extractable (DEN-01, 2026-07-29). The `usdc` row is the pair for a
  // pool that consumes the mark as attested, and only the five Arc lists carry one. USDS, PYUSD and USD1
  // bridge through USDT: USDS and PYUSD because their `-USDC` and `-USD` are both compose-on-read
  // (flags 128), which the signer cannot resolve at all, and USD1 because `USD1-USDC` is flags 64
  // but DEAD: sampled 6x over 36s its age only climbed, 368s to 408s, while `USD1-USDT` stayed
  // fresh. USDT and RLUSD are first-class USDC tape.
  USDT: PEG_STABLE('USDT-USD', { nxrSymbol: 'USDT-USDC' }),
  USDE: PEG_STABLE('USDE-USD'),
  USDS: PEG_STABLE('USDS-USD', { nxrSymbol: 'USDS-USDT', quoteVia: 'USDT-USDC' }),
  DAI: PEG_STABLE('DAI-USD'),
  USD1: PEG_STABLE('USD1-USD', { nxrSymbol: 'USD1-USDT', quoteVia: 'USDT-USDC' }),
  USDG: PEG_STABLE('USDG-USD'),
  PYUSD: PEG_STABLE('PYUSD-USD', { nxrSymbol: 'PYUSD-USDT', quoteVia: 'USDT-USDC' }),
  RLUSD: PEG_STABLE('RLUSD-USD', { nxrSymbol: 'RLUSD-USDC' }),
  USDF: PEG_STABLE('USDF-USD'),
  U: PEG_STABLE('U-USD'),
  GHO: PEG_STABLE('GHO-USD'),
  TUSD: PEG_STABLE('TUSD-USD'),
  USDTB: PEG_STABLE('USDTB-USD'),
  FDUSD: PEG_STABLE('FDUSD-USD'),
  AUSD: PEG_STABLE('AUSD-USD'),
  /** The base's own depeg reference. There is no USDC/USDC identity feed. */
  USDC: PEG_STABLE('USDC-USD'),
  // ── Arc faucet twins. Pool legs that own NO FEED: each borrows an existing one on chain
  // (dex arc-risk-params `noteFaucetTwins`). A row here is what gives the front a price symbol at
  // all: `priceSymbolOf` reads `nxrSymbol`, so without one the stream key is the roster symbol
  // itself (`EURCBUSDC`), which resolves to nothing and silently values the leg at `refUsd ?? 1`.
  //
  // EACH TWIN STATES ITS OWN IDENTITY, NOT THE FEED IT BORROWS. USDC.b is a USDC twin, so it
  // mirrors USDC even though the pool currently marks it off USDT-USDC. That on-chain basis is a
  // known defect, not the asset's identity, and naming USDT here would copy the defect into the
  // one table the keeper also reads. `USDC-USDC` is not served, so this correctly falls through
  // to refUsd 1 rather than inventing a cross.
  USDCB: PEG_STABLE('USDC-USD'),

  // ── volatiles: native USDC CEX tape.
  WETH: { nxrSymbol: 'ETH-USDC', band: [500, 20_000], refUsd: 1915 },
  WBTC: { nxrSymbol: 'BTC-USDC', band: [20_000, 500_000], refUsd: 63_800 },
  // CBBTC and WBTC share BTC-USDC: NXR serves neither `WBTC-USD` nor `CBBTC-USD` (both 404,
  // probed 2026-08-14), and a wrapper's own tape would be thinner than BTC's in any case.
  CBBTC: { nxrSymbol: 'BTC-USDC', band: [20_000, 500_000], refUsd: 63_800 },
  BNB: { nxrSymbol: 'BNB-USDC', band: [100, 5_000], refUsd: 574 },
  XAUT: { nxrSymbol: 'XAUT-USDC', band: [1_500, 10_000], refUsd: 4030 },
  // PAXG's only first-class tape is USDT-quoted: `PAXG-USD` and `PAXG-USDC` are both
  // compose-on-read (flags 128), which the signer cannot resolve at all.
  PAXG: {
    nxrSymbol: 'PAXG-USD',
    usdc: { nxrSymbol: 'PAXG-USDT', quoteVia: 'USDT-USDC' },
    band: [1_500, 10_000],
    refUsd: 4040,
  },

  // ── US equities. Native USDC tape is compose-on-read (flags 192) and /v1/price composes it on
  // demand, verified against each name's own `<SYM>-USD` (flags 96) on 2026-08-19: the two agree
  // to ~0.015 %, which is exactly the USDC-USD basis. So no bridge and no reciprocal is needed,
  // unlike the fiat wrappers below. refUsd is that observation, NOT an independently sourced price.

  NVDA: { nxrSymbol: 'NVDA-USDC', band: [50, 1000], refUsd: 221 },
  MSFT: { nxrSymbol: 'MSFT-USDC', band: [100, 2000], refUsd: 479 },
  META: { nxrSymbol: 'META-USDC', band: [125, 2200], refUsd: 545 },
  TSLA: { nxrSymbol: 'TSLA-USDC', band: [75, 1400], refUsd: 338 },
  AVGO: { nxrSymbol: 'AVGO-USDC', band: [90, 1500], refUsd: 371 },
  AMD: { nxrSymbol: 'AMD-USDC', band: [100, 2000], refUsd: 487 },
  ORCL: { nxrSymbol: 'ORCL-USDC', band: [35, 600], refUsd: 142 },
  INTC: { nxrSymbol: 'INTC-USDC', band: [20, 400], refUsd: 93 },
  ASML: { nxrSymbol: 'ASML-USDC', band: [400, 7000], refUsd: 1757 },
  SPCX: { nxrSymbol: 'SPCX-USDC', band: [35, 600], refUsd: 140 },
  // ── fiat-backed wrappers: mark the UNDERLYING CURRENCY, never the wrapper.
  // Owner rule, and on the USDC basis it is no longer merely a preference. A wrapper's own ticker
  // is an issuer claim on the currency: a thinner, more easily dark tape than the rate it tracks.
  // EURC's own Pyth id 240 went unentitled on 2026-08-10 and pinned both oracle keepers in a
  // liveness restart loop, taking 20+ healthy feeds with them.
  //
  // ⚠ NXR ANSWERS 200 on every wrapper ticker, in BOTH units, and none of them is real tape.
  // Probed 2026-08-14: `QCAD-USD` 0.7185508267, `QCAD-USDC` 0.7186596481, `EURC-USDC` 1.154188538,
  // all `flags: 128` (FLAG_COMPOSED, compose-on-read) with `ci` and `confidence` hardcoded to 0,
  // and byte-near-identical to the underlying (`CAD-USDC` 0.7186550655, `EUR-USDC` 1.154159081,
  // both `flags: 64` / `confidence: 129`). A 200 is not evidence a wrapper feed exists.
  //
  // It is worse than redundant on the USDC basis: the signer resolves a configured symbol against
  // the aggregator's live snapshot map and never composes, so a compose-on-read pair has no
  // snapshot and is PERMANENTLY UNSIGNABLE: the leg is dropped from every blob, its on-chain
  // sourceTs never advances, and its append-only ordinal is burned, all without an error.
  //
  // `nxrQuote` names the pair NXR actually serves; the fetched mid is reciprocated back into
  // `nxrSymbol`. An inverted row is the DANGEROUS error (a plausible number, upside down), which is
  // what `band` exists to catch. The `-USDC` crosses are served the right way up and need neither.
  EURC: { nxrSymbol: 'EUR-USD', usdc: { nxrSymbol: 'EUR-USDC' }, band: [0.9, 1.3], refUsd: 1.14 },
  // EURC.b twin: same currency, same tape, and here the borrowed feed IS the right basis.
  EURCB: { nxrSymbol: 'EUR-USD', usdc: { nxrSymbol: 'EUR-USDC' }, band: [0.9, 1.3], refUsd: 1.14 },
  QCAD: {
    nxrSymbol: 'CAD-USD',
    nxrQuote: 'USD-CAD',
    usdc: { nxrSymbol: 'CAD-USDC' },
    session: FX_24X5,
    band: [0.5, 1.0],
    refUsd: 0.71,
  },
  AUDF: {
    nxrSymbol: 'AUD-USD',
    usdc: { nxrSymbol: 'AUD-USDC' },
    session: FX_24X5,
    band: [0.4, 1.0],
    refUsd: 0.7,
  },
  BRLA: {
    nxrSymbol: 'BRL-USD',
    nxrQuote: 'USD-BRL',
    session: BRL_SESSION,
    band: [0.1, 0.4],
    refUsd: 0.2,
  },
  JPYC: {
    nxrSymbol: 'JPY-USD',
    nxrQuote: 'USD-JPY',
    usdc: { nxrSymbol: 'JPY-USDC' },
    session: FX_24X5,
    band: [0.003, 0.012],
    refUsd: 0.00612,
  },
  KRW1: {
    nxrSymbol: 'KRW-USD',
    nxrQuote: 'USD-KRW',
    usdc: { nxrSymbol: 'KRW-USDC' },
    session: FX_24X5,
    band: [0.0003, 0.0015],
    refUsd: 0.000681,
  },
};

/**
 * Mark source for a roster symbol, or `null` when the asset has none.
 *
 * Case-folded and `.b`-suffix-tolerant so the ERC-20 `symbol()` of a faucet mock (`USDT.b`) and a
 * legacy mixed-case spelling (`cbBTC`) both land on the canonical row. Never synthesises a mapping.
 */
export function nxrMark(symbol: string): NxrMark | null {
  return NXR_MARKS[symbol.replace(/\.b$/i, '').toUpperCase()] ?? null;
}

/** The unit a chain's pools consume a mark in: its `quoteUnit` column, not a preference. */
export type MarkBasis = 'USD' | 'USDC';

/**
 * The pair to fetch for `symbol` on `basis`, or `null` when the asset has no source there.
 *
 * On the USD basis (QUOTE_UNIT_UOA) the pool divides the mark by the USDC/USD reference, so any
 * USD-quoted tape denominates the leg and the row itself is the answer. On the USDC basis
 * (QUOTE_UNIT_ANCHOR) the pool re-denominates NOTHING: a USD mark would be off by the USD/USDC
 * basis with no on-chain correction left, silently mispriced from the first swap. So the USDC row
 * must be DECLARED: the one exception is a row already quoted in USDC outright, which is the same
 * pair rather than a guess at one.
 *
 * ⚠ Never fall back to the USD row here. `null` is the whole point: the caller must fail.
 */
export function nxrPair(symbol: string, basis: MarkBasis = 'USD'): NxrPair | null {
  const m = nxrMark(symbol);
  if (!m) return null;
  if (basis === 'USD') return m;
  if (m.usdc) return m.usdc;
  return m.nxrSymbol.endsWith('-USDC') && !m.nxrQuote && !m.quoteVia ? m : null;
}

/**
 * Null when the market is open or declares no session, else the ms instant it reopens.
 * This is what separates a mark frozen BY DESIGN from a feed that has died: the same
 * frozen mark is expected inside a closed window and a fault inside an open one, so
 * every unresolvable case (unknown symbol, bad clock) returns null and reads as a fault.
 */
export function closedUntil(symbol: string, atMs: number = Date.now()): number | null {
  const s = nxrMark(symbol)?.session;
  if (!s?.length || !Number.isFinite(atMs)) return null;
  const d = new Date(atMs);
  const min = d.getUTCDay() * DAY_MIN + d.getUTCHours() * 60 + d.getUTCMinutes();
  if (s.some(([open, close]) => min >= open && min < close)) return null;
  const next = s.find(([open]) => open > min)?.[0] ?? 7 * DAY_MIN + s[0]![0];
  const minuteStart = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  );
  return minuteStart + (next - min) * 60_000;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `closedUntil` instant as "Mon 12:00 UTC". UTC because the session itself is declared in UTC. */
export function sessionOpenLabel(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
