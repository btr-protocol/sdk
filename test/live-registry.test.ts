import { expect, test } from 'bun:test';
import { run } from '../src/cli/btr.js';
import { handle, handleLine } from '../src/cli/mcp.js';
import { fetchRegistry } from '../src/venues/live.js';
import abisIndex from './fixtures/abis-143.json';
import fixture from './fixtures/registry-143.json';

const mock = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const real = { fetch: mock(fixture) };
const tampered = () => {
  const j = structuredClone(fixture) as typeof fixture;
  j.contracts.router = `0x${'1'.padStart(40, '0')}`;
  return { fetch: mock(j) };
};

test('real payload matches baked: live source, no throw', async () => {
  const r = await fetchRegistry(143, real);
  expect(r.source).toBe('live');
  expect(r.pools.length).toBeGreaterThan(0);
  expect(r.warnings).toEqual([]);
  expect(r.info.length).toBeGreaterThan(0);
});

test('mismatch throws; trustLive accepts with warning', async () => {
  await expect(fetchRegistry(143, tampered())).rejects.toThrow('contracts.router');
  const r = await fetchRegistry(143, { ...tampered(), trustLive: true });
  expect(r.warnings.join()).toContain('contracts.router');
});

test('allowlisted contract missing live throws; non-allowlisted live drift ignored', async () => {
  const j = structuredClone(fixture) as typeof fixture & { contracts: Record<string, string> };
  j.contracts.extra = `0x${'2'.padStart(40, '0')}`;
  expect((await fetchRegistry(143, { fetch: mock(j) })).warnings).toEqual([]);
  Reflect.deleteProperty(j.contracts, 'flash');
  await expect(fetchRegistry(143, { fetch: mock(j) })).rejects.toThrow('contracts.flash');
});

test('fetch failure throws unless fallback baked; bad address throws', async () => {
  await expect(fetchRegistry(143, { fetch: mock({}, 500) })).rejects.toThrow('backend-error 500');
  const r = await fetchRegistry(143, { fetch: mock({}, 500), fallback: 'baked' });
  expect(r.source).toBe('baked');
  expect(r.warnings[0]).toContain('live fetch failed');
  const bad = { ...fixture, contracts: { ...fixture.contracts, router: 'nope' } };
  await expect(fetchRegistry(143, { fetch: mock(bad) })).rejects.toThrow('bad address');
});

test('unknown chain throws', async () => {
  const j = { ...fixture, chainId: 999999 };
  await expect(fetchRegistry(999999, { fetch: mock(j) })).rejects.toThrow('no baked record');
  await expect(
    fetchRegistry(999999, { fetch: mock({}, 500), fallback: 'baked' }),
  ).rejects.toThrow();
});

test('mcp: parse error, invalid request, bad chainId, tools', async () => {
  expect(await handleLine('{nope')).toMatchObject({ id: null, error: { code: -32700 } });
  expect(await handle([1])).toMatchObject({ id: null, error: { code: -32600 } });
  expect(await handle('x')).toMatchObject({ error: { code: -32600 } });
  const call = (args: unknown) =>
    handle({ id: 2, method: 'tools/call', params: { name: 'pool_list', arguments: args } }, real);
  expect(await call({ chain: -1 })).toMatchObject({ result: { isError: true } });
  expect(await call({ chain: '143' })).toMatchObject({ result: { isError: true } });
  const ok: any = await call({ chain: 143 });
  expect(JSON.parse(ok.result.content[0].text).source).toBe('live');
  const init: any = await handle({ id: 1, method: 'initialize', params: { protocolVersion: '1' } });
  expect(init.result.protocolVersion).toBe('2024-11-05');
  const list: any = await handle({ id: 3, method: 'tools/list' });
  expect(list.result.tools.map((t: any) => t.name)).toContain('roster');
});

test('cli: exit codes and roster', async () => {
  const lines: string[] = [];
  const out = (s: string) => lines.push(s);
  expect(await run(['pool-list', '--chain', '143'], out, real)).toBe(0);
  expect(lines[0]).toContain(fixture.pools[0]!.address);
  expect(await run(['pools', '--chain', '-5'], out, real)).toBe(2);
  expect(await run(['registry', '--chain', '143'], out, tampered())).toBe(1);
  expect(await run(['registry', '--chain', '143'], out, { fetch: mock({}, 500) })).toBe(1);
  lines.length = 0;
  expect(await run(['roster', '--chain', '143'], out, real)).toBe(0);
  expect(lines.join()).toContain(fixture.roster.safes[0]!.address);
  expect(lines.join()).toContain('"degraded": false');
  lines.length = 0;
  expect(await run(['abis', '--chain', '143'], out, { fetch: mock(abisIndex) })).toBe(0);
  expect(lines.join()).toContain('Pool');
  expect(await run(['bogus'], out)).toBe(2);
});

test('only status=live pools are compared; others exposed', async () => {
  const r = await fetchRegistry(143, real);
  expect(r.pools.every((p) => p.status === 'live')).toBe(true);
  expect(r.otherPools.map((p) => p.status)).toEqual(['superseded']);
  const j = structuredClone(fixture);
  j.pools[1]!.address = `0x${'3'.padStart(40, '0')}`; // superseded drift: ignored
  expect((await fetchRegistry(143, { fetch: mock(j) })).warnings).toEqual([]);
  j.pools[0]!.address = `0x${'4'.padStart(40, '0')}`; // live drift: throws
  await expect(fetchRegistry(143, { fetch: mock(j) })).rejects.toThrow('pools.btr-core');
});

test('null contract = missing: allowlisted throws, other ignored', async () => {
  const j = structuredClone(fixture) as unknown as { contracts: Record<string, string | null> };
  j.contracts.adminImpl = null;
  expect((await fetchRegistry(143, { fetch: mock(j) })).warnings).toEqual([]);
  j.contracts.router = null;
  expect((await fetchRegistry(143, { fetch: mock(j), trustLive: true })).warnings.join()).toContain(
    'contracts.router',
  );
  await expect(fetchRegistry(143, { fetch: mock(j) })).rejects.toThrow('contracts.router');
});

test('degraded with null roster/abis does not throw', async () => {
  const j = { ...structuredClone(fixture), degraded: true, roster: null, abis: null };
  const r = await fetchRegistry(143, { fetch: mock(j) });
  expect(r.degraded).toBe(true);
  expect(r.roster).toBeNull();
  expect(r.abis).toBeNull();
  // roster falls back to /v1/roster when nothing is embedded
  const f = (async (u: string) =>
    new Response(
      JSON.stringify(String(u).includes('/v1/roster') ? { safes: ['x'] } : j),
    )) as unknown as typeof fetch;
  const res: any = await handle(
    { id: 1, method: 'tools/call', params: { name: 'roster', arguments: { chain: 143 } } },
    { fetch: f },
  );
  expect(JSON.parse(res.result.content[0].text)).toMatchObject({
    roster: { safes: ['x'] },
    degraded: true,
  });
});

test('mcp abis and requests hit /v1/registry', async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(String(u));
    return new Response(JSON.stringify(String(u).includes('/v1/abis') ? abisIndex : fixture));
  }) as unknown as typeof fetch;
  const res: any = await handle(
    { id: 1, method: 'tools/call', params: { name: 'abis', arguments: { chain: 143 } } },
    { fetch: f },
  );
  expect(JSON.parse(res.result.content[0].text).names).toContain('Pool');
  await fetchRegistry(143, { fetch: f });
  expect(urls[0]).toEndWith('/v1/abis?chainId=143');
  expect(urls[1]).toEndWith('/v1/registry?chainId=143');
});

test('wrong-chain roster/abis and duplicate pool tags are refused', async () => {
  const wrong = { ...fixture, roster: { ...fixture.roster, chainId: 1 } };
  const res: any = await handle(
    { id: 1, method: 'tools/call', params: { name: 'roster', arguments: { chain: 143 } } },
    { fetch: mock(wrong) },
  );
  expect(res.result.isError).toBe(true);
  const dup = structuredClone(fixture);
  dup.pools[1] = { ...dup.pools[1]!, status: 'live' };
  await expect(fetchRegistry(143, { fetch: mock(dup) })).rejects.toThrow('duplicate tag');
  expect(await run(['abis', '--chain', '143'], () => {}, { fetch: mock({ chainId: 1 }) })).toBe(1);
});
