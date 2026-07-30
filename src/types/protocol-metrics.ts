/** Shared collector ↔ SDK ↔ front protocol-metrics contract. */

export const METRICS_WINDOWS = ['24h', '7d', '30d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];
export const METRICS_WINDOW_MS: Readonly<Record<MetricsWindow, number>> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
export type MetricsGrain = '1m' | '5m' | '1h' | '1d';
export type MetricsSource = 'stub' | 'live' | 'empty';

export type ProtocolTimeseriesMetric =
  | 'vol.usd'
  | 'vol.usd.asset'
  | 'swap.count'
  | 'fee.lp.usd'
  | 'fee.proto.usd'
  | 'apr.fee'
  | 'apr.strategy'
  | 'tvl.usd'
  | 'cov.c'
  | 'skew.psi'
  | 'util.liq'
  | 'inv.ratio'
  | 'oracle.age'
  | 'mm.fee.paid'
  | 'mm.spread.avg';

export const PROTOCOL_TIMESERIES_METRICS = [
  'vol.usd',
  'vol.usd.asset',
  'swap.count',
  'fee.lp.usd',
  'fee.proto.usd',
  'apr.fee',
  'apr.strategy',
  'tvl.usd',
  'cov.c',
  'skew.psi',
  'util.liq',
  'inv.ratio',
  'oracle.age',
  'mm.fee.paid',
  'mm.spread.avg',
] as const satisfies readonly ProtocolTimeseriesMetric[];

/** LP flow taxonomy (dex_liquidity_1m). Deliberately NOT in
 *  ProtocolTimeseriesMetric: /metrics/timeseries has no SQL case for these, so
 *  listing them there would make the collector accept an id it cannot serve.
 *  Flow is served by GET /protocol/liquidity/history; these ids label it. */
export type ProtocolLiquidityMetric =
  | 'liq.dep.usd'
  | 'liq.wd.usd'
  | 'liq.net.usd'
  | 'liq.events';

export const PROTOCOL_LIQUIDITY_METRICS = [
  'liq.dep.usd',
  'liq.wd.usd',
  'liq.net.usd',
  'liq.events',
] as const satisfies readonly ProtocolLiquidityMetric[];

/** Minimum shape required to display APR legs without fabricating totals. */
export interface AprLegs {
  feeApr: number | null;
  strategyApr: number | null;
  unrealizedStrategyApr?: number | null;
  stale: boolean;
}

export interface ApyBreakdown {
  apy: number | null;
  swapFeeApr: number | null;
  rehypoApr: number | null;
  swapFeePct: number | null;
  rehypoPct: number | null;
  hookAddress: string | null;
  hooked: boolean;
}

export interface AssetProtocolMetrics extends AprLegs {
  symbol: string;
  token: string | null;
  strategyId: string;
  tvlUsd: number | null;
  volumeUsd: number | null;
  swapCount: number | null;
  coverage: number | null;
  skew: number | null;
  utilization: number | null;
  investedRatio: number | null;
  feeAvgBps: number | null;
  lpFeesUsd: number | null;
  protoFeesUsd: number | null;
  oracleAgeSec: number | null;
  apy: ApyBreakdown;
}

export interface PoolProtocolMetrics extends AprLegs {
  tag: string;
  address: string;
  label?: string;
  tvlUsd: number | null;
  volumeUsd: number | null;
  swapCount: number | null;
  coverageAvg: number | null;
  skew: number | null;
  utilization: number | null;
  investedRatio: number | null;
  lpFeesUsd: number | null;
  protoFeesUsd: number | null;
  assets: AssetProtocolMetrics[];
}

export interface ProtocolKpis {
  tvlUsd: number | null;
  volumeUsd: number | null;
  swapCount: number | null;
  lpFeesUsd: number | null;
  protoFeesUsd: number | null;
  coverageAvg: number | null;
  feeApr: number | null;
  strategyApr: number | null;
  utilization: number | null;
  investedRatio: number | null;
}

export interface ProtocolMetricsSummary {
  chainId: number;
  window: MetricsWindow;
  asOf: number;
  source: MetricsSource;
  stale: boolean;
  protocol: ProtocolKpis;
  pools: PoolProtocolMetrics[];
}

export interface TimeseriesPoint {
  t: number;
  v: number | null;
}

export interface ProtocolMetricsTimeseries {
  metric: ProtocolTimeseriesMetric;
  pool: string | null;
  asset: string | null;
  grain: MetricsGrain;
  from: number;
  to: number;
  source: MetricsSource;
  points: TimeseriesPoint[];
}

/** One minute-bucketed deposit/withdraw aggregate (from dex_liquidity_1m). */
export interface LiquidityFlowBucket {
  t: number;
  pool: string;
  poolTag: string;
  side: 'deposit' | 'withdraw';
  symbol: string | null;
  eventCount: number;
  amount: number | null;
  lpAmount: number | null;
  amountUsd: number | null;
}

/** GET /protocol/liquidity/history — LP deposit/withdraw flow, newest first.
 *  Aggregate (per-minute) not per-wallet: `dex_liquidity` keeps `sender` for tx-level
 *  drill-down, but a per-address feed is an unbuilt product decision, not a shape gap. */
export interface ProtocolLiquidityHistory {
  chainId: number;
  pool: string | null;
  asset: string | null;
  side: 'deposit' | 'withdraw' | null;
  from: number;
  to: number;
  source: MetricsSource;
  buckets: LiquidityFlowBucket[];
}
