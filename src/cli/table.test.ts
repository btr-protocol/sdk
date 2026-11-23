import { afterAll, describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { type AbiParameter, encodeAbiParameters, encodeFn } from '../eth/abi.js';
import { ERC20_ABI } from '../eth/erc20.js';
import type { Address } from '../eth/types.js';
import { buildSwapLiabilityCalls, depositCallData } from '../router/index.js';
import { run } from './btr.ts';
import { call, handle } from './mcp.ts';
import { TABLE, toolName } from './table.ts';

const FROM = '0x00000000000000000000000000000000000000aa';
const dummy = (p: string) => (p === 'amount' || p === 'lp-raw' ? '1' : `x-${p}`);
const cliArgv = (c: (typeof TABLE)[number]) => [
  c.name,
  ...(c.pos ?? []).map(dummy),
  ...Object.entries(c.args ?? {})
    .filter(([, v]) => v.required)
    .flatMap(([k, v]) => [`--${k}`, v.type === 'object' ? '{}' : '1']),
];
const mcpArgs = (c: (typeof TABLE)[number]) => ({
  ...Object.fromEntries((c.pos ?? []).map((p) => [p, dummy(p)])),
  ...Object.fromEntries(
    Object.entries(c.args ?? {})
      .filter(([, v]) => v.required)
      .map(([k, v]) => [k, v.type === 'object' ? {} : '1']),
  ),
});

describe('one table drives CLI and MCP', () => {
  const real = TABLE.map((c) => c.run);
  afterAll(() => TABLE.forEach((c, i) => (c.run = real[i])));
  for (const c of TABLE)
    c.run = async (a) => ({ data: { hit: c.name, pos: a.pos, flags: [...a.flags] } });

  test('every entry is a CLI command', async () => {
    for (const c of TABLE) {
      const lines: string[] = [];
      expect(await run([...cliArgv(c), '--chain', '143'], (s) => lines.push(s))).toBe(0);
      expect(JSON.parse(lines.join('\n')).hit).toBe(c.name);
    }
  });
  test('every entry is an MCP tool with the same handler and args', async () => {
    const list = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: { name: string; inputSchema: { required: string[] } }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(TABLE.map(toolName));
    for (const c of TABLE) {
      const r = (await call(toolName(c), { chain: 143, ...mcpArgs(c) })) as {
        hit: string;
        pos: string[];
      };
      expect(r.hit).toBe(c.name);
      expect(r.pos).toEqual((c.pos ?? []).map(dummy));
    }
  });
  test('required capabilities present; builds are the only build kind', () => {
    const names = TABLE.map(toolName);
    for (const n of [
      'pools',
      'metrics',
      'risk',
      'flow',
      'keepers',
      'quote',
      'depth',
      'lp_preview',
      'debt_swap_quote',
      'lp_rows',
      'build_swap',
      'build_approve',
      'build_deposit',
      'build_withdraw',
      'build_debt_swap',
      'registry',
      'pool_list',
      'roster',
      'abi',
      'abis',
      'timeseries',
      'liquidity',
      'activity',
      'pool_params',
      'density',
      'oracle_pushes',
      'safety_history',
      'safety_breakers',
      'md_tickers',
      'md_price',
      'md_ohlc',
      'assets',
      'pool_assets',
      'pool_metrics',
      'indicators',
    ])
      expect(names).toContain(n);
    expect(TABLE.filter((c) => c.kind === 'build').every((c) => c.name.startsWith('build-'))).toBe(
      true,
    );
  });
  test('missing positional: CLI usage 2, MCP error', async () => {
    expect(await run(['build-deposit'], () => {})).toBe(2);
    await expect(call('build_deposit', {})).rejects.toThrow('required');
  });
});

// ── builders: CLI/MCP output equals the SDK builders ────────────────────────────
const POOL = '0xbbbbbbbd7060b1CED79c381eAD40d73FcB9Ae0C6' as Address;
const outputs = (POOL_ABI as readonly { name?: string; outputs?: AbiParameter[] }[]).find(
  (f) => f.name === 'getAsset',
)?.outputs as AbiParameter[];
const asset = encodeAbiParameters(outputs, [
  {
    reserves: 0n,
    liabilities: 0n,
    anchor: '0x0000000000000000000000000000000000000000',
    minLiquidity: 0n,
    liquidityIndexWad: 10n ** 18n,
    minDispersionPbps: 0n,
    curveId: 0n,
    minFeePbps: 0n,
    vegaBps: 0n,
    depositCapCode: 0n,
    decimals: 6n,
    deadSeedPow10: 0n,
    flags: 0n,
    maxLiabWeightBps: 0n,
    oracleBits: 0n,
    covBits: 0n,
    kneeBits: 0n,
  },
]);
const sel = (functionName: string, args: unknown[]) =>
  encodeFn({ abi: POOL_ABI, functionName, args }).slice(0, 10);
const Z = '0x0000000000000000000000000000000000000000';
/** On-chain previews the builds floor off: deposit mints 1000, previewWithdraw pays 2000, swapLiability 3000. */
const PREVIEW = { deposit: 1000n, withdraw: 2000n, debt: 3000n };
const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`;
const replies: Record<string, string> = {
  [sel('deposit', [Z, 0n])]: word(PREVIEW.deposit) + word(0n).slice(2) + word(0n).slice(2),
  [sel('previewWithdraw', [Z, 0n])]: word(PREVIEW.withdraw) + word(0n).slice(2),
  [sel('swapLiability', [Z, Z, 0n, 0n, 0n])]: word(PREVIEW.debt),
};
const fetchMock = (async (url: string, init?: RequestInit) => {
  if (!String(url).includes('/v1/rpc')) return new Response('', { status: 500 });
  const data = (JSON.parse(String(init?.body ?? '{}')).params?.[0]?.data ?? '') as string;
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: replies[data.slice(0, 10)] ?? asset }),
  );
}) as unknown as typeof fetch;
const o = { fetch: fetchMock, base: 'http://x', fallback: 'baked' as const };
const build = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await run(argv, (s) => lines.push(s), o);
  expect(code).toBe(0);
  return JSON.parse(lines.join('\n'));
};
const tok = async (s: string) =>
  (await (await import('../venues/live.js')).fetchRegistry(143, o)).tokens[s] as Address;

const fail = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await run(argv, (s) => lines.push(s), o);
  return { code, out: lines.join('\n') };
};
const DEP = ['build-deposit', 'btr-core', 'USDC', '2.5', '--from', FROM, '--chain', '143'];

describe('build calldata = SDK builders', () => {
  test('build-deposit: floor = simulated mint less default 50 bps', async () => {
    const r = await build(DEP);
    const usdc = await tok('USDC');
    const floor = (PREVIEW.deposit * 9_950n) / 10_000n;
    expect(r.minRaw).toBe(floor.toString());
    expect(r.calls).toEqual([
      {
        from: FROM,
        to: usdc,
        data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [POOL, 2_500_000n] }),
        value: '0',
      },
      { from: FROM, to: POOL, data: depositCallData(usdc, 2_500_000n, floor), value: '0' },
    ]);
    const m = (await call(
      'build_deposit',
      { chain: 143, pool: 'btr-core', symbol: 'USDC', amount: '2.5', from: FROM },
      o,
    )) as { calls: unknown[] };
    expect(
      JSON.parse(JSON.stringify(m.calls, (_, x) => (typeof x === 'bigint' ? x.toString() : x))),
    ).toEqual(r.calls);
  });
  test('honest --min-out inside the cap is encoded unchanged', async () => {
    const r = await build([...DEP, '--min-out', '990']);
    expect(r.calls[1].data).toBe(depositCallData(await tok('USDC'), 2_500_000n, 990n));
  });
  test('--slippage-bps sets the floor; out of range or above the cap refused', async () => {
    expect((await build([...DEP, '--slippage-bps', '100'])).minRaw).toBe('990');
    for (const bp of ['0', '10000', '9991', '-1', '1.5'])
      expect((await fail([...DEP, '--slippage-bps', bp])).code).not.toBe(0);
  });
  test('--min-out below preview less the cap, or above the preview, refused', async () => {
    // cap 9990 bps of 1000 -> lowest 1
    expect((await fail([...DEP, '--min-out', '1'])).code).toBe(0);
    expect((await fail([...DEP, '--min-out', '1001'])).code).not.toBe(0);
    expect((await fail([...DEP, '--min-out', '0'])).code).not.toBe(0);
  });
  test('build-debt-swap', async () => {
    const r = await build([
      'build-debt-swap',
      'btr-core',
      'USDC',
      'AUSD',
      '1000',
      '--from',
      FROM,
      '--min-out',
      '2990',
      '--chain',
      '143',
    ]);
    expect(r.calls).toHaveLength(1);
    const [usdc, ausd] = [await tok('USDC'), await tok('AUSD')];
    // deadline is read at build time: compare everything but the last word
    const sdk = buildSwapLiabilityCalls(POOL, {
      tokenFrom: usdc,
      tokenTo: ausd,
      lpAmountIn: 1000n,
      minLpAmountOut: 2990n,
    });
    expect(r.calls[0].from).toBe(FROM);
    expect(r.calls[0].to).toBe(POOL);
    expect(r.calls[0].data.slice(0, -64)).toBe(sdk[0].data.slice(0, -64));
    const d = await build([
      'build-debt-swap',
      'btr-core',
      'USDC',
      'AUSD',
      '1000',
      '--from',
      FROM,
      '--chain',
      '143',
    ]);
    expect(d.minRaw).toBe(((PREVIEW.debt * 9_950n) / 10_000n).toString());
  });
  test('build-withdraw takes lp-raw shares, floored off previewWithdraw', async () => {
    const r = await build([
      'build-withdraw',
      'btr-core',
      'USDC',
      '1000000',
      '--from',
      FROM,
      '--chain',
      '143',
    ]);
    const dl = BigInt(`0x${r.calls[0].data.slice(-64)}`);
    expect(r.calls[0].from).toBe(FROM);
    expect(r.calls[0].data).toBe(
      encodeFn({
        abi: POOL_ABI,
        functionName: 'withdraw',
        args: [await tok('USDC'), 1_000_000n, (PREVIEW.withdraw * 9_950n) / 10_000n, dl],
      }),
    );
    expect(r.lpRaw).toBe('1000000');
    expect(r.lossBps).toBe(50);
    const bad = ['build-withdraw', 'btr-core', 'USDC', '1.5', '--from', FROM, '--chain', '143'];
    expect((await fail(bad)).code).not.toBe(0);
  });
  test('MCP caps slippage at 500 bps; CLI keeps the front cap', async () => {
    const args = { chain: 143, pool: 'btr-core', symbol: 'USDC', amount: '2.5', from: FROM };
    type B = { lossBps: number; minRaw: string };
    const ok = (await call('build_deposit', { ...args, 'slippage-bps': '500' }, o)) as B;
    expect([ok.lossBps, ok.minRaw]).toEqual([500, '950']);
    await expect(call('build_deposit', { ...args, 'slippage-bps': '501' }, o)).rejects.toThrow(
      '500 cap',
    );
    // preview 1000: MCP lowest min-out is 950
    const edge = (await call('build_deposit', { ...args, 'min-out': '950' }, o)) as B;
    expect(edge.lossBps).toBe(500);
    await expect(call('build_deposit', { ...args, 'min-out': '949' }, o)).rejects.toThrow(
      '500 bps cap',
    );
    expect((await build([...DEP, '--slippage-bps', '9000'])).lossBps).toBe(9000);
    expect((await build([...DEP, '--min-out', '949'])).lossBps).toBe(510);
  });
});

describe('MCP tool schema', () => {
  test('build tools state the 500 bps cap', async () => {
    const { TOOLS } = await import('./mcp.ts');
    const t = TOOLS.find((x) => x.name === 'build_withdraw');
    expect(t?.description).toContain('500 bps');
    expect(JSON.stringify(t?.inputSchema)).not.toContain('9990');
    expect(t?.inputSchema.required).toContain('lp-raw');
  });
  test('lossBps', async () => {
    const { lossBps } = await import('../pool/slippage.js');
    expect(lossBps(10_000n, 9_950n)).toBe(50);
    expect(lossBps(3n, 2n)).toBe(3333);
  });
});

describe('floorFromPreview', () => {
  test('derivation, cap, zero refusal', async () => {
    const { floorFromPreview, MAX_SLIPPAGE_BPS } = await import('../pool/slippage.js');
    expect(floorFromPreview(10_000n, 50)).toBe(9_950n);
    expect(floorFromPreview(10_000n, 50, 9_000n)).toBe(9_000n);
    expect(floorFromPreview(10_000n, 50, 10n)).toBe(10n); // exactly preview less the cap
    expect(() => floorFromPreview(10_000n, 50, 9n)).toThrow('cap');
    expect(() => floorFromPreview(10_000n, 50, 10_001n)).toThrow('above');
    expect(() => floorFromPreview(0n, 50)).toThrow('zero');
    expect(() => floorFromPreview(1n, MAX_SLIPPAGE_BPS)).toThrow('zero');
  });
});

describe('build-swap recipient', () => {
  const SW = ['build-swap', 'USDC', 'AUSD', '1', '--from', FROM, '--chain', '143'];
  test('zero, pool and token recipients refused before any quote', async () => {
    for (const r of [Z, POOL, await tok('USDC')]) {
      const f = await fail([...SW, '--recipient', r]);
      expect(f.code).not.toBe(0);
    }
  });
  test('default recipient = --from passes the check (fails later on the mocked quote)', async () => {
    const lines: string[] = [];
    const errs: string[] = [];
    const orig = console.error;
    console.error = (m: unknown) => void errs.push(String(m));
    try {
      await run(SW, (s) => lines.push(s), o);
    } finally {
      console.error = orig;
    }
    expect(errs.join('\n')).not.toContain('--recipient');
  });
});
