/** Lean SDK: canonical `api.btr.markets`. All BTR data via `api.btr.markets/v1/*` (single subdomain, versioned). Override with `setApiRoot()`. */
export const BTR_API: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BTR_API) ||
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API) ||
  (typeof process !== 'undefined' && (process.env as Record<string, string>).BTR_API_URL) ||
  'https://api.btr.markets';

// Pre-0.9 `BTR_API` (with `/v1`) is not read; fail loud rather than silently hit prod.
if (typeof process !== 'undefined' && process.env?.BTR_API && !process.env.BTR_API_URL)
  throw new Error('BTR_API is no longer read: set BTR_API_URL (root, without /v1)');

let _api = BTR_API;
export function setApiRoot(url: string) {
  _api = url.replace(/\/$/, '');
}
export function getApiRoot() {
  return _api;
}

/**
 * `path` with `chainId=<id>` appended: the one back deployment serves every chain and routes on it.
 * The chain is required: the SDK never picks one, and an absent param would get the back's default.
 */
export function withChainId(path: string, chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error('chainId must be a positive integer');
  return `${path}${path.includes('?') ? '&' : '?'}chainId=${chainId}`;
}

export type Query = Record<string, string | number | boolean | undefined | null>;
/** Options of the one API request path (`btrFetchRaw` and everything built on it). */
export interface ApiOpts {
  /** Querystring; unset values are skipped. */
  query?: Query;
  /** JSON body: sent as POST. */
  body?: unknown;
  /** Injected fetch (tests, proxies); default global fetch. */
  fetch?: typeof fetch;
  /** API root override; default `getApiRoot()`. */
  base?: string;
  /** Default 15 s. */
  timeoutMs?: number;
  /** Caller cancellation, merged with the timeout. */
  signal?: AbortSignal;
}

function qs(path: string, q: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

/** A response that keeps the status and headers instead of collapsing to an `Error`. */
export interface RawResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  retryAfterSecs: number | undefined;
  body: string;
}

/** The one HTTP path to the API: the caller decides what a non-2xx means. */
export async function btrFetchRaw(path: string, o: ApiOpts = {}): Promise<RawResponse> {
  const post = o.body !== undefined;
  const timeout = AbortSignal.timeout(o.timeoutMs ?? 15_000);
  const res = await (o.fetch ?? fetch)(`${o.base ?? getApiRoot()}${qs(path, o.query)}`, {
    method: post ? 'POST' : 'GET',
    headers: post ? { 'content-type': 'application/json' } : undefined,
    body: post ? JSON.stringify(o.body) : undefined,
    signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
  });
  const body = await res.text();
  const ra = res.headers.get('retry-after');
  const n = ra === null ? Number.NaN : Number(ra);
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    retryAfterSecs: Number.isFinite(n) ? n : undefined,
    body,
  };
}

/** `GET` (or `POST` with `body`) `path`, typed JSON. Throws `BTR API <status> <path>` on non-2xx. */
export async function btrJson<T = unknown>(path: string, o: ApiOpts = {}): Promise<T> {
  const res = await btrFetchRaw(path, o);
  if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
  return JSON.parse(res.body) as T;
}

/** `btrJson` on `path` for `chainId`: every chain-scoped read. */
export const btrApi = <T = unknown>(path: string, chainId: number, o: ApiOpts = {}): Promise<T> =>
  btrJson<T>(withChainId(qs(path, o.query), chainId), { ...o, query: undefined });
