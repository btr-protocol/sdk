import { describe, expect, test } from 'bun:test';
import type { Address } from '../eth/index.js';
import {
  type ExecLeg,
  applySlip,
  buildRouterApprovals,
  buildRouterSwapCall,
  legsToRouterPlan,
} from './index.js';

const P1 = '0x0000000000000000000000000000000000000010' as Address;
const P2 = '0x0000000000000000000000000000000000000020' as Address;
const ROUTER = '0x00000000000000000000000000000000000000FF' as Address;
const A = '0x0000000000000000000000000000000000000001' as Address;
const B = '0x0000000000000000000000000000000000000002' as Address;
const C = '0x0000000000000000000000000000000000000003' as Address;
const USER = '0x00000000000000000000000000000000000000AA' as Address;

const leg = (o: Partial<ExecLeg>): ExecLeg => ({
  pool: P1,
  tokenIn: A,
  tokenOut: B,
  amountIn: 100n,
  quotedOut: 99n,
  minOut: 98n,
  ...o,
});

describe('legsToRouterPlan', () => {
  test('a chained leg continues its path instead of starting a new one', () => {
    const { parts } = legsToRouterPlan(
      [
        leg({ pool: P1, tokenIn: A, tokenOut: B, amountIn: 100n, quotedOut: 99n }),
        leg({ pool: P2, tokenIn: B, tokenOut: C, amountIn: 98n, quotedOut: 97n, chained: true }),
      ],
      0.01,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]?.tokenIn).toBe(A);
    expect(parts[0]?.amountIn).toBe(100n);
    expect(parts[0]?.hops.map((h) => h.tokenOut)).toEqual([B, C]);
  });

  test('the floor is on the TERMINAL output, from the quote, not the per-leg minOut', () => {
    // Per-leg floors compound: hop 2's is derived from hop 1's floor, so a two-hop route ends up
    // promising less than it should and refuses itself on a still market. The router promises the
    // token the user asked for, once.
    const { floors } = legsToRouterPlan(
      [
        leg({ tokenOut: B, quotedOut: 99n, minOut: 90n }),
        leg({ pool: P2, tokenIn: B, tokenOut: C, quotedOut: 97n, minOut: 80n, chained: true }),
      ],
      0.01,
    );
    expect(floors).toHaveLength(1);
    expect(floors[0]?.token).toBe(C);
    expect(floors[0]?.minOut).toBe(applySlip(97n, 0.01));
    // Emphatically NOT the leg's own minOut, which is the compounded number.
    expect(floors[0]?.minOut).not.toBe(80n);
  });

  test('a split becomes two parts and ONE aggregate floor', () => {
    const { parts, floors } = legsToRouterPlan(
      [
        leg({ pool: P1, amountIn: 60n, quotedOut: 59n }),
        leg({ pool: P2, amountIn: 40n, quotedOut: 41n }),
      ],
      0.01,
    );
    expect(parts).toHaveLength(2);
    expect(floors).toHaveLength(1);
    // 59 + 41 slipped once. Floored per part it would refuse a fill that is fine in total.
    expect(floors[0]?.minOut).toBe(applySlip(100n, 0.01));
  });

  test('multiple inputs AND multiple outputs in one call', () => {
    const { parts, floors } = legsToRouterPlan(
      [
        leg({ tokenIn: A, tokenOut: B, amountIn: 100n, quotedOut: 99n }),
        leg({ pool: P2, tokenIn: C, tokenOut: B, amountIn: 50n, quotedOut: 49n }),
        leg({ pool: P2, tokenIn: A, tokenOut: C, amountIn: 25n, quotedOut: 24n }),
      ],
      0,
    );
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.tokenIn)).toEqual([A, C, A]);
    const byToken = Object.fromEntries(floors.map((f) => [f.token, f.minOut]));
    expect(byToken[B]).toBe(148n); // 99 + 49, summed across two different inputs
    expect(byToken[C]).toBe(24n);
  });

  test('a tolerance outside [0,1) is refused rather than silently clamped', () => {
    expect(() => legsToRouterPlan([leg({})], 1)).toThrow(/slippageFrac/);
    expect(() => legsToRouterPlan([leg({})], -0.1)).toThrow(/slippageFrac/);
  });
});

describe('buildRouterApprovals', () => {
  test('one approval per INPUT TOKEN, to the router — not one per pool', () => {
    const calls = buildRouterApprovals(
      ROUTER,
      [
        leg({ tokenIn: A, amountIn: 60n }),
        leg({ pool: P2, tokenIn: A, amountIn: 40n }),
        leg({ pool: P2, tokenIn: C, tokenOut: B, amountIn: 10n }),
      ],
      {},
    );
    // Two tokens in, two approvals — the A legs collapse and their amounts add.
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.to)).toEqual([A, C]);
  });

  test('needsApproval can skip a token whose allowance already covers it', () => {
    const calls = buildRouterApprovals(ROUTER, [leg({ tokenIn: A })], {
      needsApproval: (token) => token !== A,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('buildRouterSwapCall', () => {
  test('encodes to the router, carries no value, and refuses an empty path', () => {
    const call = buildRouterSwapCall(ROUTER, [leg({})], {
      recipient: USER,
      slippageFrac: 0.005,
      deadline: 1234n,
    });
    expect(call.to).toBe(ROUTER);
    expect(call.value).toBe(0n);
    expect(call.data.startsWith('0x')).toBe(true);
    expect(() => buildRouterSwapCall(ROUTER, [], { recipient: USER, slippageFrac: 0 })).toThrow(
      /no legs/,
    );
  });
});
