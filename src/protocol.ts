// Typed fetchers for every public `/v1/*` read the front makes. One generic (`btrApi`) does the
// request; each fetcher is a one-line path + type. Reads only: no keys, no signing, no sends.
import { getApiRoot, withChainId } from './api.js';
import type {
  PoolRiskParams,
  ProtocolLiquidityHistory,
  ProtocolMetricsSummary,
  ProtocolMetricsTimeseries,
} from './types/protocol-metrics.js';

export type Query = Record<string, string | number | boolean | undefined | null>;
export interface ApiOpts {
  /** Querystring; unset values are skipped. */
  query?: Query;
  /** JSON body: sent as POST. */
  body?: unknown;
  /** Injected fetch (tests, proxies); default global fetch. */
  fetch?: typeof fetch;
  /** API root override; default `getApiRoot()`. */
  base?: string;
  timeoutMs?: number;
}

function qs(q: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** `GET` (or `POST` with `body`) `path` on the API for `chainId`. Throws on non-2xx. */
export async function btrApi<T = unknown>(
  path: string,
  chainId: number,
  o: ApiOpts = {},
): Promise<T> {
  const post = o.body !== undefined;
  const res = await (o.fetch ?? fetch)(
    `${o.base ?? getApiRoot()}${withChainId(`${path}${qs(o.query)}`, chainId)}`,
    {
      method: post ? 'POST' : 'GET',
      headers: post ? { 'content-type': 'application/json' } : undefined,
      body: post ? JSON.stringify(o.body) : undefined,
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    },
  );
  if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
  return (await res.json()) as T;
}

type Rec = Record<string, unknown>;
type Opt = Omit<ApiOpts, 'query' | 'body'>;
const seg = encodeURIComponent;
const get =
  <T>(path: string) =>
  (chainId: number, query?: Query, o?: Opt) =>
    btrApi<T>(path, chainId, { ...o, query });
const post =
  <T, B = unknown>(path: string) =>
  (chainId: number, body: B, o?: Opt) =>
    btrApi<T>(path, chainId, { ...o, body });

export const fetchSummary = (chainId: number, window: string, o?: Opt) =>
  btrApi<ProtocolMetricsSummary>('/v1/summary', chainId, { ...o, query: { window } });
export const fetchTimeseries = get<ProtocolMetricsTimeseries>('/v1/timeseries');
export const fetchTimeseriesBulk = post<Rec>('/v1/timeseries/bulk');
export const fetchLiquidity = get<ProtocolLiquidityHistory>('/v1/liquidity');
export const fetchActivity = get<Rec>('/v1/activity');
export const fetchPools = get<Rec>('/v1/pools');
export const fetchPoolMetrics = get<Rec>('/v1/pools/metrics');
export const fetchPoolParams = (chainId: number, tag: string, o?: Opt) =>
  btrApi<PoolRiskParams>(`/v1/pools/${seg(tag)}/params`, chainId, o);
export const fetchDensity = (chainId: number, pair: string, query?: Query, o?: Opt) =>
  btrApi<Rec>(`/v1/pools/${seg(pair)}/density`, chainId, { ...o, query });
export const fetchOraclePushes = get<Rec>('/v1/oracle/pushes');
export const fetchOraclePush = (chainId: number, tx: string, query?: Query, o?: Opt) =>
  btrApi<Rec>(`/v1/oracle/pushes/${seg(tx)}`, chainId, { ...o, query });
export const fetchSafetyHistory = get<Rec>('/v1/safety/history');
export const fetchSafetyBreakers = get<Rec>('/v1/safety/breakers');
export const fetchHealth = get<Rec>('/v1/health');
export const fetchAssets = get<Rec>('/v1/assets');
export const fetchMdTickers = get<Rec>('/v1/md/tickers');
export const fetchMdPrice = (chainId: number, symbol: string, o?: Opt) =>
  btrApi<Rec>(`/v1/md/price/${seg(symbol)}`, chainId, o);
export const fetchMdOhlc = (chainId: number, symbol: string, query?: Query, o?: Opt) =>
  btrApi<Rec>(`/v1/md/ohlc/${seg(symbol)}`, chainId, { ...o, query });
export const fetchIndicators = post<Rec>('/v1/indicators');
/** `POST /v1/depth`: depth ladder over caller-supplied pool wires (`DepthRequestWire`). */
export const fetchDepth = post<Rec>('/v1/depth');
/** `POST /v1/quote`: single-pool quote; with an LP body it is the front's LP preview. */
export const fetchQuote = post<Rec>('/v1/quote');
/** `POST /v1/quote-path`: the conversion a debt-swap (liability) quote prices over. */
export const fetchQuotePath = post<Rec>('/v1/quote-path');

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
  mode?: 'coverage' | 'apr';
  entry?: 'mint' | 'liability';
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
export const lpRows = post<LpRowsResponse, LpRowsRequest>('/v1/lp-rows');
