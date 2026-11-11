import { afterEach, expect, test } from 'bun:test';
import lock from '../../abis.lock.json';
import { getApiRoot, setApiRoot } from '../api';
import { type AbiFunction, getFunctionSignature, getSelector as selector } from '../eth/abi';
import { fetchAbi, getAbiUrl, resetFetchAbiCacheForTest } from './fetch';
import { abiHash } from './hash';

const originalFetch = globalThis.fetch;
const originalRoot = getApiRoot();
afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiRoot(originalRoot);
  resetFetchAbiCacheForTest();
});
const reply = (generation: string, abi: unknown[] = []) =>
  Response.json(abi, { headers: { 'x-btr-abi-generation': generation } });

test('chain 143 serves deployed pins and literal legacy selectors', async () => {
  globalThis.fetch = (() => {
    throw new Error('bundled ABI went to wire');
  }) as unknown as typeof fetch;
  const pool = await fetchAbi('pool', 143);
  const admin = await fetchAbi('Admin', 143);
  expect(String(abiHash(pool))).toBe(lock.chains['143'].pins.Pool);
  expect(String(abiHash(admin))).toBe(lock.chains['143'].pins.Admin);
  const init = (pool as { type: string; name?: string; inputs?: { type: string }[] }[]).find(
    (e) => e.type === 'function' && e.name === 'adminInitAsset',
  );
  const add = (admin as { type: string; name?: string; inputs?: { type: string }[] }[]).find(
    (e) => e.type === 'function' && e.name === 'addAsset',
  );
  expect(init?.inputs?.length).toBe(8);
  expect(add?.inputs?.length).toBe(9);
  expect(selector(getFunctionSignature(init as AbiFunction))).toBe('0x8cbe4822');
  expect(selector(getFunctionSignature(add as AbiFunction))).toBe('0x1123d118');
  expect(admin.some((e) => e.name === 'guardianHaltAt')).toBe(false);
});

test('wire requests and URLs carry chain_id; caches separate chain, generation and API', async () => {
  const urls: string[] = [];
  let gen = 'g1';
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return reply(gen);
  }) as unknown as typeof fetch;
  await fetchAbi('Custom', 56, 'g1');
  await fetchAbi('Custom', 56, 'g1');
  await fetchAbi('Custom', 999, 'g1');
  gen = 'g2';
  await fetchAbi('Custom', 56, 'g2');
  setApiRoot('https://other.invalid');
  await fetchAbi('Custom', 56, 'g2');
  expect(urls.length).toBe(4);
  expect(urls[0]).toContain('/v1/abis/Custom?chain_id=56');
  expect(urls[1]).toContain('chain_id=999');
  expect(urls[3]).toStartWith('https://other.invalid/');
  expect(getAbiUrl('Flash', 143)).toEndWith('/v1/abis/Flash?chain_id=143');
});

test('wrong generation and content fail closed and never enter cache', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return reply(calls === 1 ? 'wrong' : 'pool-v1-s7');
  }) as unknown as typeof fetch;
  await expect(fetchAbi('Flash', 143)).rejects.toThrow('generation');
  await expect(fetchAbi('Flash', 143)).rejects.toThrow('pin');
  await expect(fetchAbi('Flash', 143)).rejects.toThrow('pin');
  expect(calls).toBe(3);
  await expect(fetchAbi('Pool', 143, 'pool-v2-s12')).rejects.toThrow('pin');
  await expect(fetchAbi('Pool', -1)).rejects.toThrow('chain');
  await expect(fetchAbi('Pool', 56)).rejects.toThrow('generation required');
});

test('all deployed artifacts match chain/generation lock pins', async () => {
  for (const [name, pin] of Object.entries(lock.chains['143'].pins)) {
    const abi = await Bun.file(
      new URL(`../../abis/generations/pool-v1-s7/${name}.json`, import.meta.url),
    ).json();
    expect(String(abiHash(abi))).toBe(pin);
  }
});
