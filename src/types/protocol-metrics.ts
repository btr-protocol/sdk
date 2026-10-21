/** Shared collector ↔ SDK ↔ front protocol-metrics contract. */

export const METRICS_WINDOWS = ['1h', '6h', '12h', '24h', '48h', '7d', '30d'] as const;
export type MetricsWindow = (typeof METRICS_WINDOWS)[number];
export const METRICS_WINDOW_MS: Readonly<Record<MetricsWindow, number>> = {
  '1h': 3600_000,
  '6h': 6 * 3600_000,
  '12h': 12 * 3600_000,
  '24h': 24 * 3600_000,
  '48h': 48 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
export const DEFAULT_METRICS_WINDOW: MetricsWindow = '48h';
export type MetricsGrain = '1m' | '2m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type MetricsSource = 'live' | 'empty';

/**
 * Grain per window, shared by the collector and the front so a bucket means one thing.
 * Every table underneath is minute-floored ⇒ 1m is the floor (60 buckets is the practical
 * minimum for a 1h view). Everything else lands near ~200 buckets per full view: points
 * are latency AND cache lifetime: a coarse bucket can be served from the edge cache far
 * longer than a fresh one. A finer view is a zoom away: narrow `from..to` and the span
 * picks the finer grain itself.
 */
export const METRICS_WINDOW_GRAIN: Readonly<Record<MetricsWindow, MetricsGrain>> = {
  '1h': '1m', // 60 pts: table floor, cannot go finer
  '6h': '2m', // 180
  '12h': '5m', // 144
  '24h': '5m', // 288
  '48h': '15m', // 192
  '7d': '30m', // 336
  '30d': '4h', // 180
};

/** Grain for a free-form from..to span. Requires METRICS_WINDOWS to stay ascending. */
export function grainForSpan(spanMs: number): MetricsGrain {
  for (const w of METRICS_WINDOWS)
    if (spanMs <= METRICS_WINDOW_MS[w]) return METRICS_WINDOW_GRAIN[w];
  return '1d';
}

export type ProtocolTimeseriesMetric =
  | 'vol.usd'
  | 'vol.usd.asset'
  | 'swap.count'
  | 'swap.traders'
  | 'fee.lp.usd'
  | 'fee.proto.usd'
  | 'fee.total.usd'
  | 'fee.toll.usd'
  | 'apr.fee'
  | 'apr.strategy'
  | 'hook.yield.usd'
  | 'tvl.usd'
  | 'depth.usd'
  | 'reserves.usd'
  | 'debt.usd'
  | 'cov.c'
  | 'skew.bps'
  | 'util.liq'
  | 'inv.ratio'
  | 'oracle.age'
  | 'mm.fee.paid'
  | 'mm.spread.avg'
  | 'mm.spread.quoted'
  | 'holders.active'
  | 'holders.lp.usd'
  | ProtocolLiquidityMetric;

/** LP flow taxonomy (dex_liquidity_1m). Also served as timeseries; the paged bucket
 *  listing stays on GET /v1/liquidity. */
export type ProtocolLiquidityMetric = 'liq.dep.usd' | 'liq.wd.usd' | 'liq.net.usd' | 'liq.events';

/**
 * Server-computed yield at every scope (protocol, pool, asset). Display only: nothing here is
 * summed, diluted or compounded client-side. `null` = unknown, never 0; a measured 0 is 0.
 */
export interface YieldRates {
  /** Swap-fee APR, simple, annualized over the trailing window. */
  feeApr: number | null;
  /** Hook APR, already diluted by the invested share. null = unhooked OR hooked and still measuring. */
  strategyApr: number | null;
  /** Coverage-toll APR. MEMO: restores coverage, not in `apr`. */
  tollApr: number | null;
  /** `feeApr + strategyApr`; null when a hooked leg's hook part is unmeasured, even if `feeApr` exists. */
  apr: number | null;
  /**
   * Compounded `apr` over the effective window. null when `apr` is above 100% (compounding is
   * meaningless) or the window is under 24h, even though `apr` is set: read `apr` then.
   */
  apy: number | null;
  /** Average LP-claim USD base the rates are over: the weight when blending rates. */
  liabilitiesUsd: number | null;
  /** Any leg under this scope is hooked. false ⇒ "No hook" whatever `strategyApr` reads. */
  hooked: boolean;
}

/** Minimum shape required to display yield without fabricating totals. */
export interface AprLegs extends YieldRates {
  stale: boolean;
}

/** Asset-scope yield extras. */
export interface AssetYield {
  /** The hook's non-diluted venue supply rate; null if unhooked or unmeasured. */
  venueApr: number | null;
  /** Window the fee rate covers; shorter than requested for a young pool. */
  windowMs: number | null;
  /** Span the hook rate was measured over; can be far shorter than `windowMs` after a rollout. */
  hookWindowMs: number | null;
  /** Realized hook yield in USD over the window (interval-start marks, gross of venue). 0 for an
   *  unhooked leg, null when a hooked leg has no usable interval. Absent on an older back. */
  hookYieldUsd?: number | null;
  /** Some interval was skipped (gap, no mark): `hookYieldUsd` understates. */
  hookYieldPartial?: boolean;
}

/** A yield-hook leg's on-chain buffer curve. Amounts in token units, rates in bps. */
export interface HookCurve {
  /** Reserves at or below which the whole leg stays liquid (target 100%). */
  tMin: number;
  /** Reserves where the liquid-share target equals `l0Bps`. */
  t0: number;
  l0Bps: number;
  lMinBps: number;
  /** Band half-width: invest while liquid > L(1+w), pull while liquid < L(1-w). */
  wBps: number;
  /** Invested-book cap; null when uncapped. */
  maxInvested: number | null;
}

export interface AssetProtocolMetrics extends AprLegs, AssetYield {
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
  /** Coverage toll, LP revenue outside `lpFeesUsd`. Absent from a back that predates it. */
  tollUsd?: number | null;
  oracleAgeSec: number | null;
  /** Hook buffer curve; null when unhooked or unread. Absent from a back that predates it. */
  hookCurve?: HookCurve | null;
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
  /** Coverage toll, LP revenue outside `lpFeesUsd`. Absent from a back that predates it. */
  tollUsd?: number | null;
  /**
   * `lpFeesUsd + protoFeesUsd`: the gross swap fee. `revenueUsd` is the protocol share of it, and
   * `protocolSharePct = revenueUsd / feesUsd`. Optional so a back that predates the split still
   * type-checks; the front derives both from lp/proto when absent.
   */
  feesUsd?: number | null;
  revenueUsd?: number | null;
  protocolSharePct?: number | null;
  assets: AssetProtocolMetrics[];
}

export interface ProtocolKpis extends YieldRates {
  tvlUsd: number | null;
  volumeUsd: number | null;
  swapCount: number | null;
  lpFeesUsd: number | null;
  protoFeesUsd: number | null;
  /** Coverage toll, LP revenue outside `lpFeesUsd`. Absent from a back that predates it. */
  tollUsd?: number | null;
  /** See `PoolProtocolMetrics.feesUsd`. Absent from a back that predates the split. */
  feesUsd?: number | null;
  revenueUsd?: number | null;
  protocolSharePct?: number | null;
  coverageAvg: number | null;
  utilization: number | null;
  investedRatio: number | null;
}

export interface ProtocolMetricsSummary {
  chainId: number;
  /** The preset label of `windowMs`; null for a free-form window. */
  window: MetricsWindow | null;
  /** The window every rate and flow in this response covers (default 7d, same as `/pools/metrics`). */
  windowMs: number;
  asOf: number;
  source: MetricsSource;
  stale: boolean;
  protocol: ProtocolKpis;
  pools: PoolProtocolMetrics[];
  /** The same figures over the equal window that ended one window ago (`asOf` = its end), for
   *  deltas. Null when the store could not answer it. No `hookCurve`, no `oracleAgeSec`. */
  previous?: {
    windowMs: number;
    asOf: number;
    source: MetricsSource;
    protocol: ProtocolKpis;
    pools: PoolProtocolMetrics[];
  } | null;
}

export interface TimeseriesPoint {
  t: number;
  v: number | null;
  /** `hook.yield.usd` only: a hooked leg in the bucket had a skipped or unmeasured interval, so
   *  `v` understates (or is a gap). Never a 0. */
  partial?: boolean;
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

/** GET /v1/liquidity: LP deposit/withdraw flow, newest first.
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

/** `Asset.flags`, decoded by the back one name per bit. */
interface LegFlags {
  raw: number;
  /** `HALT_BIT`: raised by the guardian, the owner or the pool's seat. */
  halted: boolean;
  haltAnchor: boolean;
  swaps: boolean;
  liabilitySwaps: boolean;
  flash: boolean;
  exotic: boolean;
  depositGated: boolean;
}

/** One leg's live risk parameters, in display units (bps, whole tokens). Null = not read. */
export interface LegRiskParams {
  token: string;
  curve: {
    id: number;
    preset: string | null;
    segments: number | null;
    dispRefBps: number | null;
    wall: boolean | null;
  };
  minFeeBps: number;
  minDispBps: number;
  vegaBps: number;
  kappaBps: number;
  /** Keeper push trigger from the density fit; null without a fit row. */
  fitThetaBps: number | null;
  /** Whole base tokens; null = uncapped. */
  depositCap: number | null;
  /** 0 = off. */
  maxLiabWeightBps: number;
  minLiquidity: number;
  flags: LegFlags;
  oracle: {
    /** The leg's feed off the deployment record (a MITCH id padded to 32 bytes); null when the record names none. */
    feedId: string | null;
    refFeedId: string | null;
    primary: string | null;
    refPrimary: string | null;
    /** Global lane index the leg's mark is addressed by; null before layout v5. */
    lane: number | null;
    mode: 'external' | 'internal';
    quoteUnit: 'anchor' | 'unitOfAccount';
    /** Band vs the lane's R tier, bits 0..11 of `Asset.refBandBps`; 0 = disarmed. */
    refBandBps: number;
    /** Bits 12..15: peg test at `depegCode·250` bps vs 1.0; 0 = off. */
    depegCode: number;
    gate: 'ok' | 'paused' | 'stale' | 'dead' | 'uncertain' | 'unreadable';
    /** Ref feed state; null when refBandBps = 0. */
    refGate: 'ok' | 'paused' | 'stale' | 'dead' | 'uncertain' | 'unreadable' | null;
    halted: boolean | null;
    ttlSecs: number | null;
    maxDevBps: number | null;
    sigmaFloorBps: number | null;
  } | null;
  hook: {
    target: string;
    preOutflow: boolean;
    /** `YieldHookLib.Curve`: target liquid share L(R), band L·(1±w); tMin, t0, maxInvested in token base units. */
    curve: {
      tMin: string;
      t0: string;
      l0Bps: number;
      lMinBps: number;
      wBps: number;
      maxInvested: string;
    } | null;
    /** Seconds the booked yield may age before a keeper `sync`; risk-steward set, on chain. */
    maxCacheAge: number | null;
    /** Unix seconds of the last `sync`. */
    lastSync: number | null;
    /** Where the hook supplies to; `supplyApr` is a decimal ratio read off the venue. */
    venue: {
      kind: 'aaveV3' | 'erc4626';
      name: string;
      market: string;
      position: string;
      supplyApr: number | null;
    } | null;
    /** The leg's book in token units: `liquid` = reserves - invested. `idle` says why nothing is invested. */
    book: {
      reserves: number;
      invested: number;
      liquid: number;
      /** Shares of `reserves`; null when it is 0. */
      investedRatio: number | null;
      liquidRatio: number | null;
      /** Venue NAV of the position. */
      nav: number | null;
      /** Reserves under this invest nothing: the curve holds the leg fully liquid. */
      tMin: number | null;
      /** Invested-book cap; null when uncapped or unread (see `uncapped`). */
      maxInvested: number | null;
      /** null = the curve did not read. */
      uncapped: boolean | null;
      idle: 'belowTMin' | 'capZero' | null;
    } | null;
    /** Merkl rewards accrued to the hook; `null` = Merkl did not answer, `[]` = none. */
    rewards: HookReward[] | null;
  } | null;
}

export interface HookReward {
  token: string;
  symbol: string | null;
  decimals: number;
  /** Not yet claimed, in token units; `claimable` is what a claim can take now, `pending` is still in Merkl's dispute period. */
  unclaimed: number;
  claimable: number;
  pending: number;
}

/** GET /v1/pools/{tag}/params: one pool read at one block. */
export interface PoolRiskParams {
  chainId: number;
  block: number;
  asOf: number;
  pool: {
    tag: string;
    address: string;
    base: string | null;
    legs: number;
    /** Legs whose getAsset read back; the rest did not decode. */
    listed: number;
    protoSharePct: number | null;
    flashFeeBps: number | null;
    flowCooldownSecs: number | null;
    solvencyArmed: boolean | null;
    lastGoodC: number | null;
    /** Whole base tokens when every leg shares one cap (`depositCapUniform`); null = uncapped. */
    depositCap: number | null;
    depositCapUniform: boolean;
    /** Null = legs differ; 0 = off. */
    maxLiabWeightBps: number | null;
    halted: number;
    swapsOff: number;
    flashOn: number;
    depositGated: number;
    feedGated: number;
  };
  /** Null = the leg's getAsset did not read. */
  legs: Record<string, LegRiskParams | null>;
}
