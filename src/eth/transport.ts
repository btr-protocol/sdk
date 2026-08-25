/**
 * Resilient HTTP JSON-RPC transport
 * - per-request timeout (AbortController)
 * - retry w/ capped exponential backoff + jitter
 * - multi-RPC failover
 * - typed errors (revert vs network vs rate-limit vs timeout)
 * - prepared-batch request coalescing + in-flight dedupe: queued requests share ONE round-trip,
 *   flushed by whichever comes first - the wait window, the per-request cap or the byte cap
 * Zero deps beyond fetch.
 */

import type { Eip1193Provider } from './types';

// ─────────────────────────────────────────────────────────────
// Typed errors
// ─────────────────────────────────────────────────────────────

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = new.target.name; // subclass name
  }
}
export class RpcRevertError extends RpcError {} // execution reverted — NOT retryable
export class RpcRateLimitError extends RpcError {} // 429 / -32005 — retryable
export class RpcTimeoutError extends RpcError {} // AbortController fired — retryable
export class RpcNetworkError extends RpcError {} // fetch fail / non-ok HTTP — retryable

// Classify a JSON-RPC error object into a typed error.
function rpcErr(e: { code?: number; message?: string; data?: unknown }): RpcError {
  const msg = e.message ?? 'RPC error';
  if (e.code === 3 || /execution reverted|revert/i.test(msg))
    return new RpcRevertError(msg, e.code, e.data);
  if (e.code === -32005 || e.code === -32016 || /rate.?limit|too many|limit exceeded/i.test(msg))
    return new RpcRateLimitError(msg, e.code, e.data);
  return new RpcError(msg, e.code, e.data);
}

// ─────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────

// Idempotent reads safe to dedupe within a coalescing window.
const DEDUPE = new Set([
  'eth_call',
  'eth_getBalance',
  'eth_chainId',
  'eth_blockNumber',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_gasPrice',
  'eth_getBlockByNumber',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_estimateGas',
]);

export interface TransportOpts {
  timeout?: number; // per-request ms (default 10000)
  retries?: number; // extra attempts after the first (default 3)
  retryDelay?: number; // base backoff ms (default 150)
  // batch:false disables coalescing; otherwise the prepared batch flushes on whichever fires
  // first: {wait} ms since the first enqueue (default 0 = same tick / microtask), {max}
  // requests per round-trip (default 100), or {maxBytes} approx serialized request bytes
  // (default unlimited). A larger window amortizes better but adds latency to every read -
  // keep it small (tens of ms) unless the caller is itself burst-shaped.
  batch?: boolean | { wait?: number; max?: number; maxBytes?: number };
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Pending = Waiter & { method: string; params: unknown[]; key?: string; waiters: Waiter[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function httpTransport(
  urls: string | readonly string[],
  opts: TransportOpts = {},
): Eip1193Provider {
  const endpoints = (Array.isArray(urls) ? urls : [urls]) as string[];
  const timeout = opts.timeout ?? 10_000;
  const retries = opts.retries ?? 3;
  const baseDelay = opts.retryDelay ?? 150;
  const batchOn = opts.batch !== false;
  const batch = typeof opts.batch === 'object' ? opts.batch : undefined;
  const wait = batch?.wait ?? 0;
  const maxBatch = batch?.max ?? 100;
  const maxBytes = batch?.maxBytes ?? Number.POSITIVE_INFINITY;

  let id = 0;
  let queue: Pending[] = [];
  let queuedBytes = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Map<string, Pending>();
  let scheduled = false;

  // One JSON-RPC 2.0 response (or a batch element). `result` and `error` are mutually exclusive;
  // both stay unknown here - callers narrow via rpcErr() or their own result types.
  interface RpcResponse {
    id?: string | number;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
  }

  // Single fetch attempt: timeout + typed transport errors.
  async function fetchRpc(url: string, body: unknown): Promise<RpcResponse> {
    const ctrl = new AbortController();
    // The abort must stay armed across the body read: headers can arrive and the body
    // then stall forever (backgrounded tab, throttling proxy). A settled `post` is what
    // clears the `inflight` dedupe entry, so a hung read wedges every later same-key call.
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 429) throw new RpcRateLimitError('rate limited', 429);
      if (!res.ok) throw new RpcNetworkError(`HTTP ${res.status}: ${res.statusText}`, res.status);
      return (await res.json()) as RpcResponse;
    } catch (e) {
      if (e instanceof RpcError) throw e;
      const err = e as { name?: string; message?: string } | undefined;
      if (err?.name === 'AbortError') throw new RpcTimeoutError(`RPC timeout after ${timeout}ms`);
      throw new RpcNetworkError(err?.message ?? 'network error');
    } finally {
      clearTimeout(t);
    }
  }

  // Failover across endpoints + capped exponential backoff.
  async function post(body: unknown): Promise<RpcResponse> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchRpc(endpoints[attempt % endpoints.length], body);
      } catch (e) {
        last = e;
        if (attempt < retries)
          await sleep(Math.min(4000, baseDelay * 2 ** attempt) + Math.random() * baseDelay);
      }
    }
    throw last;
  }

  const fail = (p: Pending, e: unknown) => {
    if (p.key) inflight.delete(p.key);
    p.reject(e);
    for (const w of p.waiters) w.reject(e);
  };
  const done = (p: Pending, r: RpcResponse | undefined) => {
    if (p.key) inflight.delete(p.key);
    if (r?.error) {
      const e = rpcErr(r.error);
      p.reject(e);
      for (const w of p.waiters) w.reject(e);
    } else {
      p.resolve(r?.result);
      for (const w of p.waiters) w.resolve(r?.result);
    }
  };

  async function sendChunk(chunk: Pending[]) {
    const reqs = chunk.map((p) => ({
      jsonrpc: '2.0',
      id: ++id,
      method: p.method,
      params: p.params,
    }));
    try {
      const json = await post(chunk.length === 1 ? reqs[0] : reqs);
      const arr = Array.isArray(json) ? json : [json];
      const byId = new Map(arr.map((r) => [r.id, r]));
      chunk.forEach((p, k) => done(p, byId.get(reqs[k].id) ?? arr[k]));
    } catch (e) {
      for (const p of chunk) fail(p, e);
    }
  }

  function flush() {
    scheduled = false;
    timerId = null;
    queuedBytes = 0;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += maxBatch) sendChunk(batch.slice(i, i + maxBatch));
  }
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    if (wait > 0) {
      timerId = setTimeout(() => {
        timerId = null;
        flush();
      }, wait);
    } else {
      queueMicrotask(flush);
    }
  };
  // The prepared batch hit a capacity limit (count or bytes): it must not sit out the rest of
  // the window - cancel the pending timer and send now.
  const flushNow = () => {
    if (!scheduled) return flush();
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    flush();
  };

  const request = ({
    method,
    params = [],
  }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (!batchOn) {
      return post({ jsonrpc: '2.0', id: ++id, method, params }).then((j: RpcResponse) => {
        if (j?.error) throw rpcErr(j.error);
        return j?.result;
      });
    }
    return new Promise((resolve, reject) => {
      if (DEDUPE.has(method)) {
        const key = method + JSON.stringify(params);
        const lead = inflight.get(key);
        if (lead) {
          lead.waiters.push({ resolve, reject });
          return;
        }
        const p: Pending = {
          method,
          params: params as unknown[],
          resolve,
          reject,
          key,
          waiters: [],
        };
        inflight.set(key, p);
        queue.push(p);
      } else {
        queue.push({ method, params: params as unknown[], resolve, reject, waiters: [] });
      }
      // Approximate serialized size without re-stringifying the whole batch: params dominate,
      // so method + params length + a fixed envelope allowance is exact enough for a threshold.
      queuedBytes += method.length + JSON.stringify(params ?? []).length + 80;
      queue.length >= maxBatch || queuedBytes >= maxBytes ? flushNow() : schedule();
    });
  };

  return { request };
}
