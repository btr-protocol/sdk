import { describe, expect, test } from 'bun:test';
import { buildSwapCalls, totalValue, type ExecLeg } from './index.js';

const USER = '0x00000000000000000000000000000000000000AA' as const;
const USDC = '0x0000000000000000000000000000000000000001' as const;
const USDT = '0x0000000000000000000000000000000000000002' as const;
const POOL_S = '0x0000000000000000000000000000000000000010' as const;
const POOL_V = '0x0000000000000000000000000000000000000020' as const;

const SWAP_SEL = '0xd5bcb9b5'; // swap(address,address,uint256,uint256,address)
const APPROVE_SEL = '0x095ea7b3'; // approve(address,uint256)

describe('buildSwapCalls', () => {
  test('single direct leg → [approve, swap]', () => {
    const legs: ExecLeg[] = [{ pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n }];
    const calls = buildSwapCalls(legs, { recipient: USER });
    expect(calls.length).toBe(2);
    expect(calls[0].to.toLowerCase()).toBe(USDC.toLowerCase()); // approve on the token
    expect(calls[0].data.startsWith(APPROVE_SEL)).toBe(true);
    expect(calls[1].to.toLowerCase()).toBe(POOL_S.toLowerCase()); // swap on the pool
    expect(calls[1].data.startsWith(SWAP_SEL)).toBe(true);
    expect(totalValue(calls)).toBe(0n);
  });

  test('split across two pools (same tokenIn) → 2 approvals (distinct spenders) + 2 swaps, approvals first', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 700n, minOut: 696n },
      { pool: POOL_V, tokenIn: USDC, tokenOut: USDT, amountIn: 300n, minOut: 298n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER });
    expect(calls.length).toBe(4);
    expect(calls.slice(0, 2).every((c) => c.data.startsWith(APPROVE_SEL))).toBe(true);
    expect(calls.slice(2).every((c) => c.data.startsWith(SWAP_SEL))).toBe(true);
    expect(new Set(calls.slice(0, 2).map((c) => c.to.toLowerCase())).size).toBe(1); // same token
  });

  test('needsApproval=false skips approvals (cached allowance)', () => {
    const legs: ExecLeg[] = [{ pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n }];
    const calls = buildSwapCalls(legs, { recipient: USER, needsApproval: () => false });
    expect(calls.length).toBe(1);
    expect(calls[0].data.startsWith(SWAP_SEL)).toBe(true);
  });

  test('native-in leg → no approval, value = amountIn', () => {
    const legs: ExecLeg[] = [{ pool: POOL_V, tokenIn: USDC, tokenOut: USDT, amountIn: 5n, minOut: 4n, native: true }];
    const calls = buildSwapCalls(legs, { recipient: USER });
    expect(calls.length).toBe(1);
    expect(calls[0].value).toBe(5n);
    expect(totalValue(calls)).toBe(5n);
  });

  test('dedup approvals for the same (token,pool) across legs', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 500n, minOut: 498n },
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 500n, minOut: 498n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER });
    expect(calls.filter((c) => c.data.startsWith(APPROVE_SEL)).length).toBe(1);
    expect(calls.filter((c) => c.data.startsWith(SWAP_SEL)).length).toBe(2);
  });
});
