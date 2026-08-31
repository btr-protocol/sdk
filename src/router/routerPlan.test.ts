import { describe, expect, test } from 'bun:test';
import { ROUTER_ABI } from '../abis/Router.js';
import type { SwapPlan } from '../amm/router.js';
import type { Address } from '../eth/index.js';
import {
  type RouterPlan,
  type TokenMeta,
  buildRouterApprovalCalls,
  buildRouterCalls,
  buildRouterSwapExecCalls,
  planToRouterPlan,
  refloorRouterPlan,
} from './index.js';

const ROUTER = '0x00000000000000000000000000000000000000FF' as Address;
const USER = '0x00000000000000000000000000000000000000AA' as Address;
const P1 = '0x0000000000000000000000000000000000000010' as Address;
const P2 = '0x0000000000000000000000000000000000000020' as Address;
const P3 = '0x0000000000000000000000000000000000000030' as Address;
const USDC = '0x0000000000000000000000000000000000000001' as Address;
const USDT = '0x0000000000000000000000000000000000000002' as Address;
const WNATIVE = '0x0000000000000000000000000000000000000003' as Address;
const DAI = '0x0000000000000000000000000000000000000004' as Address;
const SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address;

const ROUTER_SWAP_SEL = '0x2477447a'; // swap((address,uint256,(address,address)[])[],(address,uint256)[],address,uint256)
const APPROVE_SEL = '0x095ea7b3';
const DEPOSIT_SEL = '0xd0e30db0';
const WITHDRAW_SEL = '0x2e1a7d4d';
const MAX_UINT256 = (1n << 256n) - 1n;

const META: Record<string, TokenMeta> = {
  USDC: { address: USDC, decimals: 6 },
  USDT: { address: USDT, decimals: 18 },
  DAI: { address: DAI, decimals: 18 },
  BNB: { address: WNATIVE, decimals: 18 },
  GHOST: { address: SENTINEL, decimals: 18 },
};
const tokenOf = (s: string) => META[s];

/** A route through `pools`, visiting `tokens` — tokens.length === pools.length + 1. */
const route = (pools: (Address | undefined)[], tokens: string[]) => ({
  legs: pools.map((poolAddr, i) => ({
    poolTag: `p${i}`,
    poolAddr,
    tokenIn: tokens[i],
    tokenOut: tokens[i + 1],
  })),
  tokens,
  hops: pools.length,
});

type Rt = ReturnType<typeof route>;
const part = (rt: Rt, fraction: number, amountIn: number, amountOut: number) => ({
  route: rt,
  fraction,
  quote: { route: rt, amountIn, amountOut, fills: [], maxIn: 1e9 },
});

const plan = (amountIn: number, amountOut: number, parts: ReturnType<typeof part>[]): SwapPlan => ({
  amountIn,
  amountOut,
  isSplit: parts.length > 1,
  parts,
});

const must = (rp: RouterPlan | null): RouterPlan => {
  if (!rp) throw new Error('expected a plan');
  return rp;
};

/** Last word of approve(spender, amount) calldata → amount. */
const approveAmount = (data: string): bigint => BigInt(`0x${data.slice(2 + 8 + 64)}`);

describe('planToRouterPlan', () => {
  test('a direct part becomes one part, one hop, floored on the quote', () => {
    const rt = route([P1], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0.25, tokenOf }),
    );
    expect(rp.parts.length).toBe(1);
    expect(rp.parts[0].tokenIn).toBe(USDC);
    expect(rp.parts[0].amountIn).toBe(100_000_000n); // 100 @ 6dp
    expect(rp.parts[0].hops).toEqual([{ pool: P1, tokenOut: USDT }]);
    expect(rp.floors).toEqual([{ token: USDT, minOut: 74_250_000_000_000_000_000n }]); // 99·0.75 @ 18dp
    expect(rp.wrapValue).toBe(0n);
    expect(rp.unwrapAmount).toBe(0n);
  });

  test('a three-hop route is carried whole — the two-hop cap of the leg path is gone', () => {
    const rt = route([P1, P2, P3], ['USDC', 'DAI', 'BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    );
    expect(rp.parts.length).toBe(1);
    expect(rp.parts[0].hops.map((h) => h.pool)).toEqual([P1, P2, P3]);
    expect(rp.parts[0].hops.map((h) => h.tokenOut)).toEqual([DAI, WNATIVE, USDT]);
    // ONE floor, on what the user asked for — not one per hop, which is the compounding that made
    // a multi-hop route reject itself on a market that had not moved.
    expect(rp.floors).toEqual([{ token: USDT, minOut: 99_000_000_000_000_000_000n }]);
  });

  test('a split landing the same token is floored on the TOTAL, not per part', () => {
    const a = route([P1], ['USDC', 'USDT']);
    const b = route([P2], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(1000, 990, [part(a, 0.7, 700, 693), part(b, 0.3, 300, 297)]), {
        slippageFrac: 0.5,
        tokenOf,
      }),
    );
    expect(rp.parts.length).toBe(2);
    expect(rp.floors.length).toBe(1);
    expect(rp.floors[0]).toEqual({ token: USDT, minOut: 495_000_000_000_000_000_000n }); // (693+297)·0.5
  });

  test('a split landing two different tokens gets one floor each', () => {
    const a = route([P1], ['USDC', 'USDT']);
    const b = route([P2], ['USDC', 'DAI']);
    const rp = must(
      planToRouterPlan(plan(1000, 990, [part(a, 0.6, 600, 594), part(b, 0.4, 400, 396)]), {
        slippageFrac: 0,
        tokenOf,
      }),
    );
    expect(rp.floors.length).toBe(2);
    expect(new Set(rp.floors.map((f) => f.token))).toEqual(new Set([USDT, DAI]));
  });

  test('parts come out largest first', () => {
    const small = route([P1], ['USDC', 'USDT']);
    const big = route([P2], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(1000, 990, [part(small, 0.25, 250, 247), part(big, 0.75, 750, 743)]), {
        slippageFrac: 0,
        tokenOf,
      }),
    );
    expect(rp.parts[0].hops[0].pool).toBe(P2);
  });

  test('an exact input is carved to the wei — Σ parts === amountInUnits, no dust lost or invented', () => {
    // 31.049999999999999999 ether: the f64 path rounds this UP and lands one wei above the
    // balance the caller checked, which is a TransferFromFailed on every max-balance swap.
    const exact = 31_049_999_999_999_999_999n;
    const a = route([P1], ['BNB', 'USDT']);
    const b = route([P2], ['BNB', 'USDT']);
    const c = route([P3], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(
        plan(31.05, 99, [
          part(a, 1 / 3, 10.35, 33),
          part(b, 1 / 3, 10.35, 33),
          part(c, 1 / 3, 10.35, 33),
        ]),
        { slippageFrac: 0, tokenOf, amountInUnits: exact },
      ),
    );
    expect(rp.parts.reduce((s, p) => s + p.amountIn, 0n)).toBe(exact);
  });

  test('a missing pool address refuses the whole plan rather than dropping a hop', () => {
    const rt = route([P1, undefined], ['USDC', 'DAI', 'USDT']);
    expect(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    ).toBeNull();
  });

  test('an unknown token symbol refuses the plan', () => {
    const rt = route([P1], ['USDC', 'NOPE']);
    expect(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    ).toBeNull();
  });

  test('the native sentinel is refused — it is not a contract to transferFrom', () => {
    const rt = route([P1], ['GHOST', 'USDT']);
    expect(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    ).toBeNull();
    const out = route([P1], ['USDC', 'GHOST']);
    expect(
      planToRouterPlan(plan(100, 99, [part(out, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    ).toBeNull();
  });

  test('an empty plan is null, not an empty call', () => {
    expect(planToRouterPlan(plan(100, 99, []), { slippageFrac: 0, tokenOf })).toBeNull();
  });

  test('a slippage outside [0,1) throws rather than silently flooring at zero', () => {
    const rt = route([P1], ['USDC', 'USDT']);
    const p = plan(100, 99, [part(rt, 1, 100, 99)]);
    expect(() => planToRouterPlan(p, { slippageFrac: 1, tokenOf })).toThrow(/slippageFrac/);
    expect(() => planToRouterPlan(p, { slippageFrac: -0.1, tokenOf })).toThrow(/slippageFrac/);
    expect(() => planToRouterPlan(p, { slippageFrac: Number.NaN, tokenOf })).toThrow(
      /slippageFrac/,
    );
  });

  test('nativeIn sets the wrap value to the whole input', () => {
    const a = route([P1], ['BNB', 'USDT']);
    const b = route([P2], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(3, 99, [part(a, 2 / 3, 2, 66), part(b, 1 / 3, 1, 33)]), {
        slippageFrac: 0,
        tokenOf,
        nativeIn: true,
        amountInUnits: 3_000_000_000_000_000_000n,
      }),
    );
    expect(rp.wrapValue).toBe(3_000_000_000_000_000_000n);
    expect(rp.unwrapAmount).toBe(0n);
  });

  test('nativeOut unwraps the FLOOR, not the quote — positive slippage stays with the user', () => {
    const rt = route([P1], ['USDC', 'BNB']);
    const rp = must(
      planToRouterPlan(plan(100, 2, [part(rt, 1, 100, 2)]), {
        slippageFrac: 0.5,
        tokenOf,
        nativeOut: true,
      }),
    );
    expect(rp.floors[0].minOut).toBe(1_000_000_000_000_000_000n);
    expect(rp.unwrapAmount).toBe(rp.floors[0].minOut);
  });

  test('a native flag that disagrees with the plan is refused, not guessed at', () => {
    const a = route([P1], ['BNB', 'USDT']);
    const b = route([P2], ['USDC', 'USDT']);
    // nativeIn, but the plan spends two different assets: wrapping either amount is wrong.
    expect(
      planToRouterPlan(plan(100, 99, [part(a, 0.5, 50, 49), part(b, 0.5, 50, 50)]), {
        slippageFrac: 0,
        tokenOf,
        nativeIn: true,
      }),
    ).toBeNull();
    // nativeOut, but the plan lands two different assets: only one of them can be unwrapped.
    const c = route([P1], ['USDC', 'BNB']);
    const d = route([P2], ['USDC', 'USDT']);
    expect(
      planToRouterPlan(plan(100, 99, [part(c, 0.5, 50, 1), part(d, 0.5, 50, 49)]), {
        slippageFrac: 0,
        tokenOf,
        nativeOut: true,
      }),
    ).toBeNull();
  });
});

describe('buildRouterApprovalCalls', () => {
  const threeHop = must(
    planToRouterPlan(
      plan(100, 99, [part(route([P1, P2, P3], ['USDC', 'DAI', 'BNB', 'USDT']), 1, 100, 99)]),
      {
        slippageFrac: 0,
        tokenOf,
      },
    ),
  );

  test('one approval for a three-pool route — to the ROUTER, not to each pool', () => {
    const calls = buildRouterApprovalCalls(ROUTER, threeHop, {});
    expect(calls.length).toBe(1);
    expect(calls[0].to).toBe(USDC);
    expect(calls[0].data.startsWith(APPROVE_SEL)).toBe(true);
    // spender is the router: an allowance to a pool does nothing on this path
    expect(
      calls[0].data
        .slice(2 + 8, 2 + 8 + 64)
        .toLowerCase()
        .endsWith(ROUTER.slice(2).toLowerCase()),
    ).toBe(true);
    expect(approveAmount(calls[0].data)).toBe(100_000_000n);
  });

  test('approveMax grants max uint256', () => {
    expect(
      approveAmount(buildRouterApprovalCalls(ROUTER, threeHop, { approveMax: true })[0].data),
    ).toBe(MAX_UINT256);
  });

  test('a split from two inputs approves each once, for its own total', () => {
    const a = route([P1], ['USDC', 'DAI']);
    const b = route([P2], ['USDT', 'DAI']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(a, 0.5, 50, 49), part(b, 0.5, 50, 50)]), {
        slippageFrac: 0,
        tokenOf,
      }),
    );
    const calls = buildRouterApprovalCalls(ROUTER, rp, {});
    expect(calls.length).toBe(2);
    expect(new Set(calls.map((c) => c.to))).toEqual(new Set([USDC, USDT]));
  });

  test('needsApproval=false skips the call', () => {
    expect(buildRouterApprovalCalls(ROUTER, threeHop, { needsApproval: () => false }).length).toBe(
      0,
    );
  });

  test('a wrapped-native input is approved even when the allowance probe says no', () => {
    // The probe read a PRE-batch state: the wrapped balance does not exist until the deposit in
    // this same batch creates it, so a cached allowance can never cover it.
    const rt = route([P1], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(1, 99, [part(rt, 1, 1, 99)]), {
        slippageFrac: 0,
        tokenOf,
        nativeIn: true,
        amountInUnits: 10n ** 18n,
      }),
    );
    const calls = buildRouterApprovalCalls(ROUTER, rp, {
      needsApproval: () => false,
      wrappedNative: WNATIVE,
    });
    expect(calls.length).toBe(2);
    expect(calls[0].data.startsWith(DEPOSIT_SEL)).toBe(true); // wrap FIRST, it funds the approval
    expect(calls[0].value).toBe(10n ** 18n);
    expect(calls[1].data.startsWith(APPROVE_SEL)).toBe(true);
  });

  test('a native plan with no wrapped-native address throws instead of sending value nowhere', () => {
    const rt = route([P1], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(1, 99, [part(rt, 1, 1, 99)]), {
        slippageFrac: 0,
        tokenOf,
        nativeIn: true,
        amountInUnits: 10n ** 18n,
      }),
    );
    expect(() => buildRouterApprovalCalls(ROUTER, rp, {})).toThrow(/wrappedNative/);
  });
});

describe('buildRouterSwapExecCalls', () => {
  test('the whole route is ONE call to the router', () => {
    const rt = route([P1, P2, P3], ['USDC', 'DAI', 'BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    );
    const calls = buildRouterSwapExecCalls(ROUTER, rp, { recipient: USER });
    expect(calls.length).toBe(1);
    expect(calls[0].to).toBe(ROUTER);
    expect(calls[0].data.startsWith(ROUTER_SWAP_SEL)).toBe(true);
    expect(calls[0].value).toBe(0n);
  });

  test('a nativeOut plan withdraws after the swap, for the floor', () => {
    const rt = route([P1], ['USDC', 'BNB']);
    const rp = must(
      planToRouterPlan(plan(100, 2, [part(rt, 1, 100, 2)]), {
        slippageFrac: 0,
        tokenOf,
        nativeOut: true,
      }),
    );
    const calls = buildRouterSwapExecCalls(ROUTER, rp, { recipient: USER, wrappedNative: WNATIVE });
    expect(calls.length).toBe(2);
    expect(calls[1].to).toBe(WNATIVE);
    expect(calls[1].data.startsWith(WITHDRAW_SEL)).toBe(true);
    expect(BigInt(`0x${calls[1].data.slice(10)}`)).toBe(2_000_000_000_000_000_000n);
  });

  test('the deadline is read at call time, not baked in earlier', () => {
    const rt = route([P1], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    );
    // `parts` and `floors` are dynamic, so their contents sit at the TAIL and only their offsets
    // are in the head: deadline is head word 4, not the last word of the calldata.
    const deadlineOf = (data: string): bigint =>
      BigInt(`0x${data.slice(2 + 8 + 3 * 64, 2 + 8 + 4 * 64)}`);
    expect(
      deadlineOf(
        buildRouterSwapExecCalls(ROUTER, rp, { recipient: USER, deadline: 12345n })[0].data,
      ),
    ).toBe(12345n);
    expect(
      deadlineOf(buildRouterSwapExecCalls(ROUTER, rp, { recipient: USER })[0].data),
    ).toBeGreaterThan(12345n);
  });
});

describe('buildRouterCalls', () => {
  test('wrap, then approve, then swap, then unwrap', () => {
    const rt = route([P1], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(1, 99, [part(rt, 1, 1, 99)]), {
        slippageFrac: 0,
        tokenOf,
        nativeIn: true,
        amountInUnits: 10n ** 18n,
      }),
    );
    const calls = buildRouterCalls(ROUTER, rp, { recipient: USER, wrappedNative: WNATIVE });
    expect(calls.map((c) => c.data.slice(0, 10))).toEqual([
      DEPOSIT_SEL,
      APPROVE_SEL,
      ROUTER_SWAP_SEL,
    ]);
  });
});

describe('refloorRouterPlan', () => {
  const rt = route([P1], ['USDC', 'USDT']);
  const base = must(
    planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
  );

  test('moves the floor to a fresh quote and leaves the ROUTE alone', () => {
    const next = refloorRouterPlan(base, new Map([[USDT.toLowerCase(), 90n * 10n ** 18n]]), 0.1);
    expect(next.floors[0].minOut).toBe(81n * 10n ** 18n);
    expect(next.parts).toEqual(base.parts); // re-quoting must not re-route under the user
  });

  test("a market that moved in the user's favour does not raise the floor above the quote", () => {
    // Flooring at the fresh number would promise more than the screen ever showed, and turn a
    // better-than-quoted fill into a revert.
    const next = refloorRouterPlan(base, new Map([[USDT.toLowerCase(), 500n * 10n ** 18n]]), 0);
    expect(next.floors[0].minOut).toBe(99n * 10n ** 18n);
  });

  test('a token the fresh quote does not mention keeps its floor', () => {
    const next = refloorRouterPlan(base, new Map(), 0.1);
    expect(next.floors).toEqual(base.floors);
  });

  test('a native-out unwrap follows its floor down', () => {
    const nrt = route([P1], ['USDC', 'BNB']);
    const rp = must(
      planToRouterPlan(plan(100, 2, [part(nrt, 1, 100, 2)]), {
        slippageFrac: 0,
        tokenOf,
        nativeOut: true,
      }),
    );
    const next = refloorRouterPlan(rp, new Map([[WNATIVE.toLowerCase(), 10n ** 18n]]), 0);
    expect(next.unwrapAmount).toBe(10n ** 18n);
    expect(next.unwrapAmount).toBe(next.floors[0].minOut);
  });

  test('a slippage outside [0,1) throws', () => {
    expect(() => refloorRouterPlan(base, new Map(), 1)).toThrow(/slippageFrac/);
  });
});

// ── what the pre-deployment audit found ────────────────────────────────────
//
// Each of these reproduces a defect a reviewer demonstrated against this module before the Router
// was broadcast. Regression pins, not hypotheticals.

describe('audit regressions', () => {
  test('a part carved down to nothing is dropped, not sent to a guaranteed revert', () => {
    // `inputCarver` floors every non-last slice, so a tiny input split across routes empties the
    // small ones. Sending a zero-amount part costs a wallet prompt to reach `ZeroValue` in the
    // pool, and flooring its quoted output would promise a delivery nothing is funded to make.
    const a = route([P1], ['USDC', 'USDT']);
    const b = route([P2], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(100, 99, [part(a, 0.7, 70, 69), part(b, 0.3, 30, 30)]), {
        slippageFrac: 0,
        tokenOf,
        amountInUnits: 1n,
      }),
    );
    expect(rp.parts.length).toBe(1);
    expect(rp.parts.every((p) => p.amountIn > 0n)).toBe(true);
    expect(rp.parts[0].amountIn).toBe(1n);
  });

  test('a plan whose every part rounds to zero is null, not an empty call', () => {
    // The float path (no `amountInUnits`) has no residual to fall back on, so an amount below the
    // token's smallest unit floors every part to nothing. Returning `{parts: []}` here would
    // encode a call that reverts `NoParts`.
    const a = route([P1], ['USDC', 'USDT']);
    const b = route([P2], ['USDC', 'USDT']);
    expect(
      planToRouterPlan(
        plan(1e-12, 1e-12, [part(a, 0.5, 5e-13, 5e-13), part(b, 0.5, 5e-13, 5e-13)]),
        {
          slippageFrac: 0,
          tokenOf,
        },
      ),
    ).toBeNull();
  });

  test('a route whose legs do not actually join is refused', () => {
    // `tokenIn` is implicit on chain — the previous hop's output — so a broken chain would be
    // re-chained into a pair the pool never listed, and surface as an opaque on-chain revert.
    const broken = {
      legs: [
        { poolTag: 'p0', poolAddr: P1, tokenIn: 'USDC', tokenOut: 'DAI' },
        { poolTag: 'p1', poolAddr: P2, tokenIn: 'USDT', tokenOut: 'BNB' }, // USDT, not DAI
      ],
      tokens: ['USDC', 'DAI', 'BNB'],
      hops: 2,
    };
    expect(
      planToRouterPlan(plan(100, 99, [part(broken, 1, 100, 99)]), { slippageFrac: 0, tokenOf }),
    ).toBeNull();
  });

  test('a re-floor to zero does not permanently kill a native-out unwrap', () => {
    const rt = route([P1], ['USDC', 'BNB']);
    const rp = must(
      planToRouterPlan(plan(100, 2, [part(rt, 1, 100, 2)]), {
        slippageFrac: 0,
        tokenOf,
        nativeOut: true,
      }),
    );
    const zeroed = refloorRouterPlan(rp, new Map([[WNATIVE.toLowerCase(), 0n]]), 0);
    expect(zeroed.unwrapAmount).toBe(0n);
    // Guarded on the amount rather than the intent, the plan stopped unwrapping from here on and
    // the next re-floor paid the user in WRAPPED native with no withdraw beside it.
    const back = refloorRouterPlan(zeroed, new Map([[WNATIVE.toLowerCase(), 3n * 10n ** 18n]]), 0);
    // Clamped to the 2e18 that was quoted — the fresh 3e18 is better than the screen promised.
    expect(back.floors[0].minOut).toBe(2n * 10n ** 18n);
    // The point of the test: the unwrap came back with it, rather than staying dead at zero.
    expect(back.unwrapAmount).toBe(back.floors[0].minOut);
  });

  test('the ABI carries every error the contract can revert with', () => {
    // A missing entry decodes as raw hex in the UI, which is what the user sees when a swap fails.
    const names = new Set(
      (ROUTER_ABI as readonly { type: string; name?: string }[])
        .filter((e) => e.type === 'error')
        .map((e) => e.name),
    );
    for (const e of [
      'DeadlineExpired',
      'NoParts',
      'EmptyPath',
      'UnknownPool',
      'BelowFloor',
      'UnclaimedOutput',
      'DuplicateFloor',
      'BadRecipient',
      'Reentrancy',
    ]) {
      expect(names).toContain(e);
    }
  });
});
