import { expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { encodeFn } from '../eth/abi.js';
import type { Address } from '../eth/types.js';
import { buildDepositCalls, buildRedeemCalls, buildSwapLiabilityCalls } from './index.js';

const POOL = '0x1111111111111111111111111111111111111111' as Address;
const A = '0x2222222222222222222222222222222222222222' as Address;
const B = '0x3333333333333333333333333333333333333333' as Address;
const DL = BigInt(Math.floor(Date.now() / 1000) + 600);

// front/src/hooks/usePoolData.ts `swapLiabilityData`, verbatim shape.
const frontSwapLiabilityData = (
  from: Address,
  to: Address,
  lp: bigint,
  floor: bigint,
  dl: bigint,
) => encodeFn({ abi: POOL_ABI, functionName: 'swapLiability', args: [from, to, lp, floor, dl] });

// Hand-built ABI fixture: swapLiability selector + 5 static words.
const word = (x: string) => x.padStart(64, '0');
const FIXTURE = `0x076e66f8${[A, B].map((x) => word(x.slice(2))).join('')}${[
  10n ** 18n,
  99n * 10n ** 16n,
  DL,
]
  .map((x) => word(x.toString(16)))
  .join('')}`;

test('buildSwapLiabilityCalls = front encoding, byte for byte', () => {
  const [c] = buildSwapLiabilityCalls(
    POOL,
    { tokenFrom: A, tokenTo: B, lpAmountIn: 10n ** 18n, minLpAmountOut: 99n * 10n ** 16n },
    { deadline: DL },
  );
  expect(c.to).toBe(POOL);
  expect(c.value).toBe(0n);
  expect(c.data).toBe(frontSwapLiabilityData(A, B, 10n ** 18n, 99n * 10n ** 16n, DL));
  expect(c.data.toLowerCase()).toBe(FIXTURE.toLowerCase());
});

test('deposit/redeem transfer routes carry the same swapLiability bytes', () => {
  const sl = frontSwapLiabilityData(A, B, 5n, 4n, DL);
  const dep = buildDepositCalls(
    POOL,
    {
      mode: 'transfer',
      token: A,
      amount: 7n,
      targetToken: B,
      lpAmountIn: 5n,
      minLpAmountOut: 4n,
      minLpOut: 6n,
    },
    { recipient: A, deadline: DL },
  );
  expect(dep.at(-1)?.data).toBe(sl);
  const red = buildRedeemCalls(
    POOL,
    {
      mode: 'transfer',
      tokenFrom: A,
      tokenTo: B,
      lpAmountIn: 5n,
      minLpAmountOut: 4n,
      lpWithdraw: 4n,
      minAmountOut: 1n,
    },
    { recipient: A, deadline: DL },
  );
  expect(red[0].data).toBe(sl);
});

test('zero floor refused', () => {
  expect(() =>
    buildSwapLiabilityCalls(POOL, { tokenFrom: A, tokenTo: B, lpAmountIn: 1n, minLpAmountOut: 0n }),
  ).toThrow('positive floor');
});
