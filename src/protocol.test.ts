import { expect, test } from 'bun:test';
import { btrApi, fetchPoolParams, lpRows } from './protocol.js';

const seen: Array<{ url: string; init: RequestInit }> = [];
const f = (async (url: string, init: RequestInit) => {
  seen.push({ url, init });
  return new Response('{"ok":1}');
}) as unknown as typeof fetch;

test('btrApi: query, chainId, POST body', async () => {
  await btrApi('/v1/activity', 143, {
    fetch: f,
    base: 'http://x',
    query: { limit: 5, before: null },
  });
  expect(seen[0].url).toBe('http://x/v1/activity?limit=5&chainId=143');
  expect(seen[0].init.method).toBe('GET');
  await fetchPoolParams(143, 'btr core', { fetch: f, base: 'http://x' });
  expect(seen[1].url).toBe('http://x/v1/pools/btr%20core/params?chainId=143');
  await lpRows(143, { addr: '0x1', legs: [] }, { fetch: f, base: 'http://x' });
  expect(seen[2].init.method).toBe('POST');
  expect(JSON.parse(String(seen[2].init.body))).toEqual({ addr: '0x1', legs: [] });
});

test('btrApi throws on non-2xx', async () => {
  const bad = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  await expect(btrApi('/v1/summary', 1, { fetch: bad, base: 'http://x' })).rejects.toThrow('503');
});
