/** One nonce read, one receipt wait, both in `src/eth/rpc.ts`.
 *
 *  The client nonce lane read `latest` while the bots and the front read `pending`, three copies of
 *  one call. A lane that starts with a tx still in the mempool (process restart, a second process
 *  on the key) and reads `latest` reissues the in-flight nonce: the send fails "replacement
 *  underpriced" or, with a higher fee, replaces the earlier tx. */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { privateKeyToAddress, signTransaction } from '../src/eth/client';
import { pendingNonce } from '../src/eth/index';
import type { Eip1193Provider, Hex, TransactionRequest } from '../src/eth/types';

const KEY = '0x0202020202020202020202020202020202020202020202020202020202020202' as Hex;

/** Mined count 12 (`latest`), one tx of ours in the mempool (`pending` 13). */
const inFlight = (tags: string[]): Eip1193Provider =>
  ({
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return '0x2105';
      if (method === 'eth_getTransactionCount') {
        const tag = String(params?.[1]);
        tags.push(tag);
        return tag === 'pending' ? '0xd' : '0xc';
      }
      throw new Error(`unexpected ${method}`);
    },
  }) as unknown as Eip1193Provider;

describe('the nonce lane counts the mempool', () => {
  test('pendingNonce reads the pending tag, exact in bigint', async () => {
    const tags: string[] = [];
    expect(await pendingNonce(inFlight(tags), privateKeyToAddress(KEY))).toBe(13n);
    expect(tags).toEqual(['pending']);
  });

  test('a fresh lane does not reissue the nonce of a tx still in flight', async () => {
    const tags: string[] = [];
    const tx = {
      from: privateKeyToAddress(KEY),
      to: '0x3535353535353535353535353535353535353535',
      value: 0n,
      gas: 21000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000n,
      data: '0x',
    } as unknown as TransactionRequest;
    const raw = await signTransaction(inFlight(tags), tx, KEY);
    // chainId 8453 (`822105`) then the nonce byte: 13 (0x0d), never the in-flight 12 (0x0c).
    expect(raw.includes('8221050d')).toBe(true);
    expect(tags).toEqual(['pending']);
  });
});

/** Every `.ts`/`.tsx` under `dir`, minus tests and dependencies. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test('nonce reads and receipt polls live only in src/eth/rpc.ts', () => {
  const src = join(import.meta.dir, '..', 'src');
  // A request for the method (a string literal passed as a method or `cmd` argument), not the
  // transport's method-routing sets, which name it in a list.
  const call =
    /(method:\s*|cmd(<[^>]*>)?\(\s*\w+\s*,\s*)'eth_get(TransactionCount|TransactionReceipt)'/;
  const def = /\b(function|const)\s+(pendingNonce|getNonce|waitReceipt|waitForTransaction)\b/;
  const hits = sources(src)
    .filter((f) => relative(src, f) !== join('eth', 'rpc.ts'))
    .filter((f) => {
      const s = readFileSync(f, 'utf8');
      return call.test(s) || def.test(s);
    })
    .map((f) => relative(src, f));
  expect(hits).toEqual([]);
});
