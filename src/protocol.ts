// Typed fetchers for every public `/v1/*` read the front makes. One generic (`btrApi`) does the
// request; each fetcher is a one-line path + type. Reads only: no keys, no signing, no sends.
import { type ApiOpts, btrApi, type Query } from "./api.js";
import type {
  PoolRiskParams,
  ProtocolLiquidityHistory,
  ProtocolMetricsSummary,
  ProtocolMetricsTimeseries,
} from "./types/protocol-metrics.js";

type Rec = Record<string, unknown>;
type Opt = Omit<ApiOpts, "query" | "body">;
const seg = encodeURIComponent;
// `R` narrows a wire typed `Rec` here to the shape the caller reads.
const get =
  <T>(path: string) =>
  <R = T>(chainId: number, query?: Query, o?: Opt) =>
    btrApi<R>(path, chainId, { ...o, query });
const post =
  <T, B = unknown>(path: string) =>
  <R = T>(chainId: number, body: B, o?: Opt) =>
    btrApi<R>(path, chainId, { ...o, body });

export const fetchSummary = (chainId: number, window: string, o?: Opt) =>
  btrApi<ProtocolMetricsSummary>("/v1/summary", chainId, { ...o, query: { window } });
export const fetchTimeseries = get<ProtocolMetricsTimeseries>("/v1/timeseries");
export const fetchTimeseriesBulk = post<Rec>("/v1/timeseries/bulk");
export const fetchLiquidity = get<ProtocolLiquidityHistory>("/v1/liquidity");
export const fetchActivity = get<Rec>("/v1/activity");
export const fetchPools = get<Rec>("/v1/pools");
export const fetchPoolMetrics = get<Rec>("/v1/pools/metrics");
export const fetchPoolParams = <R = PoolRiskParams>(chainId: number, tag: string, o?: Opt) =>
  btrApi<R>(`/v1/pools/${seg(tag)}/params`, chainId, o);
export const fetchDensity = <R = Rec>(chainId: number, pair: string, query?: Query, o?: Opt) =>
  btrApi<R>(`/v1/pools/${seg(pair)}/density`, chainId, { ...o, query });
export const fetchOraclePushes = get<Rec>("/v1/oracle/pushes");
export const fetchOraclePush = <R = Rec>(chainId: number, tx: string, query?: Query, o?: Opt) =>
  btrApi<R>(`/v1/oracle/pushes/${seg(tx)}`, chainId, { ...o, query });
export const fetchSafetyHistory = get<Rec>("/v1/safety/history");
export const fetchSafetyBreakers = get<Rec>("/v1/safety/breakers");
export const fetchHealth = get<Rec>("/v1/health");
/** Halt history scopes of `GET /v1/halts/{scope}`. */
export type HaltScope = "aggregate" | "pool" | "asset" | "leg" | "feed";
/**
 * `GET /v1/halts/{scope}` (query: from, to, grain, group, pool, asset, leg, feed, limit, before);
 * an unknown scope is a 404.
 */
export const fetchHalts = (chainId: number, scope: HaltScope, query?: Query, o?: Opt) =>
  btrApi<Rec>(`/v1/halts/${seg(scope)}`, chainId, { ...o, query });
export const fetchAssets = get<Rec>("/v1/assets");
export const fetchMdTickers = get<Rec>("/v1/md/tickers");
export const fetchMdPrice = (chainId: number, symbol: string, o?: Opt) =>
  btrApi<Rec>(`/v1/md/price/${seg(symbol)}`, chainId, o);
export const fetchMdOhlc = (chainId: number, symbol: string, query?: Query, o?: Opt) =>
  btrApi<Rec>(`/v1/md/ohlc/${seg(symbol)}`, chainId, { ...o, query });
export const fetchIndicators = post<Rec>("/v1/indicators");
/** `POST /v1/depth`: depth ladder over caller-supplied pool wires (`DepthRequestWire`). */
export const fetchDepth = post<Rec>("/v1/depth");
/** `POST /v1/quote`: single-pool quote; with an LP body it is the front's LP preview. */
export const fetchQuote = post<Rec>("/v1/quote");
/** `POST /v1/quote-path`: the conversion a debt-swap (liability) quote prices over. */
export const fetchQuotePath = post<Rec>("/v1/quote-path");

/** `POST /v1/lp-rows` body: the pool and its legs as the front sends them. */
export interface LpRowsRequest {
  addr: string;
  legs: Array<{
    symbol: string;
    address: string;
    reserves: number;
    liabilities: number;
    haircut_frac: number;
    fee_apr?: number;
    strategy_apr?: number;
    flags?: number;
    index_wad?: string;
    cap?: number;
  }>;
  exclude?: string;
  amount?: number;
  mode?: "coverage" | "apr";
  entry?: "mint" | "liability";
  src?: string;
  src_cap?: number;
  limit?: number;
  /** Pool coverage `C = R/L` as `0x` WAD; absent ⇒ server par fallback, rows flagged `c_degraded`. */
  pool_c_wad?: string;
}
export interface LpRow {
  symbol: string;
  coverage: number | null;
  cov_after: number | null;
  apr_after: number | null;
  haircut_frac: number;
  feasible: boolean;
  c_degraded: boolean;
}
export interface LpRowsResponse {
  exit_rows: LpRow[];
  lp_rows: LpRow[];
  /** First feasible debt-swap destination in LP rank order. */
  destination: string | null;
}
/** Ranked LP exit/entry rows + the debt-swap destination (server-composed). */
export const lpRows = post<LpRowsResponse, LpRowsRequest>("/v1/lp-rows");
