import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { type AbiParameter, decodeFn, encodeAbiParameters } from '../eth/abi';
import type { Hex } from '../eth/types';
import { packCov, packKnee } from './cov';
import { getAsset, getSwapQuote, riskConfigOf, toAsset } from './index';

const getAssetOutputs = (POOL_ABI as readonly { name?: string; outputs?: AbiParameter[] }[]).find(
  (f) => f.name === 'getAsset',
)?.outputs as AbiParameter[];

const row = {
  reserves: 1_000_000n,
  liabilities: 900_000n,
  anchor: '0x0000000000000000000000000000000000000000',
  minLiquidity: 0n,
  liquidityIndexWad: 10n ** 18n,
  minDispersionPbps: 2034n,
  curveId: 5n,
  minFeePbps: 90n,
  vegaBps: 4000n,
  depositCapCode: 0n,
  decimals: 6n,
  deadSeedPow10: 3n,
  flags: 7n,
  maxLiabWeightBps: 0n,
  oracleBits: 0n,
  covBits: 0n,
  kneeBits: 0n,
};
const encoded = encodeAbiParameters(getAssetOutputs, [row]) as Hex;

describe('toAsset — a decoded getAsset tuple is shaped as `Asset` says', () => {
  test('the decoder really does hand the uint16 fields back as bigint', () => {
    const raw = decodeFn<Record<string, unknown>>({
      abi: POOL_ABI,
      functionName: 'getAsset',
      data: encoded,
    });
    expect(typeof raw.maxLiabWeightBps).toBe('bigint');
    expect(typeof raw.covBits).toBe('bigint');
  });

  test('every small field becomes a number; the 96/128-bit books stay bigint', () => {
    const a = toAsset(decodeFn({ abi: POOL_ABI, functionName: 'getAsset', data: encoded }));
    expect(a.maxLiabWeightBps).toBe(0);
    expect(a.flags).toBe(7);
    expect(a.decimals).toBe(6);
    expect(a.curveId).toBe(5);
    expect(a.reserves).toBe(1_000_000n);
    expect(a.liquidityIndexWad).toBe(10n ** 18n);
  });

  test('a field the ABI did not carry is NaN, never 0', () => {
    const { covBits: _drop, ...stale } = row;
    const a = toAsset(stale);
    expect(Number.isNaN(a.covBits)).toBe(true);
    expect(toAsset({ ...row, flags: null }).flags).toBeNaN();
  });

  test('getAsset returns the shaped row', async () => {
    const provider = { request: async () => encoded } as never;
    const a = await getAsset(provider, row.anchor as Hex, row.anchor as Hex);
    expect(a.flags).toBe(7);
  });
});

describe('getSwapQuote returns the uint16/int8 fields as numbers', () => {
  const outputs = (POOL_ABI as readonly { name?: string; outputs?: AbiParameter[] }[]).find(
    (f) => f.name === 'getSwapQuote',
  )?.outputs as AbiParameter[];
  const quote = {
    amountOut: 990n,
    amountIn: 1_000n,
    spreadPbps: 459n,
    protoFee: 1n,
    lpFee: 2n,
    skewIn: -3n,
    skewOut: 4n,
    markPrice: 10n ** 18n,
    midPrice: 10n ** 18n,
    covToll: 0n,
    routeHops: [],
    hopAmounts: [],
    hopPrices: [],
  };

  test('spreadPbps / skewIn / skewOut are numbers, the amounts stay bigint', async () => {
    const encoded = encodeAbiParameters(outputs, [quote]) as Hex;
    const provider = { request: async () => encoded } as never;
    const zero = row.anchor as Hex;
    const q = await getSwapQuote(provider, zero, zero, zero, 1_000n);
    expect(q.spreadPbps).toBe(459);
    expect(q.skewIn).toBe(-3);
    expect(q.skewOut).toBe(4);
    expect(q.spreadPbps / 1e6).toBeCloseTo(0.000459);
    expect(q.amountOut).toBe(990n);
    expect(q.routeHops).toEqual([]);
  });
});

describe('riskConfigOf — coverage terms unpacked from Asset.covBits / kneeBits', () => {
  test('c_min | t | flat | c_max | κ⁻ | κ⁺ and the knee', () => {
    // c_min 10%, t 1.0070, flat 5%, c_max 2.35, κ⁻ 32, κ⁺ 14336; knee c_k 20%, κ₂ 64
    const cov = packCov({
      covMinBps: 1000,
      covTargetBps: 10_070,
      covFlatBps: 500,
      covMaxBps: 23_500,
      kappaCovBps: 32,
      kappaPosBps: 14_336,
    });
    const knee = packKnee(1000, { kneeCovBps: 2000, kappaKneeBps: 64 });
    const a = toAsset({ ...row, covBits: BigInt(cov), kneeBits: BigInt(knee) });
    expect(riskConfigOf(a)).toMatchObject({
      kappaCovBps: 32,
      covMinBps: 1000,
      covTargetBps: 10_070,
      covFlatBps: 500,
      covMaxBps: 23_500,
      kappaPosBps: 14_336,
      kneeCovBps: 2000,
      kappaKneeBps: 64,
    });
  });
});
