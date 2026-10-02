import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render as renderRpcs, rpcsFromChains } from '../scripts/gen-rpcs';
import { norm, trusted, unusable } from '../scripts/lib/rpcUrl';
import {
  type Chains,
  MAX_ROWS,
  type Probe,
  batchMaxOf,
  bucket,
  lagOk,
  render,
  sanity,
  selectRows,
  urlOf,
} from '../scripts/refresh-rpcs';
import { CHAIN_RPCS } from '../src/eth/rpcs.generated';
import { BTR_CHAINS } from '../src/venues/index.js';

const probe = (url: string, p50 = 100, batchMax = 100, browser = true): Probe => ({
  url,
  p50,
  lagBlocks: 0,
  lagMs: 0,
  batchMax,
  browser,
});

test('unusable: https only, no tracking, no keys, no private variants', () => {
  expect(unusable('https://rpc.example.org', 'none')).toBeNull();
  expect(unusable('https://rpc.example.org/eth', undefined)).toBeNull();
  expect(unusable('wss://rpc.example.org', 'none')).toBe('not https');
  expect(unusable('https://rpc.example.org', 'yes')).toBe('tracking');
  expect(unusable('https://rpc.example.org/${API_KEY}', 'none')).toBe('template');
  expect(unusable('https://rpc.example.org/?api_key=abc', 'none')).toBe('key in url');
  expect(unusable('https://x.example/v2/demo', 'none')).toBe('key in url');
  expect(unusable('https://x.example/2ccf18bf-2916-4198-8856-42172854353c', 'none')).toBe(
    'key in url',
  );
  expect(unusable('https://eth.blockrazor.xyz/fullprivacy', 'none')).toBe('private/mev variant');
  expect(unusable('nope', 'none')).toBe('not a url');
  expect(unusable('https://10.0.0.1/rpc', 'none')).toBe('not a public hostname');
  expect(unusable('https://169.254.169.254', 'none')).toBe('not a public hostname');
  expect(unusable('https://intranet/rpc', 'none')).toBe('not a public hostname');
  expect(unusable('https://node.internal/rpc', 'none')).toBe('not a public hostname');
  expect(unusable('https://rpc.example.org:8545', 'none')).toBe('port');
  for (const h of [
    'localhost.',
    'foo.local.',
    'kubernetes.default.svc',
    'reth.btr.svc.cluster.local',
    'rpc.example.org.',
  ])
    expect(unusable(`https://${h}/rpc`, 'none')).toBe('not a public hostname');
  expect(unusable("https://x.example/'+process.exit()+'", 'none')).toBe('odd characters');
  expect(unusable('https://x.example/a\\b', 'none')).toBe('odd characters');
});

test('sanity: a run that empties or halves a chain writes nothing', () => {
  expect(sanity(3, 0)).toBe('would drop every row');
  expect(sanity(10, 4)).toMatch(/cut 10 rows to 4/);
  expect(sanity(10, 5)).toBeNull();
  expect(sanity(2, 1)).toBeNull();
  expect(sanity(0, 0)).toBeNull();
});

test('norm: case, default port and trailing slash do not make a second endpoint', () => {
  expect(norm('https://RPC.Example.org:443/eth/')).toBe(norm('https://rpc.example.org/eth'));
});

test('lag: 2 blocks, or 1.5 s on a chain too fast for 2 blocks to mean anything', () => {
  expect(lagOk(2, 24_000)).toBe(true);
  expect(lagOk(3, 12_000)).toBe(false);
  expect(lagOk(6, 1_200)).toBe(true);
  expect(lagOk(6, 1_800)).toBe(false);
});

test('batchMaxOf: the largest size that answered in full, 1 when none did', () => {
  expect(batchMaxOf({ 2: true, 8: true, 16: true, 50: true, 100: true })).toBe(100);
  expect(batchMaxOf({ 2: true, 8: true, 16: false })).toBe(8);
  expect(batchMaxOf({ 2: false })).toBe(1);
  expect(batchMaxOf({ 2: true, 8: false, 16: true })).toBe(2);
});

const trustedPublic = (u: string) => u.includes('official');

test('selectRows: existing rows keep form, order and numbers; --grow appends clean new ones ranked', () => {
  const existing = [
    { url: 'https://a', rps: 9, batch_max: 7, weight: 30 },
    { url: 'https://dead', rps: 1, batch_max: 1, weight: 20 },
    'https://b',
    'https://b/', // the same endpoint twice
  ];
  const passed = new Map<string, Probe>(
    [
      probe('https://a', 90, 100),
      probe('https://b', 400, 50),
      probe('https://z-fast', 50),
      probe('https://y-fast', 50),
      probe('https://lim-fast', 20),
      probe('https://unknown-fast', 20),
      probe('https://slow', 900),
      probe('https://official-slow', 900),
    ].map((p) => [p.url, p]),
  );
  const tracking = new Map<string, 'none' | 'limited' | 'yes' | undefined>([
    ['https://lim-fast', 'limited'],
    ['https://z-fast', 'none'],
    ['https://y-fast', 'none'],
    ['https://slow', 'none'],
  ]);
  const opt = { grow: true, trusted: trustedPublic };
  const rows = selectRows(existing, passed, tracking, opt);
  expect(rows.map(urlOf)).toEqual([
    'https://a',
    'https://b',
    'https://official-slow', // trusted host first, whatever its latency
    'https://y-fast',
    'https://z-fast',
    'https://slow',
    // lim-fast (tracking limited) and unknown-fast (unflagged, not trusted) are not clean
  ]);
  expect(rows[0]).toEqual({ url: 'https://a', rps: 9, batch_max: 7, weight: 30, browser: true });
  expect(rows[1]).toEqual({ url: 'https://b', browser: true }); // earns the flag; no invented rate
  expect(rows[3]).toEqual({ url: 'https://y-fast', batch_max: 100, weight: 1, browser: true });
  // A chain with measured rows is only pruned without --grow.
  expect(selectRows(existing, passed, tracking, { ...opt, grow: false }).map(urlOf)).toEqual([
    'https://a',
    'https://b',
  ]);
  expect(bucket(150)).toBe(0);
  expect(bucket(151)).toBe(1);
});

test('selectRows: CORS is a flag, not a criterion: a back-only row stays, a stale flag goes', () => {
  const existing = [
    { url: 'https://backonly', rps: 150, batch_max: 100, weight: 30, browser: true }, // flag now stale
    { url: 'https://web', rps: 5, weight: 2 },
    'https://plain',
  ];
  const passed = new Map<string, Probe>([
    ['https://backonly', probe('https://backonly', 100, 100, false)],
    ['https://web', probe('https://web', 100, 100, true)],
    ['https://plain', probe('https://plain', 100, 100, false)],
  ]);
  const rows = selectRows(existing, passed, new Map(), { grow: false, trusted: () => false });
  expect(rows).toEqual([
    { url: 'https://backonly', rps: 150, batch_max: 100, weight: 30 },
    { url: 'https://web', rps: 5, weight: 2, batch_max: 100, browser: true },
    'https://plain',
  ]);
});

test('selectRows: never cuts an existing row to reach MAX_ROWS, adds no new one past it', () => {
  const existing = Array.from({ length: MAX_ROWS + 2 }, (_, i) => ({
    url: `https://e${i}`,
    weight: 1,
  }));
  const passed = new Map<string, Probe>(
    [...existing.map((r) => r.url), 'https://new'].map((u) => [u, probe(u)]),
  );
  const rows = selectRows(existing, passed, new Map(), {
    grow: true,
    trusted: () => false,
  });
  expect(rows).toHaveLength(MAX_ROWS + 2);
  expect(rows.map(urlOf)).not.toContain('https://new');
});

test("trusted: a chain's own hosts and publicnode, nothing that merely contains the name", () => {
  expect(trusted(143, 'https://rpc1.monad.xyz')).toBe(true);
  expect(trusted(56, 'https://bsc-dataseed.binance.org')).toBe(true);
  expect(trusted(1, 'https://ethereum-rpc.publicnode.com')).toBe(true);
  expect(trusted(143, 'https://monad.xyz.evil.example')).toBe(false);
  expect(trusted(1, 'https://eth.drpc.org')).toBe(false);
  expect(trusted(5042, 'https://rpc.mainnet.arc.io')).toBe(false); // arc.io is not a listed owner
});

// A refresh must diff only its rows: render() has to reproduce the file's own layout. Runs on the
// sibling's file when present (CI pins and clones it), on a fixture otherwise.
const FIXTURE = `{
  "note": "n",
  "slugs": {
    "56": "bnb"
  },
  "default": 56,
  "rpc": {
    "56": ["https://a", "https://b"],
    "143": [
      {"url": "https://c", "rps": 5, "batch_max": 100, "weight": 3, "gas": 8000000},
      {"url": "https://d", "rps": 4, "batch_max": 1, "weight": 1}
    ]
  },
  "rps": {
    "56": 4
  }
}
`;
const SIBLING = join(import.meta.dir, '..', '..', 'dex-evm', 'deployments', 'chains.json');

test('render reproduces the chains.json layout byte for byte', () => {
  expect(render(JSON.parse(FIXTURE) as Chains)).toBe(FIXTURE);
});

// Integer keys sort ascending once parsed, so a file written in another order is re-ordered ONCE;
// what must hold is that nothing is lost and a second pass changes nothing.
test('render keeps every field of the sibling file and is idempotent', () => {
  if (!existsSync(SIBLING)) return;
  const real = JSON.parse(readFileSync(SIBLING, 'utf8')) as Chains;
  const once = render(real);
  expect(JSON.parse(once)).toEqual(real);
  expect(render(JSON.parse(once) as Chains)).toBe(once);
});

test('gen-rpcs: browser rows only, trusted wide first, never paid; any row when a chain has no browser row', () => {
  const rpcs = rpcsFromChains({
    rpc: {
      '143': [
        { url: 'https://other-wide.example.org', batch_max: 100, browser: true },
        { url: 'https://rpc-mainnet.monadinfra.com', batch_max: 1, browser: true },
        { url: 'https://paid.monad.xyz', batch_max: 100, paid: true, browser: true },
        { url: 'https://rpc4.monad.xyz/', batch_max: 7, browser: true },
        { url: 'https://rpc1.monad.xyz', batch_max: 100, browser: true },
        { url: 'https://rpc2.monad.xyz', browser: true },
        { url: 'https://backonly.monad.xyz', batch_max: 100 }, // trusted, wide, but no CORS
      ],
      '56': ['https://s.example.org'],
      '1': [
        { url: 'https://nocors.example.org', batch_max: 100 },
        { url: 'https://web.example.org', batch_max: 100, browser: true },
        { url: 'https://nocors2.example.org' },
      ],
    },
  });
  expect(rpcs).toEqual({
    1: ['https://web.example.org'],
    56: ['https://s.example.org'],
    143: ['https://rpc1.monad.xyz', 'https://rpc2.monad.xyz'],
  });
  expect(renderRpcs(rpcs)).toContain('56: ["https://s.example.org"],');
  expect(renderRpcs({ 1: ["https://x/'a"] })).toContain(`["https://x/'a"]`);
});

test('gen-rpcs: a key or an http URL in the list fails the run, never reaches the output', () => {
  expect(() => rpcsFromChains({ rpc: { '1': ['http://rpc.example.org'] } })).toThrow(/not https/);
  expect(() => rpcsFromChains({ rpc: { '1': ['https://rpc.example.org/?key=abc'] } })).toThrow(
    /key in url/,
  );
});

// The committed list is the generated view of the one list. Fails (never skips) without the sibling.
test('committed CHAIN_RPCS = chains.json', () => {
  if (!existsSync(SIBLING))
    throw new Error('refresh-rpcs.test.ts needs ../dex-evm/deployments (CI pins and clones it)');
  expect(CHAIN_RPCS).toEqual(rpcsFromChains(JSON.parse(readFileSync(SIBLING, 'utf8'))));
});

// Served chains' picks must be browser rows that take a wide batch (the coalescer sends them).
test('served chains: the picks are browser rows taking a 16-call batch', () => {
  if (!existsSync(SIBLING)) throw new Error('needs ../dex-evm/deployments');
  const rpc = (JSON.parse(readFileSync(SIBLING, 'utf8')) as Chains).rpc;
  for (const { chainId } of BTR_CHAINS) {
    const picks = CHAIN_RPCS[chainId] ?? [];
    expect(picks.length).toBeGreaterThan(0);
    for (const url of picks) {
      const row = (rpc[chainId] ?? []).find((r) => urlOf(r) === url);
      expect(row).toBeDefined();
      if (typeof row === 'object') {
        expect(row.browser).toBe(true);
        expect(Number(row.batch_max ?? 100)).toBeGreaterThanOrEqual(16);
      }
    }
  }
});
