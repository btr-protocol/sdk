import { describe, expect, test } from 'bun:test';
import { run } from './btr.ts';
import { riskTiles } from './cmds.ts';
import { covBar, pct, poolTree, usd } from './fmt.ts';

const leg = (symbol: string, o: Record<string, unknown> = {}) => ({
  symbol,
  apy: null,
  apr: null,
  feeApr: 0.01,
  strategyApr: 0,
  tollApr: 0,
  coverage: 1,
  liabilitiesUsd: 100,
  tvlUsd: 100,
  volumeUsd: null,
  investedRatio: 0,
  oracleAgeSec: 10,
  ...o,
});
const SUMMARY = {
  chainId: 143,
  window: '24h',
  protocol: { tvlUsd: 300, volumeUsd: 5, swapCount: 2, feesUsd: 1, protocolSharePct: 0.1 },
  pools: [
    {
      tag: 'btr-core',
      address: '0x1',
      status: 'live',
      apy: 0.0124,
      tvlUsd: 300,
      liabilitiesUsd: 300,
      volumeUsd: 5,
      assets: [
        leg('AUSD', { apy: 0.0115, coverage: 1.23 }),
        leg('CBBTC', { coverage: 0.5, oracleAgeSec: 40 }),
      ],
    },
    {
      tag: 'btr-old',
      address: '0x2',
      status: 'superseded',
      readOnly: true,
      tvlUsd: 0,
      assets: [leg('USDC')],
    },
  ],
};
const mock = (routes: Record<string, unknown>) =>
  (async (url: string) => {
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[hit]));
  }) as unknown as typeof fetch;
const exec = async (argv: string[], routes: Record<string, unknown>) => {
  const lines: string[] = [];
  const code = await run(argv, (s) => lines.push(s), { fetch: mock(routes), base: 'http://x' });
  return { code, text: lines.join('\n') };
};

describe('fmt', () => {
  test('usd / pct / covBar', () => {
    expect(usd(194400)).toBe('$194.4K');
    expect(usd(5920)).toBe('$5.92K');
    expect(usd(null)).toBe('$0.00');
    expect(pct(null)).toBe('0.00%');
    expect(covBar(0.96)).toBe('▮▮▮▮▯ 96%');
    expect(covBar(1.23)).toBe('▮▮▮▮▮ 123%');
  });
  test('tree rails close the group', () => {
    const t = poolTree([
      {
        name: 'P',
        apy: 0.01,
        coverage: 1,
        volumeUsd: 1,
        tvlUsd: 2,
        position: '-',
        assets: [
          { symbol: 'A', apy: 0, coverage: 1, volumeUsd: 0, tvlUsd: 1, position: '-' },
          { symbol: 'B', apy: 0, coverage: null, volumeUsd: 0, tvlUsd: 1, position: '-' },
        ],
      },
    ]);
    expect(t[1]).toStartWith('▾ P');
    expect(t[2]).toContain('├─ A');
    expect(t[3]).toContain('└─ B');
  });
});

describe('risk tiles', () => {
  test('aggregates legs', () => {
    const t = riskTiles([
      leg('A', { coverage: 1.2 }),
      leg('B', { coverage: 0.8, oracleAgeSec: 30 }),
    ]);
    expect(t.legsBelowPar).toBe(1);
    expect(t.worstLegCoverage).toBeCloseTo(0.8);
    expect(t.absSkewBps.lw).toBeCloseTo(2000);
    expect(t.oracleAgeSec.max).toBe(30);
    expect(t.coverage).toBeCloseTo(1);
  });
});

describe('commands (mock API)', () => {
  const routes = { '/v1/summary': SUMMARY };
  test('pools: tree, live only, 0% for no-rate legs', async () => {
    const r = await exec(['pools'], routes);
    expect(r.code).toBe(0);
    expect(r.text).toContain('▾ btr-core');
    expect(r.text).toContain('├─ AUSD');
    expect(r.text).toContain('└─ CBBTC');
    expect(r.text).not.toContain('btr-old');
    expect(r.text).not.toMatch(/Measuring|n\/a/i);
  });
  test('metrics / risk / flow / keepers', async () => {
    expect((await exec(['metrics'], routes)).text).toContain('HOOK APR');
    expect((await exec(['risk'], routes)).text).toContain('Worst-leg coverage');
    const f = await exec(['flow'], {
      '/v1/liquidity': {
        buckets: [
          { poolTag: 'btr-core', symbol: 'USDC', side: 'deposit', amountUsd: 10, eventCount: 1 },
        ],
      },
    });
    expect(f.text).toContain('btr-core/USDC');
    const k = await exec(['keepers'], {
      '/v1/roster': {
        chainId: 143,
        safes: [
          {
            role: 'owner',
            threshold: 3,
            owners: ['a', 'b', 'c', 'd'],
            address: '0x1',
            drift: false,
          },
        ],
      },
      '/v1/health': { status: 'ok' },
      '/v1/summary': SUMMARY,
    });
    expect(k.text).toContain('owner');
    expect(k.text).toContain('3/4');
  });
  test('usage + bad args', async () => {
    expect((await exec(['nope'], {})).code).toBe(2);
    expect((await exec(['pools', '--window', '9y'], routes)).code).toBe(1);
    expect((await exec(['lp', 'deposit'], {})).code).toBe(1);
  });
});
