/**
 * Canonical timeframe enum: single source of truth across ∀ BTR services.
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
  S10 = 10, // 10 seconds
  S20 = 20, // 20 seconds
  S30 = 30, // 30 seconds
  M1 = 60, // 1 minute
  M2 = 120, // 2 minutes
  M5 = 300, // 5 minutes
  M15 = 900, // 15 minutes
  M30 = 1800, // 30 minutes
  H1 = 3600, // 1 hour
  H2 = 7200, // 2 hours
  H4 = 14400, // 4 hours
  H8 = 28800, // 8 hours
  H12 = 43200, // 12 hours
  D1 = 86400, // 1 day
  D3 = 259200, // 3 days
}

/** Short human label for UI. e.g. `tfLabel(TimeFrame.M5)` → `'5m'`. */
export function tfLabel(tf: TimeFrame): string {
  return TF_LABELS[tf];
}

/** Map: TimeFrame → short UI label. */
const TF_LABELS: Readonly<Record<TimeFrame, string>> = Object.freeze({
  [TimeFrame.S10]: '10s',
  [TimeFrame.S20]: '20s',
  [TimeFrame.S30]: '30s',
  [TimeFrame.M1]: '1m',
  [TimeFrame.M2]: '2m',
  [TimeFrame.M5]: '5m',
  [TimeFrame.M15]: '15m',
  [TimeFrame.M30]: '30m',
  [TimeFrame.H1]: '1h',
  [TimeFrame.H2]: '2h',
  [TimeFrame.H4]: '4h',
  [TimeFrame.H8]: '8h',
  [TimeFrame.H12]: '12h',
  [TimeFrame.D1]: '1d',
  [TimeFrame.D3]: '3d',
});
