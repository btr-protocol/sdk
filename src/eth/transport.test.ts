import { afterEach, describe, expect, test } from 'bun:test';
import {
  httpTransport,
  RpcRevertError,
  RpcTimeoutError,
  RpcNetworkError,
} from './transport';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Mock fetch. `handler(url, body)` returns either a JSON-RPC response object,
// or a Response-like { status, body }. Records every call.
function mock(handler: (url: string, body: any) => any) {
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const out = handler(url, body);
    if (out?.__status) return { ok: out.__status < 400, status: out.__status, statusText: 'x', json: async () => out.json };
    // default: echo per-request result = 0x<method>
    const respond = (r: any) => r.__override ?? { jsonrpc: '2.0', id: r.id, result: `0x${r.method}` };
    const json = Array.isArray(body) ? body.map(respond) : (handler(url, body)?.json ?? respond(body));
    return { ok: true, status: 200, statusText: 'OK', json: async () => json };
  }) as any;
  return calls;
}

describe('httpTransport batching', () => {
  test('coalesces same-tick requests into one HTTP batch', async () => {
    const calls = mock(() => undefined);
    const p = httpTransport('http://rpc');
    const [a, b] = await Promise.all([
      p.request({ method: 'eth_call', params: [{ to: '0x1', data: '0xaa' }, 'latest'] }),
      p.request({ method: 'eth_call', params: [{ to: '0x2', data: '0xbb' }, 'latest'] }),
    ]);
    expect(calls.length).toBe(1);            // one round-trip for two calls
    expect(Array.isArray(calls[0].body)).toBe(true);
    expect(calls[0].body.length).toBe(2);
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
    expect(calls[0].body.method).toBe('eth_call');
    expect(a).toBe(b);
  });
});

describe('httpTransport resilience', () => {
  test('fails over to next endpoint on network error', async () => {
    let hits = 0;
    globalThis.fetch = (async (url: string, init: any) => {
      hits++;
      if (url.includes('bad')) throw new TypeError('boom');
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0xok' }) };
    }) as any;
    const p = httpTransport(['http://bad', 'http://good'], { retryDelay: 1 });
    const r = await p.request({ method: 'eth_call', params: [] });
    expect(r).toBe('0xok');
    expect(hits).toBeGreaterThanOrEqual(2);  // bad then good
  });

  test('retries on 429 rate limit', async () => {
    let n = 0;
    globalThis.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (n++ === 0) return { ok: false, status: 429, statusText: 'Too Many' };
      return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0xok' }) };
    }) as any;
    const p = httpTransport('http://rpc', { retryDelay: 1 });
    expect(await p.request({ method: 'eth_call', params: [] })).toBe('0xok');
    expect(n).toBe(2);
  });

  test('surfaces revert as RpcRevertError (not retried)', async () => {
    let n = 0;
    globalThis.fetch = (async (_url: string, init: any) => {
      n++;
      const body = JSON.parse(init.body);
      return {
        ok: true, status: 200,
        json: async () => ({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted' } }),
      };
    }) as any;
    const p = httpTransport('http://rpc', { retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(RpcRevertError);
    expect(n).toBe(1);                        // reverts are deterministic — no retry
  });

  test('times out and rejects with RpcTimeoutError', async () => {
    globalThis.fetch = ((_url: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => { const e: any = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    })) as any;
    const p = httpTransport('http://rpc', { timeout: 5, retries: 0 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  test('non-ok HTTP surfaces RpcNetworkError after retries', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, statusText: 'ISE' })) as any;
    const p = httpTransport('http://rpc', { retries: 1, retryDelay: 1 });
    await expect(p.request({ method: 'eth_call', params: [] })).rejects.toBeInstanceOf(RpcNetworkError);
  });
});
