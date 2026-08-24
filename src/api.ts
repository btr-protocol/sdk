/** Lean SDK — canonical `api.btr.markets`. All BTR data via `api.btr.markets/v1/*` (single subdomain, versioned). Override with `setApiRoot()`. */
export const BTR_API: string =
  // @ts-ignore Vite injects import.meta.env, TS sees it as unknown in SDK build
  (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BTR_API) ||
  (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API) ||
  (typeof process !== 'undefined' && (process.env as Record<string, string>).BTR_API_URL) ||
  'https://api.btr.markets';

let _api = BTR_API;
export function setApiRoot(url: string) {
  _api = url.replace(/\/$/, '');
}
export function getApiRoot() {
  return _api;
}

/** Generic fetch helper — 10s timeout, typed */
export async function btrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${getApiRoot()}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`BTR API ${res.status} ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}
