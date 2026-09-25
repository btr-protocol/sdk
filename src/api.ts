/** Lean SDK: canonical `api.btr.markets`. All BTR data via `api.btr.markets/v1/*` (single subdomain, versioned). Override with `setApiRoot()`. */
export const BTR_API: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BTR_API) ||
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API) ||
  (typeof process !== 'undefined' && (process.env as Record<string, string>).BTR_API_URL) ||
  'https://api.btr.markets';

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
  return `${path}${path.includes('?') ? '&' : '?'}chainId=${chainId}`;
}

/** A response that keeps the status and `Retry-After` instead of collapsing to an `Error`. */
interface RawResponse {
  ok: boolean;
  status: number;
  retryAfterSecs: number | undefined;
  body: string;
}

/**
 * Like `btrFetch`, but the caller decides what a non-2xx means. The chain client needs the status and
 * the countdown to build its typed union (`ChainError`), which the throwing helper threw away.
 */
export async function btrFetchRaw(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<RawResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 15_000);
  const caller = init?.signal;
  if (caller?.aborted) {
    clearTimeout(t);
    throw caller.reason instanceof Error ? caller.reason : new Error('aborted');
  }
  const onCallerAbort = (): void => ctrl.abort(caller?.reason);
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const res = await fetch(`${getApiRoot()}${path}`, { ...init, signal: ctrl.signal });
    const body = await res.text();
    const ra = res.headers.get('retry-after');
    const n = ra === null ? Number.NaN : Number(ra);
    return {
      ok: res.ok,
      status: res.status,
      retryAfterSecs: Number.isFinite(n) ? n : undefined,
      body,
    };
  } finally {
    caller?.removeEventListener('abort', onCallerAbort);
    clearTimeout(t);
  }
}

/** Generic fetch helper: 10s timeout, throws on non-2xx, typed JSON. */
export async function btrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await btrFetchRaw(path, { timeoutMs: 10_000, ...init });
  if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
  return JSON.parse(res.body) as T;
}
