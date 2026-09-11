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

/** Generic fetch helper: 10s timeout, typed */
export async function btrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  const caller = init?.signal;
  if (caller?.aborted) {
    clearTimeout(t);
    throw caller.reason instanceof Error ? caller.reason : new Error('aborted');
  }
  const onCallerAbort = (): void => ctrl.abort();
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  const signal =
    caller && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([ctrl.signal, caller])
      : ctrl.signal;
  try {
    const res = await fetch(`${getApiRoot()}${path}`, { ...init, signal });
    if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
    return (await res.json()) as T;
  } finally {
    caller?.removeEventListener('abort', onCallerAbort);
    clearTimeout(t);
  }
}

/** A response that keeps the status and `Retry-After` instead of collapsing to an `Error`. */
export interface RawResponse {
  ok: boolean;
  status: number;
  retryAfterSecs: number | undefined;
  body: string;
}

/**
 * Like `btrFetch`, but the caller decides what a non-2xx means. The v2 client needs the status and
 * the countdown to build its typed union (`V2Error`), which the throwing helper threw away.
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
  const onCallerAbort = (): void => ctrl.abort();
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  const signal =
    caller && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([ctrl.signal, caller])
      : ctrl.signal;
  try {
    const res = await fetch(`${getApiRoot()}${path}`, { ...init, signal });
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
