import { afterEach, describe, expect, test } from 'bun:test';
import { FIXTURES, useFixtures } from '../../test/publicFetch.ts';
import { DEPLOYED_VENUES } from '../venues/deployments.generated.js';
import { parseLosslessInts } from './api.js';
import {
  OPS,
  UsageError,
  checkArgs,
  opByName,
  opInputSchema,
  rawAmount,
  resolveToken,
  runOp,
} from './ops.js';

let restore = (): void => {};
afterEach(() => restore());
const fx = (o: Partial<Record<string, unknown>> = {}) => {
  const f = useFixtures(o);
  restore = f.restore;
  return f;
};
const run = (name: string, args: Record<string, unknown> = {}) => runOp(opByName(name)!, args);
const USDC = DEPLOYED_VENUES[143]!.tokens.USDC!;

describe('operation table', () => {
  test('exactly the read-only set, no write or signing operation', () => {
    expect(OPS.map((o) => o.name)).toEqual([
      'chains',
      'venues',
      'registry',
      'pools',
      'quote',
      'route',
      'depth',
      'marks',
      'ohlc',
    ]);
  });

  test('every positional and required name is a declared param', () => {
    for (const op of OPS) {
      for (const k of [...op.required, ...(op.positional ?? [])])
        expect(op.params[k]).toBeDefined();
      const arrays = (op.positional ?? []).filter((p) => op.params[p]!.type === 'array');
      if (arrays.length) expect(op.positional!.at(-1)).toBe(arrays[0]);
    }
  });

  test('input schema is a closed JSON Schema object', () => {
    const s = opInputSchema(opByName('quote')!);
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['tokenIn', 'tokenOut', 'amounts']);
  });
});

describe('checkArgs', () => {
  const quote = opByName('quote')!;
  test('coerces CLI text: integers, booleans, comma lists', () => {
    expect(
      checkArgs(quote, { chainId: '143', tokenIn: 'USDC', tokenOut: 'WETH', amounts: '1,2' }, true),
    ).toEqual({ chainId: 143, tokenIn: 'USDC', tokenOut: 'WETH', amounts: ['1', '2'] });
    expect(checkArgs(opByName('pools')!, { detail: '' }, true)).toEqual({ detail: true });
  });
  test('refuses unknown, missing, mistyped and out-of-range arguments', () => {
    const base = { tokenIn: 'USDC', tokenOut: 'WETH', amounts: ['1'] };
    expect(() => checkArgs(quote, { ...base, key: 'x' })).toThrow(UsageError);
    expect(() => checkArgs(quote, { tokenIn: 'USDC' })).toThrow(/missing tokenOut/);
    expect(() => checkArgs(quote, { ...base, chainId: '143' })).toThrow(/integer/);
    expect(() => checkArgs(quote, { ...base, chainId: 1.5 })).toThrow(/integer/);
    expect(() => checkArgs(quote, { ...base, slippagePbps: 1 })).toThrow(/>= 100/);
    expect(() => checkArgs(quote, { ...base, amounts: 'x' })).toThrow(/array/);
    expect(() => checkArgs(opByName('marks')!, { status: 'live' })).toThrow(/one of/);
    expect(() => checkArgs(opByName('depth')!, { request: [] })).toThrow(/object/);
  });
});

describe('helpers', () => {
  test('resolveToken: address passthrough, key or symbol, unknown refused', () => {
    expect(resolveToken(143, USDC)).toBe(USDC);
    expect(resolveToken(143, 'usdc')).toBe(USDC);
    expect(() => resolveToken(143, 'NOPE')).toThrow(/unknown token NOPE/);
    expect(() => resolveToken(999_999, 'USDC')).toThrow(/no BTR deployment/);
  });
  test('rawAmount: decimal or 0x to hex; zero, fractions, signs and > 2^256 refused', () => {
    expect(rawAmount('1000000')).toBe('0xf4240');
    expect(rawAmount('0xF4240')).toBe('0xf4240');
    for (const bad of ['0', '0x0', '1.5', '-1', '1e6', '', `0x1${'0'.repeat(64)}`]) {
      expect(() => rawAmount(bad)).toThrow(UsageError);
    }
  });
  test('parseLosslessInts keeps u64 ids past 2^53 exact', () => {
    const rows = parseLosslessInts<{ ticker: string; mid: number }[]>(
      '[{"ticker":432456822424600577,"mid":1.5},{"ticker": 12,"mid":2}]',
    );
    expect(rows[0]!.ticker).toBe('432456822424600577');
    expect(rows[0]!.mid).toBe(1.5);
    expect(rows[1]!.ticker as unknown).toBe(12);
  });
});

describe('operations against recorded fixtures', () => {
  test('chains', async () => {
    fx();
    expect(await run('chains')).toEqual(FIXTURES.chains!.response);
  });

  test('venues: all chains, one chain, unknown chain, all_contracts + superseded passthrough', async () => {
    const all = FIXTURES.venues!.response as Record<string, Record<string, unknown>>;
    fx();
    expect(await run('venues')).toEqual(all);
    expect(await run('venues', { chainId: 143 })).toEqual(all['143']!);
    await expect(run('venues', { chainId: 7 })).rejects.toThrow(/chain 7 not in/);
    const gen = {
      ...all['143']!,
      all_contracts: { poolImpl: '0x1' },
      superseded: [{ label: 'core', status: 'superseded', current: false }],
    };
    restore();
    fx({ venues: { ...all, 143: gen } });
    const v = (await run('venues', { chainId: 143 })) as Record<string, unknown>;
    expect(v.all_contracts).toEqual({ poolImpl: '0x1' });
    expect(v.superseded).toEqual(gen.superseded);
  });

  test('registry: offline SDK records with every generation and its status', async () => {
    const { calls } = fx();
    const one = (await run('registry', { chainId: 143 })) as (typeof DEPLOYED_VENUES)[number];
    expect(one).toBe(DEPLOYED_VENUES[143]!);
    expect(Object.values(one.versions).some((v) => v.status === 'superseded')).toBe(true);
    const all = (await run('registry')) as { chains: unknown[]; venues: unknown };
    expect(all.venues).toBe(DEPLOYED_VENUES);
    expect(calls).toEqual([]);
  });

  test('pools and pools --detail', async () => {
    fx();
    expect(await run('pools', { chainId: 143 })).toEqual(FIXTURES.pools!.response);
    expect(await run('pools', { chainId: 143, detail: true })).toEqual(
      FIXTURES['assets-pools']!.response,
    );
  });

  test('quote: symbols resolved, decimal sizes hexed, the recorded body sent', async () => {
    const { calls } = fx();
    const r = await run('quote', {
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      amounts: ['1000000', '10000000'],
    });
    expect(r).toEqual(FIXTURES['chain-quote']!.response);
    expect(calls[0]!.body).toEqual(FIXTURES['chain-quote']!.body);
  });

  test('quote: size count bounds', async () => {
    fx();
    const many = Array.from({ length: 65 }, () => '1');
    await expect(
      run('quote', { tokenIn: 'USDC', tokenOut: 'WETH', amounts: many }),
    ).rejects.toThrow(/1 to 64/);
    await expect(run('quote', { tokenIn: 'USDC', tokenOut: 'WETH', amounts: [] })).rejects.toThrow(
      /1 to 64/,
    );
  });

  test('route', async () => {
    const { calls } = fx();
    const r = await run('route', { tokenIn: 'USDC', tokenOut: 'WBTC', amountIn: '1000000000' });
    expect(r).toEqual(FIXTURES['chain-route']!.response);
    expect(calls[0]!.body).toEqual(FIXTURES['chain-route']!.body);
  });

  test('route: relative slippage goes on the wire as pbps', async () => {
    const { calls } = fx();
    await run('route', {
      tokenIn: 'USDC',
      tokenOut: 'WBTC',
      amountIn: '1000000000',
      slippagePbps: 5000,
    }).catch(() => {});
    expect((calls[0]!.body as { slippage: unknown }).slippage).toEqual({
      mode: 'relative',
      pbps: 5000,
    });
  });

  test('depth posts the caller body to /v1/depth', async () => {
    const { calls } = fx();
    const r = await run('depth', { request: FIXTURES.depth!.body as Record<string, unknown> });
    expect(r).toEqual(FIXTURES.depth!.response);
    expect(calls[0]).toEqual({ method: 'POST', path: '/v1/depth', body: FIXTURES.depth!.body });
    await expect(run('depth', { request: { from: 'A' } })).rejects.toThrow(UsageError);
  });

  test('marks: per symbol, full list, status filter', async () => {
    fx();
    expect(await run('marks', { symbols: ['BTC-USDC'] })).toEqual({
      'BTC-USDC': FIXTURES['price-BTC-USDC']!.response,
    });
    const rows = FIXTURES.tickers!.response as { status: string; ticker: number }[];
    const all = (await run('marks')) as { ticker: number }[];
    expect(all.length).toBe(rows.length);
    const stale = (await run('marks', { status: 'stale' })) as unknown[];
    expect(stale.length).toBe(rows.filter((r) => r.status === 'stale').length);
  });

  test('ohlc: tf default 3600, query forwarded', async () => {
    const { calls } = fx();
    expect(await run('ohlc', { symbol: 'BTC-USDC', limit: 3 })).toEqual(
      FIXTURES['ohlc-BTC-USDC']!.response,
    );
    expect(calls[0]!.path).toBe('/v1/md/ohlc/BTC-USDC?tf=3600&limit=3');
  });

  test('an API error surfaces as an Error naming the status', async () => {
    fx();
    await expect(run('ohlc', { symbol: 'NOPE-X' })).rejects.toThrow(/BTR API 404/);
  });
});
