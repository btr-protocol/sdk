/**
 * Where each BTR asset's mark comes from on NX Rates — the ONE table that maps a roster symbol to
 * an NXR pair, and the only thing a deploy ceremony consults before it seeds a feed.
 *
 * The mapping is a property of the ASSET, not of the chain: `WETH` marks `ETH-USDC` on Sepolia, on
 * Arc, and on anything after them. So this table is chain-free and every chain's roster is resolved
 * THROUGH it (`sepolia.ts` builds its feed rows from it; `scripts/fetch-seed-marks.ts` reads it for
 * whichever chain it was pointed at). A second per-chain copy would drift silently, and the drift
 * would be a mark relayed under the wrong asset's name.
 *
 * ⚠ THE MAPPING IS DECLARED, NEVER DERIVED FROM THE SYMBOL. `nxrMark` returns `null` for an
 * unlisted symbol and every caller is required to fail on it, because NXR's ticker parser is
 * delimiter-less and answers 200 to shapes that are not the pair you asked for: `/v1/price/CVX-USD`
 * serves Chevron at ~197, not Convex at ~3, and every wrapped-FX ticker (`QCAD-USD`, `BRLA-USD`, …)
 * answers 200 with the underlying's mid re-badged and `confidence: 0`. A resolver that guessed
 * `<SYM>-USD` would therefore never 404 — it would seed a plausible wrong number. Probe an addition
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

export interface NxrMark {
  /** The pair the feed is DENOMINATED in — what the mark means, and what is written to the record. */
  nxrSymbol: string;
  /** The pair actually SERVED, when NXR only carries the reciprocal. The fetched mid is inverted
   *  back into `nxrSymbol` (see the FX rows). Absent = `nxrSymbol` is served directly. */
  nxrQuote?: string;
  /** Second leg for a composed mark (`back` collector multiplies through it). */
  quoteVia?: string;
  /** Weekly open windows; absent = 24/7. */
  session?: MarketSession;
  /** Plausibility window for a seed mid, in units of `nxrSymbol`. A SCALE guard, deliberately wide:
   *  it catches a 1e3 fat-finger or an inverted pair, not a market move. Absent ⇒ the caller applies
   *  its peg band, so a non-peg asset MUST carry one or it fails at 0.98. */
  band?: readonly [number, number];
  /** Sizing fallback in USD while the live oracle is stale. Never a price source. */
  refUsd?: number;
}

const PEG_STABLE = (nxrSymbol: string): NxrMark => ({ nxrSymbol, refUsd: 1 });

/**
 * Roster symbol ⇒ its NXR mark source. Keys are canonical roster symbols: punctuation stripped,
 * UPPER-CASE (`arc-risk-params.json` `.noteSymbolConvention`). `CBBTC`, not `cbBTC` — the mixed-case
 * spelling mismatches the `TOKENS` registry key and is already rejected by the collector's
 * `/^[A-Z0-9]{1,16}-…/` pair regex, so it resolves here only through `nxrMark`'s case folding.
 */
export const NXR_MARKS: Record<string, NxrMark> = {
  // ── peg stables — Pyth `X-USD`. The pool re-denominates on-chain (Pricing._denominate divides by
  // the USDC-USD reference), so a `X-USD` mark under a `X-USDC` feed name is correct; it is NOT the
  // retired "USDC≈1 proxy", which was extractable (DEN-01, 2026-07-29).
  USDT: PEG_STABLE('USDT-USD'),
  USDE: PEG_STABLE('USDE-USD'),
  USDS: PEG_STABLE('USDS-USD'),
  DAI: PEG_STABLE('DAI-USD'),
  USD1: PEG_STABLE('USD1-USD'),
  USDG: PEG_STABLE('USDG-USD'),
  PYUSD: PEG_STABLE('PYUSD-USD'),
  RLUSD: PEG_STABLE('RLUSD-USD'),
  USDF: PEG_STABLE('USDF-USD'),
  U: PEG_STABLE('U-USD'),
  GHO: PEG_STABLE('GHO-USD'),
  TUSD: PEG_STABLE('TUSD-USD'),
  USDTB: PEG_STABLE('USDTB-USD'),
  FDUSD: PEG_STABLE('FDUSD-USD'),
  AUSD: PEG_STABLE('AUSD-USD'),
  /** The base's own depeg reference. There is no USDC/USDC identity feed. */
  USDC: PEG_STABLE('USDC-USD'),

  // ── volatiles — native USDC CEX tape.
  WETH: { nxrSymbol: 'ETH-USDC', band: [500, 20_000], refUsd: 1915 },
  WBTC: { nxrSymbol: 'BTC-USDC', band: [20_000, 500_000], refUsd: 63_800 },
  // CBBTC and WBTC share BTC-USDC: NXR serves neither `WBTC-USD` nor `CBBTC-USD` (both 404,
  // probed 2026-08-14), and a wrapper's own tape would be thinner than BTC's in any case.
  CBBTC: { nxrSymbol: 'BTC-USDC', band: [20_000, 500_000], refUsd: 63_800 },
  BNB: { nxrSymbol: 'BNB-USDC', band: [100, 5_000], refUsd: 574 },
  XAUT: { nxrSymbol: 'XAUT-USDC', band: [1_500, 10_000], refUsd: 4030 },
  PAXG: { nxrSymbol: 'PAXG-USD', band: [1_500, 10_000], refUsd: 4040 },

  // ── fiat-backed wrappers — mark the UNDERLYING CURRENCY, never the wrapper.
  // Owner rule, and it is not a style preference: a wrapper's own ticker is an issuer claim on the
  // currency, a thinner and more easily dark tape than the FX rate it tracks. EURC's own Pyth id 240
  // went unentitled on 2026-08-10 and pinned both oracle keepers in a liveness restart loop, taking
  // 20+ healthy feeds down with it. `keepers/scripts/gen-sepolia-feeds.test.py` gates the rule.
  //
  // ⚠ NXR now ANSWERS 200 on the wrapper tickers (`QCAD-USD` 0.7176715863, `BRLA-USD` 0.1912535908,
  // probed 2026-08-14) — byte-identical mids to `CAD-USD` / `BRL-USD` with `confidence: 0` against
  // the underlying's 129. They are re-badged synthetics carrying no independent information, so a
  // 200 here is not evidence that a wrapper feed exists.
  //
  // `nxrQuote` names the pair NXR actually serves; the fetched mid is reciprocated back into
  // `nxrSymbol`. An inverted row is the DANGEROUS error (a plausible number, upside down), which is
  // what `band` exists to catch.
  EURC: { nxrSymbol: 'EUR-USD', band: [0.9, 1.3], refUsd: 1.14 },
  QCAD: {
    nxrSymbol: 'CAD-USD',
    nxrQuote: 'USD-CAD',
    session: FX_24X5,
    band: [0.5, 1.0],
    refUsd: 0.71,
  },
  AUDF: { nxrSymbol: 'AUD-USD', session: FX_24X5, band: [0.4, 1.0], refUsd: 0.7 },
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
    session: FX_24X5,
    band: [0.003, 0.012],
    refUsd: 0.00612,
  },
  KRW1: {
    nxrSymbol: 'KRW-USD',
    nxrQuote: 'USD-KRW',
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
