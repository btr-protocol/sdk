import { describe, expect, test } from 'bun:test';
import { relayProvider } from './reader';

type Req = { id: number; method: string; params: unknown[] };
const T = '0x00000000000000000000000000000000000000aa';

function relay(callGas?: string) {
  const seen: Req[] = [];
  const fetch = (async (_u: string, i?: RequestInit) => {
    const b = JSON.parse(String(i?.body));
    const reqs: Req[] = Array.isArray(b) ? b : [b];
    seen.push(...reqs);
    const one = (r: Req) => ({ jsonrpc: '2.0', id: r.id, result: '0x8f' });
    return new Response(JSON.stringify(Array.isArray(b) ? reqs.map(one) : one(reqs[0])));
  }) as unknown as typeof globalThis.fetch;
  return { p: relayProvider(143, { base: 'http://x', fetch, callGas }), seen };
}

describe('relayProvider', () => {
  test('memoized per chain', () => {
    expect(relayProvider(143, { base: 'http://m' })).toBe(relayProvider(143, { base: 'http://m' }));
  });

  test('callGas fills an anonymous eth_call, keeps an explicit gas', async () => {
    const { p, seen } = relay('0x989680');
    await p.request({ method: 'eth_call', params: [{ to: T, data: '0x' }, 'latest'] });
    await p.request({ method: 'eth_call', params: [{ to: T, data: '0x', gas: '0x1' }, 'latest'] });
    const gas = seen
      .filter((r) => r.method === 'eth_call')
      .map((r) => (r.params[0] as { gas: string }).gas);
    expect(gas).toEqual(['0x989680', '0x1']);
  });

  test('fresh never joins an in-flight duplicate', async () => {
    const { p, seen } = relay();
    const q = { to: T, data: '0x01' };
    await Promise.all([
      p.request({ method: 'eth_call', params: [q, 'latest'] }),
      p.request({ method: 'eth_call', params: [q, 'latest'] }),
      p.request({ method: 'eth_call', params: [q, 'latest'], fresh: true }),
    ]);
    expect(seen.filter((r) => r.method === 'eth_call').length).toBe(2);
  });
});
