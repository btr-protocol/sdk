// Typed read-only fetchers for the public GET surface of `api.btr.markets/v1`. Shapes follow
// `https://btr.markets/openapi.json`; the POST kernels (`chainQuote`, `chainRoute`, `depthAsync`)
// already live in `chain/` and `amm/`. Nothing here signs, holds a key or writes.

import { btrFetch, btrFetchRaw, withChainId } from '../api.js';

/** `GET /v1/chains`. `live` is absent on backs that predate it. */
export interface ChainEntry {
  chainId: number;
  default: boolean;
  live?: boolean;
}

/** One router pool on `GET /v1/pools`. */
export interface PoolSummary {
  tag: string;
  address: string;
  symbols: string[];
}

/** One earlier deployment generation on `GET /v1/venues` (`back` `registry::Superseded`). */
export interface SupersededWire {
  label: string;
  status: 'superseded' | 'halted' | 'retired';
  current: false;
  tokens_current: false;
  pools_current: false;
  contracts: Record<string, string>;
  libraries: Record<string, string>;
  tokens: Record<string, string>;
  pools: Record<string, unknown>;
}

/** One chain on `GET /v1/venues` (`back` `registry::Venue`). `all_contracts`, `libraries` and
 *  `superseded` are optional: a back older than the registry generation omits them. */
export interface VenueWire {
  chain_id: number;
  name: string | null;
  contracts: Record<string, string>;
  tokens: Record<string, string>;
  feeds: Record<string, string>;
  feed_meta: Record<string, unknown>;
  pools: Record<string, unknown>;
  seeds: Record<string, number>;
  ref_feeds: string[];
  curve_names?: Record<string, string>;
  all_contracts?: Record<string, string>;
  libraries?: Record<string, string>;
  superseded?: SupersededWire[];
}

/** `GET /v1/md/tickers` row. `ticker` is a u64: kept as a decimal string, never a lossy number. */
export interface MarkRow {
  ticker: string;
  mid: number;
  bid: number;
  ask: number;
  age_ms: number;
  /** Served as `fresh`/`stale`/`dead` (the OpenAPI enum still says `live`). `dead` keeps its
   *  last `mid`: never price off it. */
  status: 'fresh' | 'stale' | 'dead' | (string & {});
}

/** `GET /v1/md/price/{sym}`. */
export interface PriceWire {
  mid: number;
  bid: number;
  ask: number;
}

/** `GET /v1/md/ohlc/{sym}` bar; `ts` is the bar open, epoch ms. */
export interface OhlcBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OhlcQuery {
  /** Bar width in seconds (required by the API). */
  tf: number;
  from?: number;
  to?: number;
  limit?: number;
}

const scoped = (path: string, chainId?: number): string =>
  chainId === undefined ? path : withChainId(path, chainId);

/** Integers past 2^53 (u64 ticker ids) quoted before `JSON.parse` rounds them. Applied to the
 *  market-data bodies only: they carry no free-text strings for the pattern to misfire on. */
export function parseLosslessInts<T>(body: string): T {
  return JSON.parse(body.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')) as T;
}

async function getLossless<T>(path: string): Promise<T> {
  const res = await btrFetchRaw(path, { timeoutMs: 10_000 });
  if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
  return parseLosslessInts<T>(res.body);
}

/** `GET /v1/chains`: served chain ids with `default`/`live` flags. */
export const fetchChains = (): Promise<ChainEntry[]> => btrFetch<ChainEntry[]>('/v1/chains');

/** `GET /v1/venues`: the back's deployment registry keyed by chain id. */
export const fetchVenues = (): Promise<Record<string, VenueWire>> =>
  btrFetch<Record<string, VenueWire>>('/v1/venues');

/** `GET /v1/pools`: router pools and their symbol rosters. */
export const fetchPools = (chainId?: number): Promise<{ pools: PoolSummary[] }> =>
  btrFetch<{ pools: PoolSummary[] }>(scoped('/v1/pools', chainId));

/** `GET /v1/assets/pools`: deployed pools with spokes and LP receipts. */
export const fetchAssetPools = (chainId?: number): Promise<Record<string, unknown>> =>
  btrFetch<Record<string, unknown>>(scoped('/v1/assets/pools', chainId));

/** `GET /v1/md/tickers`: current mark per provider ticker. */
export const fetchMarks = (): Promise<MarkRow[]> => getLossless<MarkRow[]>('/v1/md/tickers');

/** `GET /v1/md/price/{sym}`: latest mark for one symbol (`BTC-USDC`). */
export const fetchPrice = (sym: string): Promise<PriceWire> =>
  btrFetch<PriceWire>(`/v1/md/price/${encodeURIComponent(sym)}`);

/** `GET /v1/md/ohlc/{sym}`: OHLC bars on the `tf`-second grid. */
export function fetchOhlc(sym: string, q: OhlcQuery): Promise<OhlcBar[]> {
  const p = new URLSearchParams({ tf: String(q.tf) });
  if (q.from !== undefined) p.set('from', String(q.from));
  if (q.to !== undefined) p.set('to', String(q.to));
  if (q.limit !== undefined) p.set('limit', String(q.limit));
  return btrFetch<OhlcBar[]>(`/v1/md/ohlc/${encodeURIComponent(sym)}?${p}`);
}
