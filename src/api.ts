/** Lean SDK: canonical `api.btr.markets`. All BTR data via `api.btr.markets/v1/*` (single subdomain, versioned). Override with `setApiRoot()`. */
export const BTR_API: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BTR_API) ||
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API) ||
  (typeof process !== "undefined" && (process.env as Record<string, string>).BTR_API_URL) ||
  "https://api.btr.markets";

// Pre-0.9 `BTR_API` (with `/v1`) is not read; fail loud rather than silently hit prod.
if (typeof process !== "undefined" && process.env?.BTR_API && !process.env.BTR_API_URL)
  throw new Error("BTR_API is no longer read: set BTR_API_URL (root, without /v1)");

let _api = BTR_API;
export function setApiRoot(url: string) {
  _api = url.replace(/\/$/, "");
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
    throw new Error("chainId must be a positive integer");
  return `${path}${path.includes("?") ? "&" : "?"}chainId=${chainId}`;
}

export type Query = Record<string, string | number | boolean | undefined | null>;
/** Options of the one API request path (`btrFetch` and everything built on it). */
export interface ApiOpts extends Omit<RequestInit, "body" | "signal"> {
  /** Querystring; unset values are skipped. */
  query?: Query;
  /** JSON body, with its `Content-Type`; the method defaults to POST. */
  body?: unknown;
  /** Injected fetch (tests, proxies); default global fetch. */
  fetch?: typeof fetch;
  /** API root override for path-based calls; default `getApiRoot()`. */
  base?: string;
  /** Default 15 s; bounds the body read too. */
  timeoutMs?: number;
  /** Caller cancellation, merged with the timeout. */
  signal?: AbortSignal;
  /** Share the endpoint family's 429 cooldown: throw while cooling, arm it on a 429. */
  guard429?: boolean;
}

function qs(path: string, q: Query = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

// One 429 cooldown per endpoint FAMILY: a hot endpoint stops its own family's pollers without
// silencing the others (a metrics 429 must never delay a swap quote, nor the reverse). Matched on
// the PATHNAME only, anchored; a same-origin `/api` mount is an optional prefix.
const cooldowns = new Map<string, number>();
const P = "^(?:/api)?";
const FAMILIES: [RegExp, string][] = [
  [new RegExp(`${P}/(v1/)?(quote|lp-rows|indicators)(/|$)`), "quote"],
  [new RegExp(`${P}/v1/(summary|timeseries)(/|$)`), "metrics"],
  [new RegExp(`${P}(/v1)?/md(/|$)`), "market"],
  [new RegExp(`${P}/v1/depth(/|$)`), "depth"],
  [new RegExp(`${P}/v1/pools/[^/]+/density$`), "density"],
];
/** The cooldown family of a request path or URL; an unlisted path is its own family. */
export function familyOf(path: string): string {
  let p = path;
  try {
    p = new URL(path, "https://btr.markets").pathname;
  } catch {
    /* keep the raw string */
  }
  return FAMILIES.find(([re]) => re.test(p))?.[1] ?? p;
}
const until = (family?: string): number =>
  family === undefined ? Math.max(0, ...cooldowns.values()) : (cooldowns.get(family) ?? 0);
/** `family` cooling now; with no family, ANY family cooling. */
export const http429Cooldown = (family?: string): boolean => Date.now() < until(family);
/** Milliseconds of cooldown left (0 when none). */
export const http429RemainingMs = (family?: string): number =>
  Math.max(0, until(family) - Date.now());
/** Longest cooldown a `Retry-After` can ask for: a misbehaving edge must not silence a family for minutes. */
export const RETRY_AFTER_CAP_MS = 60_000;
/** `Retry-After` (delta seconds or an HTTP date) as capped milliseconds; undefined when absent or unusable. */
export function retryAfterMs(h: string | null | undefined, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_AFTER_CAP_MS) : undefined;
}
/** TEST ONLY: forget every cooldown (test files share this module state). */
export const resetHttp429 = (): void => cooldowns.clear();
export function noteHttp429(family: string, ms = 20_000): void {
  cooldowns.set(family, Math.max(cooldowns.get(family) ?? 0, Date.now() + ms));
}
/** Arm a family's cooldown from an error another client threw (a 429 worded in its message). */
export function note429Error(e: unknown, family: string): void {
  if (e instanceof Error && /(^| )429[ :]|HTTP 429/.test(e.message)) noteHttp429(family);
}

/** A non-2xx reply, carrying the status so callers can tell a dead session from a broken server. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The reply's `Retry-After` as capped ms (any status); undefined when absent or unusable. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 404/501: the gateway does not serve that resource yet, which reads as empty, not as an error. */
export const notServed = (e: unknown): boolean =>
  e instanceof HttpError && (e.status === 404 || e.status === 501);

/** Throws `429` while the cooldown runs: a guarded call never reaches the edge. */
export function guard429(path: string): void {
  if (http429Cooldown(familyOf(path)))
    throw new HttpError(429, `backend-error 429 ${path}: cooling down`);
}

/** JSON body of `res`, or an `HttpError` (server `error` text when it sent one). */
export async function parseJson<T>(res: Response, url = res.url): Promise<T> {
  // A body that stalled past the timeout (or was aborted) is a timeout, not an empty answer.
  const data = (await res.json().catch((e: unknown) => {
    const n = (e as { name?: unknown } | null)?.name;
    if (n === "TimeoutError" || n === "AbortError") throw e;
    return {};
  })) as T & { error?: unknown };
  if (!res.ok) {
    const path = (res.url || url).split("?")[0];
    throw new HttpError(
      res.status,
      typeof data?.error === "string" && data.error
        ? data.error
        : `backend-error ${res.status} ${path}`,
      retryAfterMs(res.headers.get("Retry-After")),
    );
  }
  return data;
}

/** The ONE HTTP path: `url` as given (query appended), raw `Response`. Never retries (POSTs are not idempotent). */
export async function btrFetch(url: string, o: ApiOpts = {}): Promise<Response> {
  const {
    query,
    body,
    fetch: f,
    base: _b,
    timeoutMs = 15_000,
    signal,
    guard429: budget,
    headers,
    ...init
  } = o;
  const full = qs(url, query);
  if (budget) guard429(full.split("?")[0]);
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");
  // Caller signal and timeout both always apply (no `AbortSignal.any`: missing on older engines).
  // The timeout listener stays after the headers on purpose: it still bounds the body read.
  const ctrl = new AbortController();
  const timeout = AbortSignal.timeout(timeoutMs);
  const onTimeout = (): void => ctrl.abort(timeout.reason);
  const onCaller = (): void => ctrl.abort(signal?.reason);
  timeout.addEventListener("abort", onTimeout, { once: true });
  if (signal?.aborted) onCaller();
  else signal?.addEventListener("abort", onCaller, { once: true });
  let res: Response;
  try {
    res = await (f ?? fetch)(full, {
      method: body === undefined ? "GET" : "POST",
      ...init,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    timeout.removeEventListener("abort", onTimeout);
    throw e;
  } finally {
    signal?.removeEventListener("abort", onCaller);
  }
  if (budget && res.status === 429)
    noteHttp429(familyOf(full), retryAfterMs(res.headers.get("Retry-After")));
  return res;
}

/** `btrFetch` -> JSON. Throws `HttpError` on non-2xx and on timeout. */
export const fetchJson = async <T = unknown>(url: string, o?: ApiOpts): Promise<T> =>
  parseJson<T>(await btrFetch(url, o), url);

/** A response that keeps the status and headers instead of collapsing to an `Error`. */
export interface RawResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  retryAfterSecs: number | undefined;
  body: string;
}

/** `path` under the API root, raw: the caller decides what a non-2xx means. */
export async function btrFetchRaw(path: string, o: ApiOpts = {}): Promise<RawResponse> {
  const res = await btrFetch(`${o.base ?? getApiRoot()}${path}`, o);
  const body = await res.text();
  const ra = res.headers.get("retry-after");
  const n = ra === null ? Number.NaN : Number(ra);
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    retryAfterSecs: Number.isFinite(n) ? n : undefined,
    body,
  };
}

/** `GET` (or `POST` with `body`) `path` under the API root, typed JSON; `HttpError` on non-2xx. */
export const btrJson = <T = unknown>(path: string, o: ApiOpts = {}): Promise<T> =>
  fetchJson<T>(`${o.base ?? getApiRoot()}${path}`, o);

/** `btrJson` on `path` for `chainId`: every chain-scoped read. */
export const btrApi = <T = unknown>(path: string, chainId: number, o: ApiOpts = {}): Promise<T> =>
  btrJson<T>(withChainId(qs(path, o.query), chainId), { ...o, query: undefined });
