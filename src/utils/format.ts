/**
 * Formatting utilities for numbers, currencies, durations, and text
 * Used across frontend and backend for consistent display
 */

import { round, precision, getDigits } from './maths.js';

// ─────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
  CHF: 'CHF', CAD: 'C$', AUD: 'A$', KRW: '₩', INR: '₹',
};

/** Format currency with auto-precision based on magnitude */
export function formatCurrency(n: number | null | undefined, currency = 'USD', signed = false): string {
  if (n == null || !isFinite(n)) return `${CURRENCY_SYMBOLS[currency] ?? '$'}0.00`;

  const absN = Math.abs(n);
  const sign = n < 0 ? '-' : signed ? '+' : '';
  const symbol = CURRENCY_SYMBOLS[currency] ?? '$';

  // Large values: compact notation
  if (absN >= 1_000_000_000) return `${sign}${symbol}${round(absN / 1_000_000_000, 2)}B`;
  if (absN >= 1_000_000) return `${sign}${symbol}${round(absN / 1_000_000, 2)}M`;
  if (absN >= 10_000) return `${sign}${symbol}${round(absN / 1_000, 1)}K`;

  // Standard values: 2 decimals with commas
  if (absN >= 1) {
    return sign + symbol + absN.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // Small values: show significant figures
  const decimals = absN >= 0.01 ? 4 : getDigits(absN) + 2;
  return sign + symbol + absN.toFixed(Math.max(0, Math.min(decimals, 8)));
}

/** Format currency with compact notation ($1.5M, $2.3B) */
export function formatCurrencyCompact(n: number | null | undefined, currency = 'USD', signed = false): string {
  if (n == null || !isFinite(n)) return `${CURRENCY_SYMBOLS[currency] ?? '$'}0`;

  const absN = Math.abs(n);
  const sign = n < 0 ? '-' : signed ? '+' : '';
  const symbol = CURRENCY_SYMBOLS[currency] ?? '$';

  if (absN >= 1_000_000_000_000) return `${sign}${symbol}${(absN / 1_000_000_000_000).toFixed(2)}T`;
  if (absN >= 1_000_000_000) return `${sign}${symbol}${(absN / 1_000_000_000).toFixed(2)}B`;
  if (absN >= 1_000_000) return `${sign}${symbol}${(absN / 1_000_000).toFixed(2)}M`;
  if (absN >= 1_000) return `${sign}${symbol}${(absN / 1_000).toFixed(2)}K`;

  return `${sign}${symbol}${round(absN, 2).toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────
// Token Units (Ethereum Wei/Decimals)
// ─────────────────────────────────────────────────────────────

/** Format token amount from wei to decimal string */
export function formatUnits(value: bigint, decimals: number): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, -decimals) || '0';
  const decPart = str.slice(-decimals);
  const trimmed = decPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/** Parse decimal string to token amount (wei) */
export function parseUnits(value: string, decimals: number): bigint {
  const [intPart, decPart = ''] = value.split('.');
  const padded = decPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart + padded);
}

/** Format from wei to ether (18 decimals) */
export function formatEther(value: bigint): string {
  return formatUnits(value, 18);
}

/** Parse ether decimal to wei */
export function parseEther(value: string): bigint {
  return parseUnits(value, 18);
}

// ─────────────────────────────────────────────────────────────
// Numbers
// ─────────────────────────────────────────────────────────────

/** Token/share amounts. Always at least two fraction digits: 10 → "10.00", 2,000 → "2,000.00".
 *  Pass `maxDecimals === 0` only for explicit integers (inventory skew). Dust (<0.01) uses
 *  `formatPrice` so it does not collapse to "0.00". */
export function formatNumber(n: number | null | undefined, maxDecimals?: number): string {
  if (n == null || !isFinite(n)) return '0.00';
  if (maxDecimals === 0) {
    return round(n, 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.01) return formatPrice(n);
  const max = Math.max(2, maxDecimals ?? 2);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  });
}

/**
 * Drop trailing fractional zeros. Guarded on `decimals > 0`: toFixed(0) yields no
 * decimal point, so a bare strip would eat integer zeros and render 20 as "2".
 */
function trimZeros(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, '') : s;
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

/**
 * Collapse a long leading-zero run into the exchange subscript form: `0.00001234` → `0.0₄1234`,
 * the subscript being the count of zeros between the point and the first significant digit.
 *
 * Subscript rather than scientific because a price column exists to answer "is this bigger than
 * the row above it", and the subscript form stays a DECIMAL, so that question is still answered by
 * looking. `1.234e-5` above `9.87e-6` makes it exponent arithmetic. It is also the notation every
 * venue a trader already reads uses for this range, so it needs no explaining.
 *
 * Applied from THREE zeros (1e-4 and below, so `0.0001` → `0.0₃1`): at two the plain form is still
 * short, and collapsing `0.001` would be noise for no width saved.
 *
 * Counts the zeros in the RENDERED string, never from a log: `floor(-log10(x))` is off by one at
 * an exact decade (1e-4 answers 4, not 3), and rounding can move the boundary under it anyway.
 *
 * Display only. Never feed the result to a parser or an input: `toInputValue` is for that.
 */
export function subscriptZeros(s: string): string {
  // `[1-9]` lookahead, not `\d`: an all-zero tail has no significant digit to prefix, and a greedy
  // run would otherwise backtrack onto one of its own zeros and render 0.0000 as "0.0₃0".
  return s.replace(
    /^(-?0\.)(0{3,})(?=[1-9])/,
    // "0.0" is a fixed prefix and the subscript is the FULL zero count, not the remainder after
    // the one shown: 0.0₃1 reads back as "0." + three zeros + "1" = 0.0001. Dropping that literal
    // zero renders 0.₃1, which reads as a decimal point followed by a footnote marker.
    (_m, head: string, zeros: string) =>
      `${head}0${String(zeros.length).replace(/\d/g, (d) => SUBSCRIPT_DIGITS[+d]!)}`,
  );
}

/**
 * Plain ASCII decimal for seeding a text input: no grouping, no subscript, no exponent, so it
 * parses back to the number it came from. The display formatters are for READING, and every one of
 * them can emit a character an amount field strips (a comma) or misreads (a subscript), which is
 * why seeding a field from `formatPrice(...)` already needed a `.replace(/,/g, '')` chaser to work.
 */
export function toInputValue(n: number | null | undefined, maxDecimals = 12): string {
  if (n == null || !isFinite(n)) return '';
  return trimZeros(n, Math.min(Math.max(0, maxDecimals), 100)) || '0';
}

/** Format with compact notation (1K, 1M, 1B) */
export function formatCompact(n: number | null | undefined, signed = false): string {
  if (n == null || !isFinite(n)) return '0';

  const absN = Math.abs(n);
  const sign = n < 0 ? '-' : signed ? '+' : '';

  if (absN >= 1_000_000_000_000) return `${sign}${(absN / 1_000_000_000_000).toFixed(2)}T`;
  if (absN >= 1_000_000_000) return `${sign}${(absN / 1_000_000_000).toFixed(2)}B`;
  if (absN >= 1_000_000) return `${sign}${(absN / 1_000_000).toFixed(2)}M`;
  if (absN >= 1_000) return `${sign}${(absN / 1_000).toFixed(2)}K`;

  return sign + formatNumber(absN);
}

/**
 * Format price with appropriate decimals (UI mid, depth rows, chart axis).
 * `step` = the ladder tick the price lives on; without it a 1e-5 book prints eight identical
 * rows at the default 4 decimals, so any tick-aware surface must pass its own step.
 */
export function formatPrice(n: number | null | undefined, step?: number): string {
  if (n == null || !isFinite(n)) return '0.00';

  const absN = Math.abs(n);

  if (step != null && step > 0 && isFinite(step)) {
    const decimals = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  if (absN >= 1000) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (absN >= 1) {
    const decimals = absN >= 100 ? 2 : absN >= 10 ? 3 : 4;
    return n.toFixed(decimals);
  }
  // Sub-1: FIVE significant digits past the leading zeros, trailing zeros trimmed. Significant
  // digits rather than a fixed decimal count because a fixed count is wrong at both ends of the
  // range it has to cover: four decimals collapse a 0.0295 pair to "0.03" (adjacent chart ticks
  // printed the identical label), while padding a 1e-5 price to twelve places is all zeros.
  //
  // Past three zeros the run itself is the unreadable part, so `subscriptZeros` folds it (0.0₄1234)
  // and the digits that carry the price stay in plain sight. That replaced an exponential escape
  // below 1e-8, which solved the same length problem by changing notation mid-column: two adjacent
  // axis ticks could print "0.000000012" and "9.90e-9" for prices a hair apart.
  if (absN > 0) {
    // `-floor(log10) - 1` is the zero COUNT; `floor(-log10)` is the exponent magnitude and is one
    // too many at an exact decade. Only sizes the field here: `subscriptZeros` counts the real
    // zeros in the rounded string, so a rounding that crosses a decade cannot desync the two.
    const zeros = Math.max(0, -Math.floor(Math.log10(absN)) - 1);
    const decimals = zeros + 5;
    // toFixed caps at 100 digits. Nothing this small is a price, but it must not render as "0".
    if (decimals > 100) return n.toExponential(2);
    return subscriptZeros(trimZeros(n, decimals)) || '0.00';
  }

  return '0.00';
}

/**
 * Chart axis tick. Large values compact so the gutter stays narrow; everything below 1 defers to
 * `formatPrice`, so an axis tick and the same price in the book or the form are one string produced
 * by one function. The old sub-1 branch carried its own decimal rule (leading zeros + 2) and lost
 * to it: on a 0.0295 pair every tick rounded to "0.030" and the axis read as a column of one
 * repeated number.
 */
export function formatAxisLabel(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '0';

  const absN = Math.abs(n);

  if (absN >= 1_000_000) return formatCompact(n);
  if (absN >= 10_000) return Math.round(n).toLocaleString('en-US');
  if (absN >= 100) return round(n, 1).toLocaleString('en-US');
  if (absN >= 10) return round(n, 2).toString();
  if (absN >= 1) return round(n, 3).toString();
  if (absN > 0) return formatPrice(n);

  return '0';
}

// ─────────────────────────────────────────────────────────────
// Percentages
// ─────────────────────────────────────────────────────────────

/** Format percentage value */
export function formatPercent(n: number | null | undefined, decimals = 2, signed = false): string {
  if (n == null || !isFinite(n)) return '0.00%';
  const sign = n > 0 && signed ? '+' : '';
  // Handle multipliers (>200% shown as Nx)
  if (Math.abs(n) >= 200) return `${sign}${round(n / 100, 1)}x`;
  const d = Math.max(2, decimals);
  return `${sign}${round(n, d).toFixed(d)}%`;
}

/**
 * Percent with `sig` significant figures — small values keep precision (0.024%, 0.06%) instead of
 * collapsing to "0%". Input is already in percent units (2.4 → "2.4%"). Use for spreads / tiny rates.
 *
 * `sig` caps DECIMALS, so above 10^sig every integer digit survives (2222 stays "2222%"). That is
 * right for a spread, where the integer part is the measurement; for a yield it is not, which is
 * what `formatYield` is for.
 */
export function formatPercentSig(n: number | null | undefined, sig = 2, signed = false): string {
  if (n == null || !isFinite(n) || n === 0) return '0.00%';
  const abs = Math.abs(n);
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  // Fold a leading-zero run of three or more into the subscript form (0.0000002% ->
  // 0.0₆2%), exactly what formatPrice does for sub-1 prices: ten literal zeros are the
  // unreadable part, not the digits after them.
  const s = subscriptZeros(trimZeros(abs, decimals));
  return `${n < 0 ? '-' : signed ? '+' : ''}${s}%`;
}

/**
 * The ONE yield formatter: APR, APY, fee APR, strategy APR, protocol APR. Input in PERCENT units
 * (17.456 → "17.5%").
 *
 * Three significant figures at or above 1%, two below it: 2222 → "2220%", 17.456 → "17.5%",
 * 0.0987 → "0.099%". A yield is an estimate off a finite fee sample, and printing 2222% asserts
 * four digits of accuracy that no such sample has, while a flat 3sf would round a 0.0987% rate to
 * "0.0987%" and spend all its digits on leading zeros. The step down at 1% is where the number
 * stops being read as "a rate" and starts being read as "nearly nothing".
 *
 * `toPrecision` then `Number` rather than `formatPercentSig`: the latter caps decimals, which does
 * nothing to the integer digits that are the whole problem at 2222%.
 */
export function formatYield(n: number | null | undefined, signed = false): string {
  if (n == null || !isFinite(n)) return '—';
  if (n === 0) return '0%';
  const sig = Math.abs(n) >= 1 ? 3 : 2;
  // Round to sig figs FIRST, then let formatPercentSig trim the decimals off the rounded value.
  // Its decimal rule is already exactly right once the integer digits are no longer the problem.
  return formatPercentSig(Number(n.toPrecision(sig)), sig, signed);
}

// ─────────────────────────────────────────────────────────────
// Duration / Time
// ─────────────────────────────────────────────────────────────

/** Format milliseconds to human-readable duration */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0ms';

  const s = ms / 1000;
  if (s < 1) return `${Math.round(ms)}ms`;
  if (s < 60) return `${round(s, 2)}s`;
  if (s < 3600) return `${round(s / 60, 2)}m`;
  if (s < 86400) return `${round(s / 3600, 2)}h`;
  if (s < 31536000) return `${round(s / 86400, 2)}d`;
  return `${round(s / 31536000, 2)}y`;
}

/** Format bytes to human-readable size */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${round(bytes / Math.pow(1024, i), 2)} ${units[i]}`;
}

// ─────────────────────────────────────────────────────────────
// Text
// ─────────────────────────────────────────────────────────────

/** Shorten address/hash with ellipsis */
export function shortenAddress(address: string, start = 4, end = 4, sep = '...'): string {
  if (address.length <= start + end + 2) return address;
  return `${address.slice(0, 2 + start)}${sep}${address.slice(-end)}`;
}

/** Convert string to URL-friendly slug */
export function slugify(s: string, sep = '-'): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.\s-]/g, '')  // Keep dots for section numbers (1.1.1)
    .replace(/\.\s+/g, sep)          // "1.1.1. Something" -> "1.1.1-something"
    .replace(/[\s_]+/g, sep)
    .replace(new RegExp(`${sep}+`, 'g'), sep);
}

/** Slugify a doc file, handling category prefix for generic names like Overview */
export function slugifyDoc(filename: string, categoryPrefix?: string): string {
  const slug = slugify(filename);
  // Prefix generic names with category number to avoid collisions
  if (slug === 'overview' && categoryPrefix) {
    const match = categoryPrefix.match(/^(\d+)\./);
    if (match) return `${match[1]}-overview`;
  }
  return slug;
}

/** Convert slug back to readable string */
export function unslug(s: string, sep = '-'): string {
  return s
    .split(sep)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Capitalize first letter of each word */
export function capitalize(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate anchor ID from heading text.
 * Only strips the trailing ". " from section numbers (e.g., "7.1. Title" -> "7.1-title").
 *
 * @example
 * generateAnchorId("2.2. Spending Authorities") // "2.2-spending-authorities"
 * generateAnchorId("7.1. Cross-Chain Voting") // "7.1-cross-chain-voting"
 */
export function generateAnchorId(text: string): string {
  return text
    .toLowerCase()
    .replace(/^([\d.]+)\.\s+/, '$1-')  // Leading "X.Y. " -> "X.Y-" (only trailing dot of section number)
    .replace(/[^a-z0-9\s.-]/g, '')    // Remove special chars (keep dots, numbers, letters, spaces, dashes)
    .replace(/\s+/g, '-')              // Spaces to dashes
    .replace(/-+/g, '-')               // Collapse multiple dashes
    .replace(/^-|-$/g, '');            // Trim leading/trailing dashes
}

// ─────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────

/** Parse formatted number string back to number */
export function parseFormattedNumber(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]+/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ─────────────────────────────────────────────────────────────
// Date/Time Formatting
// ─────────────────────────────────────────────────────────────

export const TIME_FORMATS = {
  TIME_24H: { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' },
  TIME_12H: { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' },
  DATE_LONG: { weekday: 'long', month: 'long', day: 'numeric' },
} as const;

/** Format timestamp as localized time */
export function formatTime(timestamp: number, format = TIME_FORMATS.TIME_24H): string {
  return new Date(timestamp).toLocaleTimeString('en-US', format);
}

/** Format timestamp as day header (TODAY/YESTERDAY/full date) */
export function formatDayHeader(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  today.setHours(0, 0, 0, 0);
  yesterday.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) return 'TODAY';
  if (date.getTime() === yesterday.getTime()) return 'YESTERDAY';

  return date.toLocaleDateString('en-US', TIME_FORMATS.DATE_LONG).toUpperCase();
}

/** Format timestamp as UTC date/time for chart vertical lines */
export function formatVerticalLineTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

/** Format timestamp as relative time ("5m ago", "2h ago") */
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
