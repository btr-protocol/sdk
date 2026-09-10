// bun test: route-composed depth is backend SSOT (hub pairs via POST /v1/depth), and
// the on-chain bigint pool reads convert to the PoolState the wire build consumes.
import { afterEach, describe, expect, test } from 'bun:test';
import type { PoolAsset } from '../pool/index';
import { aggregatePairDepthAsync } from '../router/depth.js';
import type { NamedPool } from '../router/route.js';
import { poolStateFrom } from './index';
import { STABLE_PROFILE, sigmaSeed } from './profiles';

const wire = {
  mark: 1,
  mid: 1.0001,
  bid: 0.9999,
  ask: 1.0003,
  bid_net: 0.9998,
  ask_net: 1.0004,
  step: 0.0001,
  bids: [{ price: 0.9998, size: 10, cum: 10 }],
  asks: [{ price: 1.0004, size: 12, cum: 12 }],
  poolCount: 1,
};

const pools = (): NamedPool[] => [
  {
    tag: 'core',
    state: {
      base: 'USDC',
      legs: {},
    },
  },
];

afterEach(() => {
  // @ts-expect-error restore the real fetch
  globalThis.fetch = undefined;
});

describe('aggregatePairDepthAsync', () => {
  test('hub pair POSTs /depth and maps the wire book', async () => {
    let path = '';
    // @ts-expect-error stub fetch
    globalThis.fetch = async (url: string) => {
      path = String(url);
      return { ok: true, json: async () => wire };
    };
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], {
      base: 'https://q.example/v1',
    });
    expect(path).toBe('https://q.example/v1/depth');
    expect(book?.mid).toBe(1.0001);
    expect(book?.bidNet).toBe(0.9998);
    expect(book?.poolCount).toBe(1);
  });

  test('invert reciprocates the wire book', async () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: true, json: async () => wire });
    const book = await aggregatePairDepthAsync(pools(), 'USDC', 'USDT', [], { invert: true });
    expect(book?.mid).toBeCloseTo(1 / 1.0001, 12);
    expect(book?.bids.length).toBe(1);
  });

  test('same-token pair resolves to null without a round trip', async () => {
    let called = false;
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, json: async () => wire };
    };
    expect(await aggregatePairDepthAsync(pools(), 'USDC', 'USDC', [])).toBeNull();
    expect(called).toBe(false);
  });
});

describe('poolStateFrom (on-chain bigint reads → PoolState)', () => {
  const BASE = 'USDC';
  const asset = (symbol: string, decimals: number, res: bigint, liab: bigint): PoolAsset => ({
    token: '0x0000000000000000000000000000000000000003',
    symbol,
    name: symbol,
    decimals,
    reserves: res,
    liabilities: liab,
    coverage: 0n,
  });

  test('base carries no leg; spokes convert via their decimals; feedless spokes skipped', () => {
    const assets = [
      asset(BASE, 6, 1_000_000_000_000n, 900_000_000_000n),
      asset('USDT', 18, 500_000n * 10n ** 18n, 400_000n * 10n ** 18n),
      asset('WOOF', 18, 10n ** 18n, 10n ** 18n),
    ];
    const state = poolStateFrom(assets, BASE, (sym) =>
      sym === 'USDT' ? { twap: 1, sigma: sigmaSeed('stable'), profile: STABLE_PROFILE } : undefined,
    );
    expect(state.base).toBe(BASE);
    expect(Object.keys(state.legs)).toEqual(['USDT']);
    expect(state.legs.USDT.res).toBeCloseTo(500_000, 6);
    expect(state.legs.USDT.liab).toBeCloseTo(400_000, 6);
    expect(state.legs.USDT.baseRes).toBeCloseTo(1_000_000, 6);
    expect(state.legs.USDT.decimals).toBe(18);
    expect(state.legs.USDT.kappaCovBps).toBe(0);
    // the converted state carries the leg for the backend wire build
    expect(state.legs.USDT.profile.curve.m).toBeGreaterThan(0);
  });
});
