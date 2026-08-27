import { describe, expect, test } from 'bun:test';
import type { SwapPlan } from '../amm/router.js';
import { type ExecLeg, type TokenMeta, buildSwapCalls, planToLegs, totalValue } from './index.js';

const USER = '0x00000000000000000000000000000000000000AA' as const;
const USDC = '0x0000000000000000000000000000000000000001' as const;
const USDT = '0x0000000000000000000000000000000000000002' as const;
const WNATIVE = '0x0000000000000000000000000000000000000003' as const;
const POOL_S = '0x0000000000000000000000000000000000000010' as const;
const POOL_V = '0x0000000000000000000000000000000000000020' as const;

const SWAP_SEL = '0x9908fc8b'; // swap(address,address,uint256,uint256,address,uint256)
const APPROVE_SEL = '0x095ea7b3'; // approve(address,uint256)
const DEPOSIT_SEL = '0xd0e30db0'; // deposit()
const WITHDRAW_SEL = '0x2e1a7d4d'; // withdraw(uint256)
const MAX_UINT256 = (1n << 256n) - 1n;

/** Last word of approve(spender, amount) calldata → amount. */
const approveAmount = (data: string): bigint => BigInt(`0x${data.slice(2 + 8 + 64)}`);

describe('buildSwapCalls', () => {
  test('single direct leg → [approve exact, swap]', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER });
    expect(calls.length).toBe(2);
    expect(calls[0].to.toLowerCase()).toBe(USDC.toLowerCase()); // approve on the token
    expect(calls[0].data.startsWith(APPROVE_SEL)).toBe(true);
    expect(approveAmount(calls[0].data)).toBe(1000n); // exact amount, not max
    expect(calls[1].to.toLowerCase()).toBe(POOL_S.toLowerCase()); // swap on the pool
    expect(calls[1].data.startsWith(SWAP_SEL)).toBe(true);
    expect(totalValue(calls)).toBe(0n);
  });

  test('approveMax=true → max uint256 allowance', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER, approveMax: true });
    expect(approveAmount(calls[0].data)).toBe(MAX_UINT256);
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
    expect(
      calls
        .slice(0, 2)
        .map((c) => approveAmount(c.data))
        .sort(),
    ).toEqual([300n, 700n]);
  });

  test('needsApproval=false skips approvals (cached allowance)', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 1000n, minOut: 995n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER, needsApproval: () => false });
    expect(calls.length).toBe(1);
    expect(calls[0].data.startsWith(SWAP_SEL)).toBe(true);
  });

  test('wrapIn leg → leading deposit carries the value, swap itself is valueless', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_V, tokenIn: WNATIVE, tokenOut: USDT, amountIn: 5n, minOut: 4n, wrapIn: true },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER, wrappedNative: WNATIVE });
    expect(calls.length).toBe(3); // deposit, approve, swap
    expect(calls[0].to).toBe(WNATIVE);
    expect(calls[0].data).toBe(DEPOSIT_SEL);
    expect(calls[0].value).toBe(5n);
    expect(calls[1].data.startsWith(APPROVE_SEL)).toBe(true);
    expect(calls[2].value).toBe(0n);
    expect(totalValue(calls)).toBe(5n);
  });

  test('wrapIn always approves, even when the allowance probe says otherwise', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_V, tokenIn: WNATIVE, tokenOut: USDT, amountIn: 5n, minOut: 4n, wrapIn: true },
    ];
    const calls = buildSwapCalls(legs, {
      recipient: USER,
      wrappedNative: WNATIVE,
      needsApproval: () => false,
    });
    expect(calls.filter((c) => c.data.startsWith(APPROVE_SEL)).length).toBe(1);
  });

  test('unwrapOut leg → trailing withdraw of Σ minOut, not of the quote', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_V, tokenIn: USDC, tokenOut: WNATIVE, amountIn: 9n, minOut: 4n, unwrapOut: true },
      { pool: POOL_S, tokenIn: USDC, tokenOut: WNATIVE, amountIn: 9n, minOut: 3n, unwrapOut: true },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER, wrappedNative: WNATIVE });
    const last = calls[calls.length - 1];
    expect(last.to).toBe(WNATIVE);
    expect(last.data.startsWith(WITHDRAW_SEL)).toBe(true);
    expect(BigInt(`0x${last.data.slice(10)}`)).toBe(7n);
    expect(totalValue(calls)).toBe(0n);
  });

  test('wrap/unwrap flag that does not match the chain wrapped native is refused', () => {
    const wrong: ExecLeg[] = [
      { pool: POOL_V, tokenIn: USDC, tokenOut: USDT, amountIn: 5n, minOut: 4n, wrapIn: true },
    ];
    expect(() => buildSwapCalls(wrong, { recipient: USER, wrappedNative: WNATIVE })).toThrow();
    // Missing wrappedNative is equally refused: it would encode a call to `undefined`.
    const right: ExecLeg[] = [
      { pool: POOL_V, tokenIn: WNATIVE, tokenOut: USDT, amountIn: 5n, minOut: 4n, wrapIn: true },
    ];
    expect(() => buildSwapCalls(right, { recipient: USER })).toThrow();
  });

  test('dedup approvals for the same (token,pool) across legs — exact Σ amountIn', () => {
    const legs: ExecLeg[] = [
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 500n, minOut: 498n },
      { pool: POOL_S, tokenIn: USDC, tokenOut: USDT, amountIn: 500n, minOut: 498n },
    ];
    const calls = buildSwapCalls(legs, { recipient: USER });
    const approves = calls.filter((c) => c.data.startsWith(APPROVE_SEL));
    expect(approves.length).toBe(1);
    expect(approveAmount(approves[0].data)).toBe(1000n);
    expect(calls.filter((c) => c.data.startsWith(SWAP_SEL)).length).toBe(2);
  });
});

describe('planToLegs', () => {
  const META: Record<string, TokenMeta> = {
    USDC: { address: USDC, decimals: 6 },
    USDT: { address: USDT, decimals: 18 },
    BNB: { address: WNATIVE, decimals: 18 },
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
    expect(legs[0].wrapIn).toBeUndefined();
  });

  test('cross-pool part → 2 legs; leg2.amountIn = leg1.minOut; wrap flags leg1 only', () => {
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
    const legs = mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf, nativeIn: true }));
    expect(legs.length).toBe(2);
    expect(legs[0].wrapIn).toBe(true);
    expect(legs[0].minOut).toBe(600_000_000n); // bridged USDC @ 6 decimals
    expect(legs[1].amountIn).toBe(legs[0].minOut);
    expect(legs[1].wrapIn).toBeUndefined();
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

  // REGRESSION - "transferFrom failed" on a max-balance swap.
  // The max chip seeds the field with the wei-exact balance; the quote engine is f64, so
  // `parseFloat("31.049999999999999999")` is 31.05 and rebuilding the pay leg from THAT hands the
  // pool 31050000000000000000 - one wei more than the wallet holds. `transferFrom` reverts
  // `TransferFromFailed()` (0x7939f424), and the approval, summed from the same inflated legs,
  // matches perfectly and hides the cause. INVARIANT: the amount submitted never exceeds the
  // on-chain balance, and the approval covers exactly the amount submitted.
  describe('amountInUnits pins the pay leg to the wei', () => {
    const BALANCE = 31_049_999_999_999_999_999n; // 18-dec faucet twin, chip reads "31.05"
    const FLOAT_IN = Number.parseFloat('31.049999999999999999'); // === 31.05
    const rs = direct(POOL_S, 'USDT', 'USDC'); // USDT is the 18-decimal leg in META
    const plan: SwapPlan = {
      amountIn: FLOAT_IN,
      amountOut: 31,
      isSplit: false,
      parts: [
        {
          route: rs,
          fraction: 1,
          quote: { route: rs, amountIn: FLOAT_IN, amountOut: 31, fills: [], maxIn: 1e6 },
        },
      ],
    };

    test('the f64 path overshoots the balance - the bug this pins', () => {
      const legs = mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf }));
      expect(legs[0].amountIn).toBe(31_050_000_000_000_000_000n);
      expect(legs[0].amountIn).toBeGreaterThan(BALANCE); // → TransferFromFailed()
    });

    test('exact units → amountIn IS the balance, and the approval covers exactly it', () => {
      const legs = mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf, amountInUnits: BALANCE }));
      expect(legs[0].amountIn).toBe(BALANCE);
      expect(legs[0].amountIn).toBeLessThanOrEqual(BALANCE);
      const approves = buildSwapCalls(legs, { recipient: USER }).filter((c) =>
        c.data.startsWith(APPROVE_SEL),
      );
      expect(approves.length).toBe(1);
      expect(approveAmount(approves[0].data)).toBe(BALANCE);
    });

    test('split parts sum back to the exact total, none of them over it', () => {
      const rv = direct(POOL_V, 'USDT', 'USDC');
      // 1/3 : 2/3 - fractions with no exact f64 (or decimal) representation.
      const third = 1 / 3;
      const splitPlan: SwapPlan = {
        amountIn: FLOAT_IN,
        amountOut: 31,
        isSplit: true,
        parts: [
          {
            route: rv,
            fraction: third,
            quote: { route: rv, amountIn: FLOAT_IN * third, amountOut: 10, fills: [], maxIn: 1e6 },
          },
          {
            route: rs,
            fraction: 1 - third,
            quote: {
              route: rs,
              amountIn: FLOAT_IN * (1 - third),
              amountOut: 21,
              fills: [],
              maxIn: 1e6,
            },
          },
        ],
      };
      const legs = mustLegs(
        planToLegs(splitPlan, { slippageFrac: 0, tokenOf, amountInUnits: BALANCE }),
      );
      expect(legs.length).toBe(2);
      const total = legs.reduce((s, l) => s + l.amountIn, 0n);
      expect(total).toBe(BALANCE); // to the wei - no dust lost, none invented
      for (const l of legs) expect(l.amountIn).toBeLessThan(BALANCE);
      // Σ of the per-(token,pool) approvals is also exactly the balance: distinct spenders.
      const approves = buildSwapCalls(legs, { recipient: USER }).filter((c) =>
        c.data.startsWith(APPROVE_SEL),
      );
      expect(approves.reduce((s, c) => s + approveAmount(c.data), 0n)).toBe(BALANCE);
    });

    test('a 2-leg part debits the wallet exactly once, at the exact size', () => {
      const cross = {
        legs: [
          { poolTag: 'v', poolAddr: POOL_V, tokenIn: 'USDT', tokenOut: 'BNB' },
          { poolTag: 's', poolAddr: POOL_S, tokenIn: 'BNB', tokenOut: 'USDC' },
        ],
        tokens: ['USDT', 'BNB', 'USDC'],
        hops: 2,
      };
      const crossPlan: SwapPlan = {
        amountIn: FLOAT_IN,
        amountOut: 31,
        isSplit: false,
        parts: [
          {
            route: cross,
            fraction: 1,
            quote: {
              route: cross,
              amountIn: FLOAT_IN,
              amountOut: 31,
              fills: [
                { leg: cross.legs[0], amountIn: FLOAT_IN, amountOut: 0.5 },
                { leg: cross.legs[1], amountIn: 0.5, amountOut: 31 },
              ],
              maxIn: 1e6,
            },
          },
        ],
      };
      const legs = mustLegs(
        planToLegs(crossPlan, { slippageFrac: 0, tokenOf, amountInUnits: BALANCE }),
      );
      expect(legs[0].amountIn).toBe(BALANCE);
      expect(legs[1].amountIn).toBe(legs[0].minOut); // hop 2 spends the bridged floor, not the wallet
    });

    test('an absent or zero exact total leaves the float path alone', () => {
      expect(mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf }))[0].amountIn).toBe(
        31_050_000_000_000_000_000n,
      );
      expect(
        mustLegs(planToLegs(plan, { slippageFrac: 0, tokenOf, amountInUnits: 0n }))[0].amountIn,
      ).toBe(31_050_000_000_000_000_000n);
    });
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
