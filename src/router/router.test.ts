import { describe, expect, test } from 'bun:test';
import type { SwapPlan } from '../amm/router.js';
import { NATIVE_TOKEN } from '../pool/index.js';
import { type ExecLeg, type TokenMeta, buildSwapCalls, planToLegs, totalValue } from './index.js';

const USER = '0x00000000000000000000000000000000000000AA' as const;
const USDC = '0x0000000000000000000000000000000000000001' as const;
const USDT = '0x0000000000000000000000000000000000000002' as const;
const POOL_S = '0x0000000000000000000000000000000000000010' as const;
const POOL_V = '0x0000000000000000000000000000000000000020' as const;

const SWAP_SEL = '0xd5bcb9b5'; // swap(address,address,uint256,uint256,address)
const APPROVE_SEL = '0x095ea7b3'; // approve(address,uint256)

describe('buildSwapCalls', () => {
  test('single direct leg → [approve, swap]', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n },
    ];
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
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER, needsApproval: () => false });
    expect(calls.length).toBe(1);
    expect(calls[0].data.startsWith(SWAP_SEL)).toBe(true);
  });

  test('native-in leg → no approval, value = amountIn', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_V, tokenIn: USDC, tokenOut: USDT, amountIn: 5n, minOut: 4n, native: true },
    ];
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

describe('planToLegs', () => {
  const META: Record<string, TokenMeta> = {
    USDC: { address: USDC, decimals: 6 },
    USDT: { address: USDT, decimals: 18 },
    BNB: { address: NATIVE_TOKEN, decimals: 18 },
  };
  const tokenOf = (s: string) => META[s];
  const direct = (poolAddr: string | undefined, tokenIn: string, tokenOut: string) => ({
    legs: [{ poolTag: 't', poolAddr, tokenIn, tokenOut }],
    tokens: [tokenIn, tokenOut],
    hops: 1,
  });
  const mustLegs = (legs: ExecLeg[] | null): ExecLeg[] => {
    if (!legs) throw new Error('expected legs');
    return legs;
  };

  test('direct part → 1 leg, float→bigint via token decimals, per-leg slippage floor', () => {
    const route = direct(POOL_S, 'USDC', 'USDT');
    const plan: SwapPlan = {
      amountIn: 100,
      amountOut: 99,
      isSplit: false,
      parts: [
        {
          route,
          fraction: 1,
          quote: { route, amountIn: 100, amountOut: 99, fills: [], maxIn: 1e6 },
        },
      ],
    };
    const legs = mustLegs(planToLegs(plan, { slippageFrac: 0.25, tokenOf }));
    expect(legs.length).toBe(1);
    expect(legs[0].amountIn).toBe(100_000_000n); // 100 USDC @ 6 decimals
    expect(legs[0].minOut).toBe(74_250_000_000_000_000_000n); // 99·0.75 @ 18 decimals
    expect(legs[0].native).toBe(false);
  });

  test('cross-pool part → 2 legs; leg2.amountIn = leg1.minOut; native sentinel flags leg1', () => {
    const route = {
      legs: [
        { poolTag: 'v', poolAddr: POOL_V, tokenIn: 'BNB', tokenOut: 'USDC' },
        { poolTag: 's', poolAddr: POOL_S, tokenIn: 'USDC', tokenOut: 'USDT' },
      ],
      tokens: ['BNB', 'USDC', 'USDT'],
      hops: 2,
    };
    const plan: SwapPlan = {
      amountIn: 1,
      amountOut: 599,
      isSplit: false,
      parts: [
        {
          route,
          fraction: 1,
          quote: {
            route,
            amountIn: 1,
            amountOut: 599,
            fills: [
              { leg: route.legs[0], amountIn: 1, amountOut: 600 },
              { leg: route.legs[1], amountIn: 600, amountOut: 599 },
            ],
            maxIn: 10,
          },
        },
      ],
    };
    const legs = mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf }));
    expect(legs.length).toBe(2);
    expect(legs[0].native).toBe(true);
    expect(legs[0].minOut).toBe(600_000_000n); // bridged USDC @ 6 decimals
    expect(legs[1].amountIn).toBe(legs[0].minOut);
    expect(legs[1].native).toBe(false);
  });

  test('split parts emit largest first', () => {
    const rs = direct(POOL_S, 'USDC', 'USDT');
    const rv = direct(POOL_V, 'USDC', 'USDT');
    const plan: SwapPlan = {
      amountIn: 1000,
      amountOut: 998,
      isSplit: true,
      parts: [
        {
          route: rv,
          fraction: 0.25,
          quote: { route: rv, amountIn: 250, amountOut: 249, fills: [], maxIn: 1e6 },
        },
        {
          route: rs,
          fraction: 0.75,
          quote: { route: rs, amountIn: 750, amountOut: 749, fills: [], maxIn: 1e6 },
        },
      ],
    };
    const legs = mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf }));
    expect(legs.map((l) => l.pool)).toEqual([POOL_S, POOL_V]);
    expect(legs[0].amountIn).toBe(750_000_000n);
  });

  test('missing pool address or token meta → null', () => {
    const noAddr = direct(undefined, 'USDC', 'USDT');
    const noMeta = direct(POOL_S, 'USDC', 'WOOF');
    const part = (route: typeof noAddr) => ({
      route,
      fraction: 1,
      quote: { route, amountIn: 1, amountOut: 1, fills: [], maxIn: 1 },
    });
    expect(
      planToLegs(
        { amountIn: 1, amountOut: 1, isSplit: false, parts: [part(noAddr)] },
        { slippageFrac: 0, tokenOf },
      ),
    ).toBeNull();
    expect(
      planToLegs(
        { amountIn: 1, amountOut: 1, isSplit: false, parts: [part(noMeta)] },
        { slippageFrac: 0, tokenOf },
      ),
    ).toBeNull();
  });
});
