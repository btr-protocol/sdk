import { afterEach, describe, expect, test } from 'bun:test';
import { FIXTURES, useFixtures } from '../../test/publicFetch.ts';
import { main, render } from '../src/cli.ts';

let restore = (): void => {};
afterEach(() => restore());

async function btr(
  argv: string[],
  files: Record<string, string> = {},
  override: Partial<Record<string, unknown>> = {},
) {
  const f = useFixtures(override);
  restore = f.restore;
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    read: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p]!;
    },
  });
  return { code, out: out.join('\n'), err: err.join('\n'), calls: f.calls };
}

const json = async (argv: string[], files?: Record<string, string>) => {
  const r = await btr([...argv, '--json'], files);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return JSON.parse(r.out);
};

describe('btr commands (--json) against recorded fixtures', () => {
  test('chains', async () => {
    expect(await json(['chains'])).toEqual(FIXTURES.chains!.response);
  });
  test('venues [chainId]', async () => {
    const all = FIXTURES.venues!.response as Record<string, unknown>;
    expect(await json(['venues'])).toEqual(all);
    expect(await json(['venues', '143'])).toEqual(all['143']);
  });
  test('registry [chainId]: offline, with versions', async () => {
    const r = await btr(['registry', '143', '--json']);
    expect(r.calls).toEqual([]);
    const v = JSON.parse(r.out);
    expect(v.chainId).toBe(143);
    expect(Object.keys(v.versions).length).toBeGreaterThan(0);
  });
  test('pools --chain 143 [--detail]', async () => {
    expect(await json(['pools', '--chain', '143'])).toEqual(FIXTURES.pools!.response);
    expect(await json(['pools', '--detail', '--chain-id=143'])).toEqual(
      FIXTURES['assets-pools']!.response,
    );
  });
  test('quote <in> <out> <amounts...>', async () => {
    const r = await btr(['quote', 'USDC', 'WETH', '1000000', '10000000', '--json']);
    expect(JSON.parse(r.out)).toEqual(FIXTURES['chain-quote']!.response);
    expect(r.calls[0]!.body).toEqual(FIXTURES['chain-quote']!.body);
  });
  test('quote with flags instead of positionals', async () => {
    const r = await json([
      'quote',
      '--token-in',
      'USDC',
      '--token-out',
      'WETH',
      '--amounts',
      '1000000',
      '--amounts',
      '10000000',
    ]);
    expect(r).toEqual(FIXTURES['chain-quote']!.response);
  });
  test('route <in> <out> <amount>', async () => {
    expect(await json(['route', 'USDC', 'WBTC', '1000000000'])).toEqual(
      FIXTURES['chain-route']!.response,
    );
  });
  test('depth <file>', async () => {
    const body = JSON.stringify(FIXTURES.depth!.body);
    expect(await json(['depth', 'req.json'], { 'req.json': body })).toEqual(
      FIXTURES.depth!.response,
    );
  });
  test('marks [symbols...] [--status]', async () => {
    expect(await json(['marks', 'BTC-USDC'])).toEqual({
      'BTC-USDC': FIXTURES['price-BTC-USDC']!.response,
    });
    const rows = FIXTURES.tickers!.response as { status: string }[];
    const dead = await json(['marks', '--status', 'dead']);
    expect(dead.length).toBe(rows.filter((r) => r.status === 'dead').length);
  });
  test('ohlc <symbol> --tf --limit', async () => {
    const r = await btr(['ohlc', 'BTC-USDC', '--tf', '3600', '--limit', '3', '--json']);
    expect(JSON.parse(r.out)).toEqual(FIXTURES['ohlc-BTC-USDC']!.response);
    expect(r.calls[0]!.path).toBe('/v1/md/ohlc/BTC-USDC?tf=3600&limit=3');
  });
});

describe('human output', () => {
  test('rows render as an aligned table, flat objects as key/value lines', async () => {
    const r = await btr(['ohlc', 'BTC-USDC', '--limit', '3']);
    const lines = r.out.split('\n');
    expect(lines[0]!.split(/\s+/)).toEqual(['close', 'high', 'low', 'open', 'ts']);
    expect(lines).toHaveLength(4);
    expect(render({ a: 1, bb: null })).toBe('a   1\nbb  -');
    expect(render({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });
});

describe('errors and help', () => {
  test('no command: usage on stderr, exit 2; help: stdout, exit 0', async () => {
    const none = await btr([]);
    expect(none.code).toBe(2);
    expect(none.err).toContain('usage: btr <command>');
    const help = await btr(['--help']);
    expect(help.code).toBe(0);
    for (const c of [
      'chains',
      'venues',
      'registry',
      'pools',
      'quote',
      'route',
      'depth',
      'marks',
      'ohlc',
    ]) {
      expect(help.out).toContain(`  ${c}`);
    }
  });
  test('command help lists flags', async () => {
    const r = await btr(['quote', '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('usage: btr quote <tokenIn> <tokenOut> <amounts...>');
    expect(r.out).toContain('--slippage-pbps <integer>');
  });
  test('unknown command, bad argument, extra positional: exit 2', async () => {
    expect((await btr(['swap'])).code).toBe(2);
    const bad = await btr(['quote', 'USDC', 'NOPE', '1']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown token NOPE');
    expect((await btr(['chains', 'extra'])).code).toBe(2);
    expect((await btr(['depth', 'missing.json'])).code).toBe(1);
    expect((await btr(['depth', 'x.json'], { 'x.json': '{' })).code).toBe(2);
  });
  test('API failure: exit 1, --json error object on stderr', async () => {
    const r = await btr(['ohlc', 'NOPE-X', '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toEqual({ error: expect.stringContaining('404') });
  });
});
