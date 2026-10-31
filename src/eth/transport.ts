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
export class RpcRevertError extends RpcError {} // execution reverted, NOT retryable
export class RpcRateLimitError extends RpcError {} // 429 / -32005, retryable
export class RpcTimeoutError extends RpcError {} // AbortController fired, retryable
export class RpcNetworkError extends RpcError {} // fetch fail / non-ok HTTP, retryable

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
  // The chain every endpoint must attest (eth_chainId, once, before its first use). Absent, the
  // first endpoint that answers sets it: the ring is one chain either way, and a public URL
  // re-pointed at another network is evicted instead of answering reads as truth.
  chainId?: number;
  // Re-probe an attested endpoint every this many ms (default 5 min; 0 disables). Attestation
  // was once-per-endpoint, so a public URL re-pointed at another network AFTER its probe
  // answered reads as truth until restart. A mismatch on re-probe evicts the
  // endpoint, exactly like the first probe.
  attestIntervalMs?: number;
  // batch:false disables coalescing; otherwise the prepared batch flushes on whichever fires
  // first: {wait} ms since the first enqueue (default 0 = same tick / microtask), {max}
  // requests per round-trip (default 100), or {maxBytes} approx serialized request bytes
  // (default unlimited). A larger window amortizes better but adds latency to every read -
  // keep it small (tens of ms) unless the caller is itself burst-shaped.
  batch?: boolean | { wait?: number; max?: number; maxBytes?: number };
  // Largest response body read, bytes (default 32 MiB). A hostile endpoint streaming an endless
  // body would otherwise grow the caller's heap until the tab or process dies; over the cap the
  // read is cancelled and refused (not retried: the same endpoint would send it again).
  maxResponseBytes?: number;
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Pending = Waiter & { method: string; params: unknown[]; key?: string; waiters: Waiter[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `res`'s body as text, refused once it passes `max` bytes (declared or streamed). */
async function readCapped(res: Response, max: number): Promise<string> {
  const tooBig = () => new RpcError(`RPC response over ${max} bytes`, 413);
  if (Number(res.headers.get('content-length')) > max) throw tooBig();
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function httpTransport(
  urls: string | readonly string[],
  opts: TransportOpts = {},
): Eip1193Provider {
  const endpoints = Array.isArray(urls) ? [...(urls as string[])] : [urls as string];
  const timeout = opts.timeout ?? 10_000;
  const retries = opts.retries ?? 3;
  const baseDelay = opts.retryDelay ?? 150;
  const batchOn = opts.batch !== false;
  const batch = typeof opts.batch === 'object' ? opts.batch : undefined;
  const wait = batch?.wait ?? 0;
  const maxBatch = batch?.max ?? 100;
  const maxBytes = batch?.maxBytes ?? Number.POSITIVE_INFINITY;
  const maxResponseBytes = opts.maxResponseBytes ?? 32 * 1024 * 1024;

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
      // 400 is a verdict on the REQUEST (a relay refusing a shape or a limit): sending it again,
      // or to another endpoint, cannot change it.
      if (res.status === 400)
        throw new RpcError(`HTTP 400: ${(await res.text()).slice(0, 200)}`, 400);
      if (!res.ok) throw new RpcNetworkError(`HTTP ${res.status}: ${res.statusText}`, res.status);
      return JSON.parse(await readCapped(res, maxResponseBytes)) as RpcResponse;
    } catch (e) {
      if (e instanceof RpcError) throw e;
      const err = e as { name?: string; message?: string } | undefined;
      if (err?.name === 'AbortError') throw new RpcTimeoutError(`RPC timeout after ${timeout}ms`);
      throw new RpcNetworkError(err?.message ?? 'network error');
    } finally {
      clearTimeout(t);
    }
  }

  // Endpoint attestation. A public RPC URL has no identity; the one checkable fact is that it
  // ANSWERS AS the expected chain. Attested before first use and re-probed every
  // `attestIntervalMs`; a transport failure during the probe is retried later, a mismatch evicts
  // the endpoint from the ring for good.
  let chain = opts.chainId;
  const attestIntervalMs = opts.attestIntervalMs ?? 5 * 60_000;
  const attested = new Map<string, Promise<boolean>>();
  const attestedAt = new Map<string, number>();
  const attest = (url: string): Promise<boolean> => {
    let p = attested.get(url);
    if (p && attestIntervalMs > 0 && Date.now() - (attestedAt.get(url) ?? 0) >= attestIntervalMs) {
      attested.delete(url);
      attestedAt.delete(url);
      p = undefined;
    }
    if (!p) {
      p = fetchRpc(url, { jsonrpc: '2.0', id: ++id, method: 'eth_chainId', params: [] }).then(
        (r) => {
          const got = r.error || typeof r.result !== 'string' ? Number.NaN : Number(r.result);
          if (!Number.isSafeInteger(got)) throw new RpcNetworkError(`eth_chainId failed on ${url}`);
          chain ??= got;
          return got === chain;
        },
      );
      attestedAt.set(url, Date.now());
      p.catch(() => {
        attested.delete(url);
        attestedAt.delete(url);
      });
      attested.set(url, p);
    }
    return p;
  };

  // Failover across endpoints + capped exponential backoff. The ring ROTATES: each
  // top-level post starts at the next endpoint, so steady-state reads spread across the
  // endpoints (and their per-IP rate budgets) instead of pinning the first until it fails.
  // A send and the pending-nonce read never rotate: they start at the primary, so the nonce
  // comes from the node that takes the send (same rule as btr-rpc).
  let start = 0;
  const at = (i: number, n: number): number => ((i % n) + n) % n;
  const pinned = (body: unknown): boolean =>
    (Array.isArray(body) ? body : [body]).some((r) => {
      const m = (r as { method?: unknown } | undefined)?.method;
      return (
        typeof m === 'string' &&
        (m.startsWith('eth_send') || m.startsWith('mev_') || m === 'eth_getTransactionCount')
      );
    });
  async function post(body: unknown): Promise<RpcResponse> {
    let last: unknown;
    const first = !endpoints.length || pinned(body) ? 0 : start++ % endpoints.length;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!endpoints.length) throw new RpcNetworkError(`no endpoint attests chain ${chain}`);
      const url = endpoints[at(first + attempt, endpoints.length)];
      try {
        if (!(await attest(url))) {
          // Concurrent posts share one cached verdict; only the first still finds the url
          // (indexOf -1 would splice the LAST, healthy, endpoint).
          const k = endpoints.indexOf(url);
          if (k >= 0) endpoints.splice(k, 1);
          attempt--; // a verdict, not a flake: no backoff, no attempt spent
          continue;
        }
        return await fetchRpc(url, body);
      } catch (e) {
        last = e;
        // A plain RpcError here is a 400 verdict: retrying cannot change it.
        if (e instanceof RpcError && e.constructor === RpcError) throw e;
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
