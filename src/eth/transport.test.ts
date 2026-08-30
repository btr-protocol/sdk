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
    calls.push({ url: String(url), body });
    const out = handler(String(url), body);
    if (out?.__status)
      return new Response(JSON.stringify(out.json ?? null), {
        status: out.__status,
        statusText: 'x',
      });
    // default: echo per-request result = 0x<method>
    const respond = (r: MockRequest) =>
      r.__override ?? { jsonrpc: '2.0', id: r.id, result: `0x${r.method}` };
    const json = Array.isArray(body)
      ? body.map(respond)
      : (handler(String(url), body)?.json ?? respond(body));
    return new Response(JSON.stringify(json), { status: 200, statusText: 'OK' });
  });
  return calls;
}

const jsonBody = (init?: RequestInit): MockBody => JSON.parse(String(init?.body)) as MockBody;

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
      const body = jsonBody(init) as MockRequest;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0xok' }), {
        status: 200,
      });
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
      if (n++ === 0) return new Response(null, { status: 429, statusText: 'Too Many' });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0xok' }), {
        status: 200,
      });
    });
    const p = httpTransport('http://rpc', { retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    expect(n).toBe(2);
  });

  test('surfaces revert as RpcRevertError (not retried)', async () => {
    let n = 0;
    useFetch(async (_url, init) => {
      n++;
      const body = jsonBody(init) as MockRequest;
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
    useFetch(async () => new Response(null, { status: 500, statusText: 'ISE' }));
    const p = httpTransport('http://rpc', { retries: 1, retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(
      RpcNetworkError,
    );
  });
});
