/**
 * Canonical timeframe enum — single source of truth across ∀ BTR services.
 *
 * Values = duration in seconds. Names follow pattern:
 *   - `Sn`  = n seconds   (S10, S20, S30)
 *   - `Mn`  = n minutes   (M1, M2, M5, M15, M30)
 *   - `Hn`  = n hours     (H1, H2, H4, H8, H12)
 *   - `Dn`  = n days      (D1, D3)
 *
 * Used by: collector (storage TFs, agg windows, MV rollups), front (chart picker,
 * candle queries), agents (backfill cadence), QuestDB MV refresh policy.
 *
 * @example
 * import { TimeFrame, tfLabel, tfFromSeconds, CCXT_TF_CODE } from '@btr-protocol/sdk';
 *
 * TimeFrame.M5            // 300
 * tfLabel(TimeFrame.M5)   // '5m'
 * CCXT_TF_CODE[TimeFrame.M1]  // '1m' (for exchange.fetchOHLCV)
 */
export enum TimeFrame {
  S10  = 10,     // 10 seconds
  S20  = 20,     // 20 seconds
  S30  = 30,     // 30 seconds
  M1   = 60,     // 1 minute
  M2   = 120,    // 2 minutes
  M5   = 300,    // 5 minutes
  M15  = 900,    // 15 minutes
  M30  = 1800,   // 30 minutes
  H1   = 3600,   // 1 hour
  H2   = 7200,   // 2 hours
  H4   = 14400,  // 4 hours
  H8   = 28800,  // 8 hours
  H12  = 43200,  // 12 hours
  D1   = 86400,  // 1 day
  D3   = 259200, // 3 days
}

/** All TimeFrame values in ascending order (seconds). Useful for storage cfg, MV creation, picker UI. */
export const ALL_TIMEFRAMES: readonly TimeFrame[] = Object.freeze([
  TimeFrame.S10, TimeFrame.S20, TimeFrame.S30,
  TimeFrame.M1,  TimeFrame.M2,  TimeFrame.M5,  TimeFrame.M15, TimeFrame.M30,
  TimeFrame.H1,  TimeFrame.H2,  TimeFrame.H4,  TimeFrame.H8,  TimeFrame.H12,
  TimeFrame.D1,  TimeFrame.D3,
]);

/** Default storage timeframes for collector OHLC MVs. Drops S10 ∵ tick-level granularity served via raw ticks. */
export const DEFAULT_STORED_TIMEFRAMES: readonly TimeFrame[] = Object.freeze([
  TimeFrame.S20, TimeFrame.M1,  TimeFrame.M2,  TimeFrame.M5,  TimeFrame.M15, TimeFrame.M30,
  TimeFrame.H1,  TimeFrame.H2,  TimeFrame.H4,  TimeFrame.H8,  TimeFrame.H12, TimeFrame.D1, TimeFrame.D3,
]);

/** Base aggregation window for tick → OHLC reconstruction. */
export const BASE_TIMEFRAME: TimeFrame = TimeFrame.S10;

/** Short human label for UI. e.g. `tfLabel(TimeFrame.M5)` → `'5m'`. */
export function tfLabel(tf: TimeFrame): string {
  return TF_LABELS[tf];
}

/** Longer human label. e.g. `tfLongLabel(TimeFrame.M5)` → `'5 minutes'`. */
export function tfLongLabel(tf: TimeFrame): string {
  return TF_LONG_LABELS[tf];
}

/** Inverse of TimeFrame enum: lookup TimeFrame by seconds. Throws if invalid. */
export function tfFromSeconds(seconds: number): TimeFrame {
  if (!(seconds in TF_LABELS)) throw new Error(`Unknown timeframe: ${seconds}s`);
  return seconds as TimeFrame;
}

/** Parse short label back to TimeFrame. e.g. `tfParse('5m')` → `TimeFrame.M5`. */
export function tfParse(label: string): TimeFrame | undefined {
  return TF_BY_LABEL[label.toLowerCase()];
}

/** Test if a value is a valid TimeFrame. */
export function isTimeFrame(v: unknown): v is TimeFrame {
  return typeof v === 'number' && v in TF_LABELS;
}

/** Map: TimeFrame → CCXT OHLCV interval string (for `exchange.fetchOHLCV(sym, tf, ...)`). */
export const CCXT_TF_CODE: Readonly<Record<TimeFrame, string>> = Object.freeze({
  [TimeFrame.S10]: '10s',
  [TimeFrame.S20]: '20s',
  [TimeFrame.S30]: '30s',
  [TimeFrame.M1]:  '1m',
  [TimeFrame.M2]:  '2m',
  [TimeFrame.M5]:  '5m',
  [TimeFrame.M15]: '15m',
  [TimeFrame.M30]: '30m',
  [TimeFrame.H1]:  '1h',
  [TimeFrame.H2]:  '2h',
  [TimeFrame.H4]:  '4h',
  [TimeFrame.H8]:  '8h',
  [TimeFrame.H12]: '12h',
  [TimeFrame.D1]:  '1d',
  [TimeFrame.D3]:  '3d',
});

/** Map: TimeFrame → short UI label. */
const TF_LABELS: Readonly<Record<TimeFrame, string>> = Object.freeze({
  [TimeFrame.S10]: '10s',
  [TimeFrame.S20]: '20s',
  [TimeFrame.S30]: '30s',
  [TimeFrame.M1]:  '1m',
  [TimeFrame.M2]:  '2m',
  [TimeFrame.M5]:  '5m',
  [TimeFrame.M15]: '15m',
  [TimeFrame.M30]: '30m',
  [TimeFrame.H1]:  '1h',
  [TimeFrame.H2]:  '2h',
  [TimeFrame.H4]:  '4h',
  [TimeFrame.H8]:  '8h',
  [TimeFrame.H12]: '12h',
  [TimeFrame.D1]:  '1d',
  [TimeFrame.D3]:  '3d',
});

/** Map: TimeFrame → verbose UI label. */
const TF_LONG_LABELS: Readonly<Record<TimeFrame, string>> = Object.freeze({
  [TimeFrame.S10]: '10 seconds',
  [TimeFrame.S20]: '20 seconds',
  [TimeFrame.S30]: '30 seconds',
  [TimeFrame.M1]:  '1 minute',
  [TimeFrame.M2]:  '2 minutes',
  [TimeFrame.M5]:  '5 minutes',
  [TimeFrame.M15]: '15 minutes',
  [TimeFrame.M30]: '30 minutes',
  [TimeFrame.H1]:  '1 hour',
  [TimeFrame.H2]:  '2 hours',
  [TimeFrame.H4]:  '4 hours',
  [TimeFrame.H8]:  '8 hours',
  [TimeFrame.H12]: '12 hours',
  [TimeFrame.D1]:  '1 day',
  [TimeFrame.D3]:  '3 days',
});

/** Reverse map: short label → TimeFrame (lowercased for tfParse). */
const TF_BY_LABEL: Readonly<Record<string, TimeFrame>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(TF_LABELS) as [string, string][]).map(([sec, lbl]) => [lbl.toLowerCase(), Number(sec) as TimeFrame]),
  ),
);
