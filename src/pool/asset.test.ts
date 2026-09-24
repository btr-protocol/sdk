import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { type AbiParameter, decodeFn, encodeAbiParameters } from '../eth/abi';
import type { Hex } from '../eth/types';
import { getAsset, getSwapQuote, toAsset } from './index';

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
  kappaCovBps: 1500n,
  maxLiabWeightBps: 0n,
  oracleBits: 0n,
  refBandBps: 0n,
};
const encoded = encodeAbiParameters(getAssetOutputs, [row]) as Hex;

describe('toAsset — a decoded getAsset tuple is shaped as `Asset` says (A-104)', () => {
  test('the decoder really does hand the uint16 fields back as bigint', () => {
    const raw = decodeFn<Record<string, unknown>>({
      abi: POOL_ABI,
      functionName: 'getAsset',
      data: encoded,
    });
    expect(typeof raw.kappaCovBps).toBe('bigint');
  });

  test('every small field becomes a number; the 96/128-bit books stay bigint', () => {
    const a = toAsset(decodeFn({ abi: POOL_ABI, functionName: 'getAsset', data: encoded }));
    expect(a.kappaCovBps).toBe(1500);
    expect(a.maxLiabWeightBps).toBe(0);
    expect(a.flags).toBe(7);
    expect(a.decimals).toBe(6);
    expect(a.curveId).toBe(5);
    expect(a.reserves).toBe(1_000_000n);
    expect(a.liquidityIndexWad).toBe(10n ** 18n);
  });

  test('a field the ABI did not carry is NaN, never 0', () => {
    const { kappaCovBps: _drop, ...stale } = row;
    const a = toAsset(stale);
    expect(Number.isNaN(a.kappaCovBps)).toBe(true);
    expect(toAsset({ ...row, flags: null }).flags).toBeNaN();
  });

  test('getAsset returns the shaped row', async () => {
    const provider = { request: async () => encoded } as never;
    const a = await getAsset(provider, row.anchor as Hex, row.anchor as Hex);
    expect(a.kappaCovBps).toBe(1500);
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
