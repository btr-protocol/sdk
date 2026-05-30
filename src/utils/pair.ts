/**
 * Pair string utilities - canonical splitter for `<BASE><QUOTE>` symbols.
 *
 * Single source of truth for quote-suffix list. Previously duplicated across:
 *  - back/services/collector/src/resolve-pair.ts (splitPair)
 *  - back/services/collector/src/pair-codec.ts  (convertToCCXTSymbol)
 *  - front/src/hooks/useCollectorAllowlist.ts   (extractBaseSymbol)
 *
 * Each had a slightly different QUOTES list → drift. Consolidated here.
 */

/**
 * Recognised quote suffixes, ordered longest-first so that disambiguation
 * (USDT > USD, USDC > USD, USDE > USD) is correct when scanning end-of-string.
 */
export const QUOTE_SUFFIXES = [
  'USDT',
  'USDC',
  'USDE',
  'USD',
  'BTC',
  'ETH',
  'EUR',
] as const;

export type QuoteSuffix = (typeof QUOTE_SUFFIXES)[number];

/**
 * Split a pair string into `{base, quote}`.
 *
 * Accepts:
 *  - Slash form: `BTC/USDT` → `{base:'BTC', quote:'USDT'}`
 *  - Concatenated form: `BTCUSDT` → falls back to suffix-match against
 *    {@link QUOTE_SUFFIXES} (longest-first).
 *
 * Returns `null` when the string cannot be parsed (no slash and no known
 * suffix, or empty base).
 *
 * Case-insensitive: input is upper-cased before matching, so the returned
 * `base`/`quote` are always upper-case.
 */
export function splitPair(pair: string): { base: string; quote: string } | null {
  if (!pair) return null;
  const p = pair.toUpperCase();
  // Slash form takes precedence (handles both `BTC/USDT` and quotes ! ∈ list).
  const slashIdx = p.indexOf('/');
  if (slashIdx > 0 && slashIdx < p.length - 1) {
    return { base: p.slice(0, slashIdx), quote: p.slice(slashIdx + 1) };
  }
  // Suffix-match against known quotes, longest first.
  for (const q of QUOTE_SUFFIXES) {
    if (p.endsWith(q) && p.length > q.length) {
      return { base: p.slice(0, p.length - q.length), quote: q };
    }
  }
  return null;
}
