import { describe, expect, test } from 'bun:test';
import { encodeFn } from './abi';
import { type Call, MC3_ADDR } from './multicall';
import { createReader, relayProvider } from './reader';

const ABI = [
  {
    type: 'function',
    name: 'f',
    stateMutability: 'view',
    inputs: [{ name: 'x', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`;
const T = '0x00000000000000000000000000000000000000aa';

type Req = { id: number; method: string; params: unknown[] };
/** Relay mock: aggregate3 answers each leg x -> x*2, leg x=13 reverts. */
function relay() {
  const posts: Req[][] = [];
  const fetch = (async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const reqs: Req[] = Array.isArray(body) ? body : [body];
    posts.push(reqs);
    const one = (r: Req) => {
      if (r.method === 'eth_chainId') return { jsonrpc: '2.0', id: r.id, result: '0x8f' };
      if (r.method === 'eth_getCode') return { jsonrpc: '2.0', id: r.id, result: '0x60' };
      if (r.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: r.id, result: '0x10' };
      const data = (r.params[0] as { data: string }).data;
      // Leg count + leg args are recovered from the encoded x words (fn selector 4 bytes + uint).
      const sel = encodeFn({ abi: ABI, functionName: 'f', args: [0n] }).slice(2, 10);
      const legs = [...data.matchAll(new RegExp(`${sel}([0-9a-f]{64})`, 'g'))].map((m) =>
        BigInt(`0x${m[1]}`),
      );
      const out = legs.map((x) => (x === 13n ? { s: false, r: '0x' } : { s: true, r: word(x * 2n) }));
      return { jsonrpc: '2.0', id: r.id, result: encodeTuples(out) };
    };
    return new Response(JSON.stringify(Array.isArray(body) ? reqs.map(one) : one(reqs[0])));
  }) as unknown as typeof globalThis.fetch;
  const p = relayProvider(143, { base: 'http://x', fetch });
  const calls = () => posts.flat().filter((r) => r.method === 'eth_call');
  return { p, posts, calls, r: createReader(p, 143) };
}

/** ABI-encode (bool,bytes)[] by hand: offsets + entries. */
function encodeTuples(xs: { s: boolean; r: string }[]): string {
  const h = (n: number) => n.toString(16).padStart(64, '0');
  const ent = xs.map(({ s, r }) => {
    const b = r.slice(2);
    const pad = b.padEnd(Math.ceil(b.length / 64) * 64, '0');
    return h(s ? 1 : 0) + h(64) + h(b.length / 2) + pad;
  });
  let off = xs.length * 32;
  const heads = ent.map((e) => {
    const o = h(off);
    off += e.length / 2;
    return o;
  });
  return `0x${h(32)}${h(xs.length)}${heads.join('')}${ent.join('')}`;
}

const c = (x: bigint): Call => ({ address: T, abi: ABI, functionName: 'f', args: [x] });

describe('reader', () => {
  test('N reads in one tick = 1 eth_call', async () => {
    const { r, calls } = relay();
    const out = await Promise.all([1n, 2n, 3n, 4n, 5n].map((x) => r.read<bigint>(c(x))));
    expect(out).toEqual([2n, 4n, 6n, 8n, 10n]);
    expect(calls().length).toBe(1);
    expect((calls()[0].params[0] as { to: string }).to.toLowerCase()).toBe(MC3_ADDR.toLowerCase());
  });

  test('failure isolation: one reverting leg fails only its caller', async () => {
    const { r, calls } = relay();
    const [a, b, all] = await Promise.allSettled([
      r.read<bigint>(c(1n)),
      r.read<bigint>(c(13n)),
      r.readAll([c(13n), c(7n)]),
    ]);
    expect(a).toEqual({ status: 'fulfilled', value: 2n });
    expect(b.status).toBe('rejected');
    const legs = (all as PromiseFulfilledResult<{ success: boolean; result?: unknown }[]>).value;
    expect(legs.map((l) => l.success)).toEqual([false, true]);
    expect(legs[1].result).toBe(14n);
    expect(calls().length).toBe(1);
  });

  test('size split: over the chunk cap = several aggregate3, pinned to one block', async () => {
    const { r, calls } = relay();
    const xs = Array.from({ length: 5 }, (_, i) => BigInt(i + 1));
    const legs = await r.readAll(xs.map(c), { chunkSize: 2 });
    expect(legs.map((l) => l.result)).toEqual(xs.map((x) => x * 2n));
    expect(calls().length).toBe(3);
    expect(new Set(calls().map((q) => q.params[1]))).toEqual(new Set(['0x10']));
  });

  test('fresh bypasses dedupe and the shared batch', async () => {
    const { r, calls } = relay();
    await Promise.all([r.read(c(1n)), r.read(c(1n), { fresh: true })]);
    expect(calls().length).toBe(2);
    // Two identical non-fresh raw calls in one tick dedupe to one; fresh never joins them.
    const q = { to: T, data: '0x' };
    const before = calls().length;
    await Promise.all([
      r.rpc('eth_call', [q, 'latest']),
      r.rpc('eth_call', [q, 'latest']),
      r.rpc('eth_call', [q, 'latest'], { fresh: true }),
    ]);
    expect(calls().length - before).toBe(2);
  });

  test('relayProvider memoized per chain; callGas fills anonymous eth_call', async () => {
    expect(relayProvider(143, { base: 'http://m' })).toBe(relayProvider(143, { base: 'http://m' }));
    const seen: Req[] = [];
    const fetch = (async (_u: string, i?: RequestInit) => {
      const b = JSON.parse(String(i?.body));
      seen.push(b);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: '0x8f' }));
    }) as unknown as typeof globalThis.fetch;
    const p = relayProvider(143, { base: 'http://x', fetch, callGas: '0x989680' });
    await p.request({ method: 'eth_call', params: [{ to: T, data: '0x' }, 'latest'] });
    expect((seen.at(-1)!.params[0] as { gas: string }).gas).toBe('0x989680');
  });
});
