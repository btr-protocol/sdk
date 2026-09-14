import { afterEach, describe, expect, test } from 'bun:test';
import { RpcNetworkError, RpcRevertError, RpcTimeoutError, httpTransport } from './transport';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// JSON-RPC request as sent over the wire (plus mock escape hatches `__override`/`__status`).
interface MockRequest {
  id?: number;
  method?: string;
  params?: unknown[];
  __override?: unknown;
  __status?: number;
  json?: unknown;
}
type MockBody = MockRequest | MockRequest[];

// bun-types' fetch carries an extra required member (preconnect); every mock below matches the
// real call surface, so one typed install point bridges them onto globalThis.fetch.
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const useFetch = (mockFetch: FetchLike): void => {
  globalThis.fetch = mockFetch as FetchLike & typeof fetch;
};

// Mock fetch. `handler(url, body)` returns a { __status, json } raw response or undefined
// (default echo). Returns real Response objects, so it types as a plain fetch replacement.
function mock(
  handler: (url: string, body: MockBody) => { __status: number; json?: unknown } | undefined,
) {
  const calls: { url: string; body: MockBody }[] = [];
  useFetch(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as MockBody;
    // The one-time eth_chainId attestation is not a read; only reads are counted.
    if (Array.isArray(body) || body.method !== 'eth_chainId')
      calls.push({ url: String(url), body });
    const out = handler(String(url), body);
    if (out?.__status)
      return new Response(JSON.stringify(out.json ?? null), {
        status: out.__status,
        statusText: 'x',
      });
    // default: the attestation probe answers as chain 1; every other method echoes 0x<method>
    const respond = (r: MockRequest) =>
      r.__override ?? {
        jsonrpc: '2.0',
        id: r.id,
        result: r.method === 'eth_chainId' ? '0x1' : `0x${r.method}`,
      };
    const json = Array.isArray(body)
      ? body.map(respond)
      : (handler(String(url), body)?.json ?? respond(body));
    return new Response(JSON.stringify(json), { status: 200, statusText: 'OK' });
  });
  return calls;
}

const jsonBody = (init?: RequestInit): MockBody => JSON.parse(String(init?.body)) as MockBody;
const ok = (body: MockRequest, result = '0xok'): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: body.method === 'eth_chainId' ? '0x1' : result,
    }),
    { status: 200 },
  );

describe('httpTransport batching', () => {
  test('coalesces same-tick requests into one HTTP batch', async () => {
    const calls = mock(() => undefined);
    const p = httpTransport('http://rpc');
    const [a, b] = await Promise.all([
      p.request({ method: 'eth_call', params: [{ to: '0x1', data: '0xaa' }, 'latest'] }),
      p.request({ method: 'eth_call', params: [{ to: '0x2', data: '0xbb' }, 'latest'] }),
    ]);
    expect(calls.length).toBe(1); // one round-trip for two calls
    expect(Array.isArray(calls[0].body)).toBe(true);
    expect((calls[0].body as MockRequest[]).length).toBe(2);
    expect(a).toBe('0xeth_call');
    expect(b).toBe('0xeth_call');
  });

  test('dedupes identical concurrent reads', async () => {
    const calls = mock(() => undefined);
    const p = httpTransport('http://rpc');
    const params = [{ to: '0x1', data: '0xaa' }, 'latest'];
    const [a, b] = await Promise.all([
      p.request({ method: 'eth_call', params }),
      p.request({ method: 'eth_call', params }),
    ]);
    expect(calls.length).toBe(1);
    expect(Array.isArray(calls[0].body)).toBe(false); // deduped to a single request
    expect((calls[0].body as MockRequest).method).toBe('eth_call');
    expect(a).toBe(b);
  });
});

describe('httpTransport resilience', () => {
  test('fails over to next endpoint on network error', async () => {
    let hits = 0;
    useFetch(async (url, init) => {
      hits++;
      if (String(url).includes('bad')) throw new TypeError('boom');
      return ok(jsonBody(init) as MockRequest);
    });
    const p = httpTransport(['http://bad', 'http://good'], { retryDelay: 1 });
    const r = await p.request({ method: 'eth_call', params: [] });
    expect(r).toBe('0xok');
    expect(hits).toBeGreaterThanOrEqual(2); // bad then good
  });

  test('retries on 429 rate limit', async () => {
    let n = 0;
    useFetch(async (_url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (body.method === 'eth_chainId') return ok(body);
      if (n++ === 0) return new Response(null, { status: 429, statusText: 'Too Many' });
      return ok(body);
    });
    const p = httpTransport('http://rpc', { retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    expect(n).toBe(2);
  });

  test('surfaces revert as RpcRevertError (not retried)', async () => {
    let n = 0;
    useFetch(async (_url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (body.method === 'eth_chainId') return ok(body);
      n++;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: 3, message: 'execution reverted' },
        }),
        { status: 200 },
      );
    });
    const p = httpTransport('http://rpc', { retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(
      RpcRevertError,
    );
    expect(n).toBe(1); // reverts are deterministic, no retry
  });

  test('times out and rejects with RpcTimeoutError', async () => {
    useFetch((_url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (body.method === 'eth_chainId') return Promise.resolve(ok(body));
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    });
    const p = httpTransport('http://rpc', { timeout: 5, retries: 0 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(
      RpcTimeoutError,
    );
  });

  test('non-ok HTTP surfaces RpcNetworkError after retries', async () => {
    useFetch(async (_url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (body.method === 'eth_chainId') return ok(body);
      return new Response(null, { status: 500, statusText: 'ISE' });
    });
    const p = httpTransport('http://rpc', { retries: 1, retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(
      RpcNetworkError,
    );
  });
});

describe('httpTransport attests every endpoint before its first use', () => {
  // A public RPC URL has no identity. `res.ok` was the whole test, so an endpoint re-pointed at
  // another network (or a gateway answering 200 with a JSON-RPC error) read as healthy and then
  // answered every read as truth. Now each endpoint answers eth_chainId ONCE before it is used.
  const byUrl = (chainOf: Record<string, string>) => {
    const probes: string[] = [];
    const reads: string[] = [];
    useFetch(async (url, init) => {
      const body = jsonBody(init) as MockRequest;
      const u = String(url);
      if (body.method === 'eth_chainId') {
        probes.push(u);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: chainOf[u] }), {
          status: 200,
        });
      }
      reads.push(u);
      return ok(body);
    });
    return { probes, reads };
  };

  test('an endpoint on the wrong chain is evicted, never read from', async () => {
    const { probes, reads } = byUrl({ 'http://wrong': '0x64', 'http://right': '0x1' });
    const p = httpTransport(['http://wrong', 'http://right'], { chainId: 1, retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    expect(await p.request({ method: 'eth_blockNumber', params: [] })).toBe('0xok');
    expect(reads).toEqual(['http://right', 'http://right']);
    expect(probes.filter((u) => u === 'http://wrong').length).toBe(1); // evicted, not re-probed
    expect(probes.filter((u) => u === 'http://right').length).toBe(1); // attested once, cached
  });

  test('concurrent posts sharing one failed verdict evict the wrong endpoint once', async () => {
    // Both posts await the same cached probe and both see false; the second `indexOf` is -1 and
    // `splice(-1, 1)` used to evict the LAST endpoint, the healthy one, bricking the ring.
    const { reads } = byUrl({ 'http://wrong': '0x64', 'http://good': '0x1' });
    const p = httpTransport(['http://wrong', 'http://good'], {
      chainId: 1,
      retryDelay: 1,
      batch: false,
    });
    const rs = await Promise.all([
      p.request({ method: 'eth_call', params: ['a'] }),
      p.request({ method: 'eth_call', params: ['b'] }),
    ]);
    expect(rs).toEqual(['0xok', '0xok']);
    expect(reads).toEqual(['http://good', 'http://good']);
  });

  test('no chainId given: the first attested endpoint pins the ring', async () => {
    const { reads } = byUrl({ 'http://a': '0x1', 'http://b': '0x64' });
    const p = httpTransport(['http://a', 'http://b'], { retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    // Force the ring past `a`: dedupe is keyed on params, so a second distinct read lands on
    // `b` only through failover, which the fallback below simulates by making `a` fail.
    useFetch(async (url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (String(url) === 'http://a') throw new TypeError('down');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x64' }), {
        status: 200,
      });
    });
    await expect(p.request({ method: 'eth_call', params: ['x'] })).rejects.toBeInstanceOf(
      RpcNetworkError,
    );
    expect(reads).toEqual(['http://a']); // b answered as chain 100 and was never read from
  });

  test('a probe that fails as transport is retried, not cached as a verdict', async () => {
    let probes = 0;
    useFetch(async (_url, init) => {
      const body = jsonBody(init) as MockRequest;
      if (body.method === 'eth_chainId' && probes++ === 0)
        return new Response(null, { status: 500, statusText: 'ISE' });
      return ok(body);
    });
    const p = httpTransport('http://rpc', { chainId: 1, retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    expect(probes).toBe(2);
  });

  test('every endpoint on the wrong chain fails closed', async () => {
    byUrl({ 'http://x': '0x64' });
    const p = httpTransport('http://x', { chainId: 1, retries: 1, retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(
      RpcNetworkError,
    );
  });
});
