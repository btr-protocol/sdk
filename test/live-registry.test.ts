import { expect, test } from 'bun:test';
import { run } from '../src/cli/btr.js';
import { handle } from '../src/cli/mcp.js';
import { DEPLOYED_VENUES } from '../src/venues/deployments.generated.js';
import { fetchRegistry } from '../src/venues/live.js';

const id = Number(Object.keys(DEPLOYED_VENUES)[0]);
const baked = DEPLOYED_VENUES[id]!;
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const wire = (over: Record<string, string> = {}) => ({
  chainId: id,
  name: 'x',
  contracts: { router: A(1), ...over },
  tokens: {},
  pools: [{ address: A(2), tag: 'btr-core', symbols: ['USDC'] }],
});
const mock = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('live wins and warns on disagreement', async () => {
  const r = await fetchRegistry(id, { fetch: mock(wire({ router: A(1) })) });
  expect(r.source).toBe('live');
  expect(r.contracts.router).toBe(A(1));
  if (baked.contracts.router) expect(r.warnings.join()).toContain('contracts.router');
});

test('falls back to baked on failure or bad address', async () => {
  for (const f of [mock({}, 500), mock(wire({ router: 'nope' }))]) {
    const r = await fetchRegistry(id, { fetch: f });
    expect(r.source).toBe('baked');
    expect(r.warnings[0]).toContain('live fetch failed');
    expect(r.contracts).toEqual(baked.contracts);
  }
});

test('cli pools + mcp tools', async () => {
  const lines: string[] = [];
  expect(
    await run(['pools', '--chain', String(id)], (s) => lines.push(s), { fetch: mock(wire()) }),
  ).toBe(0);
  expect(lines[0]).toContain(A(2));
  const o = { fetch: mock(wire()) };
  const list: any = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, o);
  expect(list.result.tools.map((t: any) => t.name)).toEqual([
    'get_registry',
    'get_abi',
    'list_pools',
  ]);
  const res: any = await handle(
    { id: 2, method: 'tools/call', params: { name: 'list_pools', arguments: { chainId: id } } },
    o,
  );
  expect(JSON.parse(res.result.content[0].text).source).toBe('live');
});
