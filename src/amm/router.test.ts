import { describe, expect, test } from 'bun:test';
import type { PoolAsset } from '../pool/index';
import { poolStateFrom } from './index';
import { STABLE_PROFILE, sigmaSeed } from './profiles';

const BASE = 'USDC';

describe('poolStateFrom (on-chain bigint reads → PoolState)', () => {
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
