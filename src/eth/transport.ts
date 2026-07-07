/**
 * Resilient HTTP JSON-RPC transport
 * - per-request timeout (AbortController)
 * - retry w/ capped exponential backoff + jitter
 * - multi-RPC failover
 * - typed errors (revert vs network vs rate-limit vs timeout)
 * - tick-batched request coalescing + in-flight dedupe (N round-trips -> 1)
 * Zero deps beyond fetch.
 */

import type { Eip1193Provider } from './types';

// ─────────────────────────────────────────────────────────────
// Typed errors
// ─────────────────────────────────────────────────────────────

export class RpcError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
    this.name = new.target.name; // subclass name
  }
}
export class RpcRevertError extends RpcError {}     // execution reverted — NOT retryable
export class RpcRateLimitError extends RpcError {}  // 429 / -32005 — retryable
export class RpcTimeoutError extends RpcError {}    // AbortController fired — retryable
export class RpcNetworkError extends RpcError {}    // fetch fail / non-ok HTTP — retryable

// Classify a JSON-RPC error object into a typed error.
function rpcErr(e: { code?: number; message?: string; data?: unknown }): RpcError {
  const msg = e.message ?? 'RPC error';
  if (e.code === 3 || /execution reverted|revert/i.test(msg)) return new RpcRevertError(msg, e.code, e.data);
  if (e.code === -32005 || e.code === -32016 || /rate.?limit|too many|limit exceeded/i.test(msg))
    return new RpcRateLimitError(msg, e.code, e.data);
  return new RpcError(msg, e.code, e.data);
}

// ─────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────

// Idempotent reads safe to dedupe within a coalescing window.
const DEDUPE = new Set([
  'eth_call', 'eth_getBalance', 'eth_chainId', 'eth_blockNumber', 'eth_getCode',
  'eth_getStorageAt', 'eth_gasPrice', 'eth_getBlockByNumber', 'eth_getTransactionReceipt',
  'eth_getTransactionCount', 'eth_estimateGas',
]);

export interface TransportOpts {
  timeout?: number;   // per-request ms (default 10000)
  retries?: number;   // extra attempts after the first (default 3)
  retryDelay?: number; // base backoff ms (default 150)
  // batch:false disables coalescing; {wait} in ms (default 0 = microtask), {max} chunk size
  batch?: boolean | { wait?: number; max?: number };
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Pending = Waiter & { method: string; params: unknown[]; key?: string; waiters: Waiter[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function httpTransport(urls: string | readonly string[], opts: TransportOpts = {}): Eip1193Provider {
  const endpoints = (Array.isArray(urls) ? urls : [urls]) as string[];
  const timeout = opts.timeout ?? 10_000;
  const retries = opts.retries ?? 3;
  const baseDelay = opts.retryDelay ?? 150;
  const batchOn = opts.batch !== false;
  const wait = typeof opts.batch === 'object' ? (opts.batch.wait ?? 0) : 0;
  const maxBatch = typeof opts.batch === 'object' ? (opts.batch.max ?? 100) : 100;

  let id = 0;
  let queue: Pending[] = [];
  const inflight = new Map<string, Pending>();
  let scheduled = false;

  // Single fetch attempt: timeout + typed transport errors.
  async function fetchRpc(url: string, body: unknown): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new RpcTimeoutError(`RPC timeout after ${timeout}ms`);
      throw new RpcNetworkError(e?.message ?? 'network error');
    } finally {
      clearTimeout(t);
    }
    if (res.status === 429) throw new RpcRateLimitError('rate limited', 429);
    if (!res.ok) throw new RpcNetworkError(`HTTP ${res.status}: ${res.statusText}`, res.status);
    return res.json();
  }

  // Failover across endpoints + capped exponential backoff.
  async function post(body: unknown): Promise<any> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchRpc(endpoints[attempt % endpoints.length], body);
      } catch (e) {
        last = e;
        if (attempt < retries) await sleep(Math.min(4000, baseDelay * 2 ** attempt) + Math.random() * baseDelay);
      }
    }
    throw last;
  }

  const fail = (p: Pending, e: unknown) => {
    if (p.key) inflight.delete(p.key);
    p.reject(e);
    for (const w of p.waiters) w.reject(e);
  };
  const done = (p: Pending, r: any) => {
    if (p.key) inflight.delete(p.key);
    if (r?.error) { const e = rpcErr(r.error); p.reject(e); for (const w of p.waiters) w.reject(e); }
    else { p.resolve(r?.result); for (const w of p.waiters) w.resolve(r?.result); }
  };

  async function sendChunk(chunk: Pending[]) {
    const reqs = chunk.map(p => ({ jsonrpc: '2.0', id: ++id, method: p.method, params: p.params }));
    try {
      const json = await post(chunk.length === 1 ? reqs[0] : reqs);
      const arr = Array.isArray(json) ? json : [json];
      const byId = new Map(arr.map((r: any) => [r.id, r]));
      chunk.forEach((p, k) => done(p, byId.get(reqs[k].id) ?? arr[k]));
    } catch (e) {
      for (const p of chunk) fail(p, e);
    }
  }

  function flush() {
    scheduled = false;
    const batch = queue; queue = [];
    for (let i = 0; i < batch.length; i += maxBatch) sendChunk(batch.slice(i, i + maxBatch));
  }
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    wait > 0 ? setTimeout(flush, wait) : queueMicrotask(flush);
  };

  const request = ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (!batchOn) {
      return post({ jsonrpc: '2.0', id: ++id, method, params }).then((j: any) => {
        if (j?.error) throw rpcErr(j.error);
        return j?.result;
      });
    }
    return new Promise((resolve, reject) => {
      if (DEDUPE.has(method)) {
        const key = method + JSON.stringify(params);
        const lead = inflight.get(key);
        if (lead) { lead.waiters.push({ resolve, reject }); return; }
        const p: Pending = { method, params: params as unknown[], resolve, reject, key, waiters: [] };
        inflight.set(key, p); queue.push(p);
      } else {
        queue.push({ method, params: params as unknown[], resolve, reject, waiters: [] });
      }
      schedule();
    });
  };

  return { request };
}
