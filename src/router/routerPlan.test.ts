import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { ROUTER_ABI } from '../abis/Router.js';
import { type AbiParameter, decodeAbiParameters } from '../eth/abi.js';
import type { Address } from '../eth/index.js';
import {
  type ExecLeg,
  type RouterPlan,
  type TokenMeta,
  assertServerFloor,
  buildRouterApprovalCalls,
  buildRouterCalls,
  buildRouterSwapExecCalls,
  buildSwapCalls,
  buildSwapExecCalls,
  planToLegs,
  planToRouterPlan,
} from './index.js';
import type { SwapPlan } from './route.js';

const ROUTER = '0x00000000000000000000000000000000000000FF' as Address;
const USER = '0x00000000000000000000000000000000000000AA' as Address;
const P1 = '0x0000000000000000000000000000000000000010' as Address;
const P2 = '0x0000000000000000000000000000000000000020' as Address;
const P3 = '0x0000000000000000000000000000000000000030' as Address;
const POOL_S = P1;
const POOL_V = P2;
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
/** Every pool in these fixtures is the factory's; the allowlist itself is tested separately. */
const isOfficialPool = () => true;
const O = { tokenOf, isOfficialPool };
const O0 = { slippageFrac: 0, ...O };

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
/** `hopOut[i]` = leg i's quoted output; leg i+1 spends it. Omitted = no per-leg fills. */
const part = (
  rt: Rt,
  fraction: number,
  amountIn: number,
  amountOut: number,
  hopOut: number[] = [],
) => ({
  route: rt,
  fraction,
  quote: {
    route: rt,
    amountIn,
    amountOut,
    fills: hopOut.map((o, i) => ({
      leg: rt.legs[i],
      amountIn: i ? hopOut[i - 1] : amountIn,
      amountOut: o,
    })),
  },
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
      planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), {
        slippageFrac: 0.25,
        ...O,
      }),
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
    const rp = must(planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), O0));
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
        ...O,
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
      planToRouterPlan(plan(1000, 990, [part(a, 0.6, 600, 594), part(b, 0.4, 400, 396)]), O0),
    );
    expect(rp.floors.length).toBe(2);
    expect(new Set(rp.floors.map((f) => f.token))).toEqual(new Set([USDT, DAI]));
  });

  test('parts come out largest first', () => {
    const small = route([P1], ['USDC', 'USDT']);
    const big = route([P2], ['USDC', 'USDT']);
    const rp = must(
      planToRouterPlan(
        plan(1000, 990, [part(small, 0.25, 250, 247), part(big, 0.75, 750, 743)]),
        O0,
      ),
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
        { ...O0, amountInUnits: exact },
      ),
    );
    expect(rp.parts.reduce((s, p) => s + p.amountIn, 0n)).toBe(exact);
  });

  const one = (pools: (Address | undefined)[], toks: string[]) =>
    plan(100, 99, [part(route(pools, toks), 1, 100, 99)]);
  test.each([
    ['a missing pool address (never drop a hop)', one([P1, undefined], ['USDC', 'DAI', 'USDT'])],
    ['an unknown token symbol', one([P1], ['USDC', 'NOPE'])],
    ['the native sentinel in (not a transferFrom target)', one([P1], ['GHOST', 'USDT'])],
    ['the native sentinel out', one([P1], ['USDC', 'GHOST'])],
    ['an empty plan (not an empty call)', plan(100, 99, [])],
  ] as const)('refuses %s', (_, p) => expect(planToRouterPlan(p, O0)).toBeNull());

  test('a slippage outside [0,1) throws rather than silently flooring at zero', () => {
    const rt = route([P1], ['USDC', 'USDT']);
    const p = plan(100, 99, [part(rt, 1, 100, 99)]);
    expect(() => planToRouterPlan(p, { slippageFrac: 1, tokenOf, isOfficialPool })).toThrow(
      /slippageFrac/,
    );
    expect(() => planToRouterPlan(p, { slippageFrac: -0.1, tokenOf, isOfficialPool })).toThrow(
      /slippageFrac/,
    );
    expect(() =>
      planToRouterPlan(p, { slippageFrac: Number.NaN, tokenOf, isOfficialPool }),
    ).toThrow(/slippageFrac/);
  });

  test('nativeIn sets the wrap value to the whole input', () => {
    const a = route([P1], ['BNB', 'USDT']);
    const b = route([P2], ['BNB', 'USDT']);
    const rp = must(
      planToRouterPlan(plan(3, 99, [part(a, 2 / 3, 2, 66), part(b, 1 / 3, 1, 33)]), {
        ...O0,
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
        ...O,
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
        ...O0,
        nativeIn: true,
      }),
    ).toBeNull();
    // nativeOut, but the plan lands two different assets: only one of them can be unwrapped.
    const c = route([P1], ['USDC', 'BNB']);
    const d = route([P2], ['USDC', 'USDT']);
    expect(
      planToRouterPlan(plan(100, 99, [part(c, 0.5, 50, 1), part(d, 0.5, 50, 49)]), {
        ...O0,
        nativeOut: true,
      }),
    ).toBeNull();
  });
});

describe('buildRouterApprovalCalls', () => {
  const threeHop = must(
    planToRouterPlan(
      plan(100, 99, [part(route([P1, P2, P3], ['USDC', 'DAI', 'BNB', 'USDT']), 1, 100, 99)]),
      O0,
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
      planToRouterPlan(plan(100, 99, [part(a, 0.5, 50, 49), part(b, 0.5, 50, 50)]), O0),
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
        ...O0,
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
        ...O0,
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
    const rp = must(planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), O0));
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
        ...O0,
        nativeOut: true,
      }),
    );
    // No sender → the account behind `msg.sender` is unknown, so `recipient` must not be
    // silently taken as it. Refuse before any calldata exists.
    expect(() =>
      buildRouterSwapExecCalls(ROUTER, rp, { recipient: USER, wrappedNative: WNATIVE }),
    ).toThrow(/sender is required/);
    const calls = buildRouterSwapExecCalls(ROUTER, rp, {
      recipient: USER,
      sender: USER,
      wrappedNative: WNATIVE,
    });
    expect(calls.length).toBe(2);
    expect(calls[1].to).toBe(WNATIVE);
    expect(calls[1].data.startsWith(WITHDRAW_SEL)).toBe(true);
    expect(BigInt(`0x${calls[1].data.slice(10)}`)).toBe(2_000_000_000_000_000_000n);
  });

  test('a nativeOut plan refuses to unwrap when recipient is not the sender', () => {
    const rt = route([P1], ['USDC', 'BNB']);
    const rp = must(
      planToRouterPlan(plan(100, 2, [part(rt, 1, 100, 2)]), {
        ...O0,
        nativeOut: true,
      }),
    );
    // Router.swap pays wrapped native to `recipient`; WNATIVE.withdraw burns from `msg.sender`.
    // Paying one account and withdrawing from another reverts empty or spends the sender's own
    // prior balance, so the mismatch must never reach calldata.
    expect(() =>
      buildRouterSwapExecCalls(ROUTER, rp, {
        recipient: USER,
        sender: P3,
        wrappedNative: WNATIVE,
      }),
    ).toThrow(/recipient must be the sender/);
    const calls = buildRouterSwapExecCalls(ROUTER, rp, {
      recipient: USER,
      sender: USER,
      wrappedNative: WNATIVE,
    });
    expect(calls.length).toBe(2);
  });

  test('the deadline is read at call time, not baked in earlier', () => {
    const rt = route([P1], ['USDC', 'USDT']);
    const rp = must(planToRouterPlan(plan(100, 99, [part(rt, 1, 100, 99)]), O0));
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
        ...O0,
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
        ...O0,
        amountInUnits: 1n,
      }),
    );
    expect(rp.parts.length).toBe(1);
    expect(rp.parts.every((p) => p.amountIn > 0n)).toBe(true);
    expect(rp.parts[0].amountIn).toBe(1n);
  });

  test('the direct path drops it too, and keeps the whole server floor on what is funded', () => {
    const a = route([P1], ['USDC', 'USDT']);
    const b = route([P2], ['USDC', 'USDT']);
    const minOut = 99n * 10n ** 18n;
    const opts = { ...O0, maxTolPbps: 0 };
    const legs = planToLegs(plan(100, 99, [part(a, 0.7, 70, 69), part(b, 0.3, 30, 30)]), {
      ...opts,
      amountInUnits: 1n,
      serverFloors: { [USDT.toLowerCase()]: { amountOut: minOut, minOut, tolPbps: 0 } },
    });
    expect(legs?.map((l) => [l.pool, l.amountIn, l.minOut])).toEqual([[P2, 1n, minOut]]);
    const dust = plan(1e-12, 1e-12, [part(a, 0.5, 5e-13, 5e-13), part(b, 0.5, 5e-13, 5e-13)]);
    expect(planToLegs(dust, opts)).toBeNull();
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
        O0,
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
    expect(planToRouterPlan(plan(100, 99, [part(broken, 1, 100, 99)]), O0)).toBeNull();
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

describe('the calldata that actually executed on Arc', () => {
  // Byte-for-byte from tx 0xc2aca727bf02532173e118e1240d81f9a7fb1c7bcf76cb9a5249e0e4950655e3,
  // the first swap through the deployed Router (0xb96d5049…eCc4): 10 EURC.b -> USDC.b in the FX
  // core -> WETH in the Crypto core, one transaction, 431,489 gas, delivered 0.00472603 WETH.
  //
  // This is the only test here anchored to a transaction that a chain accepted, so it is what
  // catches an ABI or struct-order drift that every hand-written expectation would agree with.
  const ROUTER = '0xb96d5049045B68548454474d68e597f48414eCc4' as Address;
  const EURCB = '0xd9016a91387db71fbD07Cde32E900E17061dE5A1' as Address;
  const USDCB = '0x9A8Ea4AB461d0Db943ecB1B1e4CE0B68df9061CC' as Address;
  const AWETH = '0x89A9cD1dd6DE3ab7152EF9c7C5496c2946334D0D' as Address;
  const FXPOOL = '0xCbB809d5A5583301e7753D57D73A25C0d12EC232' as Address;
  const CRPOOL = '0xACe9a150cdc3ab8AdBbc3e7CC5d5ce92485624F5' as Address;
  const SENDER = '0x57b3771F6b772C52E81646Aa007D1Ab28d91B3Fe' as Address;

  const ONCHAIN =
    '0x2477447a' +
    '0000000000000000000000000000000000000000000000000000000000000080' +
    '00000000000000000000000000000000000000000000000000000000000001c0' +
    '00000000000000000000000057b3771f6b772c52e81646aa007d1ab28d91b3fe' +
    '000000000000000000000000000000000000000000000000000000006a957992' +
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '000000000000000000000000d9016a91387db71fbd07cde32e900e17061de5a1' +
    '0000000000000000000000000000000000000000000000008ac7230489e80000' +
    '0000000000000000000000000000000000000000000000000000000000000060' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '000000000000000000000000cbb809d5a5583301e7753d57d73a25c0d12ec232' +
    '0000000000000000000000009a8ea4ab461d0db943ecb1b1e4ce0b68df9061cc' +
    '000000000000000000000000ace9a150cdc3ab8adbbc3e7cc5d5ce92485624f5' +
    '00000000000000000000000089a9cd1dd6de3ab7152ef9c7c5496c2946334d0d' +
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '00000000000000000000000089a9cd1dd6de3ab7152ef9c7c5496c2946334d0d' +
    '00000000000000000000000000000000000000000000000000109df67a519761';

  test('the SDK reproduces it exactly', () => {
    const rp: RouterPlan = {
      parts: [
        {
          tokenIn: EURCB,
          amountIn: 10_000000000000000000n,
          hops: [
            { pool: FXPOOL, tokenOut: USDCB },
            { pool: CRPOOL, tokenOut: AWETH },
          ],
        },
      ],
      floors: [{ token: AWETH, minOut: 4_677281567053665n }],
      wrapValue: 0n,
      unwrapAmount: 0n,
      nativeOut: false,
    };
    const [call] = buildRouterSwapExecCalls(ROUTER, rp, {
      recipient: SENDER,
      deadline: 1788180882n,
    });
    expect(call.to).toBe(ROUTER);
    expect(call.data.toLowerCase()).toBe(ONCHAIN);
  });
});

describe('one hop on one pool: direct Pool.swap encodes what Router.swap would', () => {
  // The front sends a single-pool route direct. That is only safe while both paths debit the same
  // input and hold the user to the same floor, recipient and deadline.
  const args = (abi: typeof POOL_ABI, name: string, data: string): unknown[] => {
    const fn = abi.find((e) => e.type === 'function' && e.name === name) as {
      inputs: AbiParameter[];
    };
    return decodeAbiParameters(fn.inputs, `0x${data.slice(10)}`);
  };
  const single = plan(1000, 999, [part(route([P1], ['USDC', 'USDT']), 1, 1000, 999)]);
  const amountOut = 999_000_000_000_000_000_000n;
  const tolPbps = 5_000;
  const minOut = (amountOut * (1_000_000n - BigInt(tolPbps))) / 1_000_000n;
  const opts = {
    slippageFrac: 0.005,
    ...O,
    amountInUnits: 1_000_000_000n,
    serverFloors: { [USDT.toLowerCase()]: { amountOut, minOut, tolPbps } },
    maxTolPbps: tolPbps,
  };

  test('same debit, floor, recipient and deadline', () => {
    const legs = planToLegs(single, opts) as ExecLeg[];
    const rp = must(planToRouterPlan(single, opts));
    const call = { recipient: USER, sender: USER, deadline: 1_788_180_882n };
    const direct = buildSwapExecCalls(legs, call);
    expect(direct.map((c) => c.to)).toEqual([P1]);
    const [tin, tout, amountIn, floor, to, deadline] = args(POOL_ABI, 'swap', direct[0].data);
    const [parts, floors, rTo, rDeadline] = args(
      ROUTER_ABI,
      'swap',
      buildRouterSwapExecCalls(ROUTER, rp, call)[0].data,
    ) as [RouterPlan['parts'], RouterPlan['floors'], string, bigint];
    expect([String(tin), String(tout)].map((a) => a.toLowerCase())).toEqual([
      USDC.toLowerCase(),
      USDT.toLowerCase(),
    ]);
    expect(amountIn).toBe(1_000_000_000n);
    expect(amountIn).toBe(parts[0].amountIn);
    expect(floor).toBe(minOut);
    expect(floor).toBe(floors[0].minOut);
    expect(String(to).toLowerCase()).toBe(String(rTo).toLowerCase());
    expect(deadline).toBe(rDeadline);
  });

  test('same exact approval, to the pool instead of the router', () => {
    const legs = planToLegs(single, opts) as ExecLeg[];
    const [direct] = buildSwapCalls(legs, { recipient: USER, sender: USER });
    const [via] = buildRouterCalls(ROUTER, must(planToRouterPlan(single, opts)), {
      recipient: USER,
    });
    expect(direct.to).toBe(USDC);
    expect(via.to).toBe(USDC);
    expect(approveAmount(direct.data)).toBe(approveAmount(via.data));
    expect(direct.data.slice(0, 10 + 64)).toContain(P1.slice(2).toLowerCase());
  });
});

describe('planToLegs', () => {
  const mustLegs = (legs: ExecLeg[] | null): ExecLeg[] => {
    if (!legs) throw new Error('expected legs');
    return legs;
  };
  const e18 = (n: bigint) => n * 10n ** 18n;
  /** A server floor on `token`: quoted `out`, floor `min` (18-dec whole units). */
  const floorOn = (token: Address, out: bigint, min: bigint, tolPbps: number) => ({
    serverFloors: { [token.toLowerCase()]: { amountOut: e18(out), minOut: e18(min), tolPbps } },
    maxTolPbps: tolPbps,
  });

  test('direct part → 1 leg, float→bigint via token decimals, per-leg slippage floor', () => {
    const p = plan(100, 99, [part(route([POOL_S], ['USDC', 'USDT']), 1, 100, 99)]);
    const legs = mustLegs(planToLegs(p, { slippageFrac: 0.25, ...O }));
    expect(legs.length).toBe(1);
    expect(legs[0].amountIn).toBe(100_000_000n); // 100 USDC @ 6 decimals
    expect(legs[0].minOut).toBe(74_250_000_000_000_000_000n); // 99·0.75 @ 18 decimals
    expect(legs[0].wrapIn).toBeUndefined();
  });

  const crossRoute = route([POOL_V, POOL_S], ['BNB', 'USDC', 'USDT']);
  const crossPlan = plan(1, 599, [part(crossRoute, 1, 1, 599, [600, 599])]);

  test('cross-pool part → 2 legs; leg2.amountIn = leg1.minOut; wrap flags leg1 only', () => {
    const legs = mustLegs(
      planToLegs(crossPlan, { ...O0, nativeIn: true, ...floorOn(USDT, 599n, 599n, 0) }),
    );
    expect(legs.length).toBe(2);
    expect(legs[0].wrapIn).toBe(true);
    expect(legs[0].minOut).toBe(600_000_000n); // bridged USDC @ 6 decimals
    expect(legs[1].amountIn).toBe(legs[0].minOut);
    expect(legs[1].wrapIn).toBeUndefined();
  });

  // A-926. Without a server floor the builder used to floor hop 2 at `q2·(1−s)²` — hop 1's floor
  // funds hop 2, then `s` again on top — while the UI promised `q2·(1−s)`: ~2× the tolerance
  // extractable, authored by the SDK. The SDK never authors a floor (L-43): null instead.
  test('a chained part with no server floor is refused, not floored by the SDK', () => {
    expect(planToLegs(crossPlan, { slippageFrac: 0.01, ...O, nativeIn: true })).toBeNull();
  });

  // Refusals, each fail-closed:
  // - first hop quotes nothing: `leg1MinOut` would be 0n, funding hop 2 with nothing and flooring
  //   it at 0 — a guaranteed `ZeroValue`/`ThresholdViolation` with no protection.
  // - more legs than this builder encodes: used to be silently truncated to its first two legs,
  //   delivering the INTERMEDIATE token. `/route` takes `max_hops` as a request parameter, so a
  //   3-leg part is reachable; `planToRouterPlan` is the path that encodes any number of hops.
  const one = (pools: (Address | undefined)[], toks: string[]) =>
    plan(1, 1, [part(route(pools, toks), 1, 1, 1)]);
  test.each([
    [
      'a cross part whose first hop quotes nothing',
      plan(1, 0, [part(crossRoute, 1, 1, 0, [0, 0])]),
    ],
    [
      'a part with more legs than this builder encodes',
      one([POOL_S, POOL_V, POOL_S], ['USDC', 'USDT', 'BNB', 'USDC']),
    ],
    ['a missing pool address', one([undefined], ['USDC', 'USDT'])],
    ['missing token meta', one([POOL_S], ['USDC', 'WOOF'])],
  ] as const)('refuses %s', (_, p) => expect(planToLegs(p, O0)).toBeNull());

  test('split parts emit largest first', () => {
    const p = plan(1000, 998, [
      part(route([POOL_V], ['USDC', 'USDT']), 0.25, 250, 249),
      part(route([POOL_S], ['USDC', 'USDT']), 0.75, 750, 749),
    ]);
    const legs = mustLegs(planToLegs(p, O0));
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
    const rs = route([POOL_S], ['USDT', 'USDC']); // USDT is the 18-decimal leg in META
    const p = plan(FLOAT_IN, 31, [part(rs, 1, FLOAT_IN, 31)]);
    const approvals = (legs: ExecLeg[]) =>
      buildSwapCalls(legs, { recipient: USER })
        .filter((c) => c.data.startsWith(APPROVE_SEL))
        .map((c) => approveAmount(c.data));

    test('the f64 path overshoots the balance - the bug this pins', () => {
      const legs = mustLegs(planToLegs(p, O0));
      expect(legs[0].amountIn).toBe(31_050_000_000_000_000_000n);
      expect(legs[0].amountIn).toBeGreaterThan(BALANCE); // → TransferFromFailed()
    });

    test('exact units → amountIn IS the balance, and the approval covers exactly it', () => {
      const legs = mustLegs(planToLegs(p, { ...O0, amountInUnits: BALANCE }));
      expect(legs[0].amountIn).toBe(BALANCE);
      expect(approvals(legs)).toEqual([BALANCE]);
    });

    test('split parts sum back to the exact total, none of them over it', () => {
      // 1/3 : 2/3 - fractions with no exact f64 (or decimal) representation.
      const third = 1 / 3;
      const split = plan(FLOAT_IN, 31, [
        part(route([POOL_V], ['USDT', 'USDC']), third, FLOAT_IN * third, 10),
        part(rs, 1 - third, FLOAT_IN * (1 - third), 21),
      ]);
      const legs = mustLegs(planToLegs(split, { ...O0, amountInUnits: BALANCE }));
      expect(legs.length).toBe(2);
      expect(legs.reduce((s, l) => s + l.amountIn, 0n)).toBe(BALANCE); // no dust lost or invented
      for (const l of legs) expect(l.amountIn).toBeLessThan(BALANCE);
      // Σ of the per-(token,pool) approvals is also exactly the balance: distinct spenders.
      expect(approvals(legs).reduce((s, a) => s + a, 0n)).toBe(BALANCE);
    });

    test('a 2-leg part debits the wallet exactly once, at the exact size', () => {
      const cross = route([POOL_V, POOL_S], ['USDT', 'BNB', 'USDC']);
      const legs = mustLegs(
        planToLegs(plan(FLOAT_IN, 31, [part(cross, 1, FLOAT_IN, 31, [0.5, 31])]), {
          ...O0,
          amountInUnits: BALANCE,
          serverFloors: {
            [USDC.toLowerCase()]: { amountOut: 31_000_000n, minOut: 31_000_000n, tolPbps: 0 },
          },
          maxTolPbps: 0,
        }),
      );
      expect(legs[0].amountIn).toBe(BALANCE);
      expect(legs[1].amountIn).toBe(legs[0].minOut); // hop 2 spends the bridged floor, not the wallet
    });

    test('an absent or zero exact total leaves the float path alone', () => {
      for (const amountInUnits of [undefined, 0n])
        expect(mustLegs(planToLegs(p, { ...O0, amountInUnits }))[0].amountIn).toBe(
          31_050_000_000_000_000_000n,
        );
    });
  });

  // N1. The server floor is END-TO-END: `/v1/chain/*` authors ONE `min_out` per output token and
  // `planToRouterPlan` floors the SUM of the parts landing it. Encoding that floor on every part
  // asks each slice to deliver the aggregate, so a split the server accepted reverts
  // `ThresholdViolation`. These pin the leg path to the router path's aggregate semantics.
  const split7030 = (outB: number) =>
    plan(1000, 990, [
      part(route([POOL_S], ['USDC', 'USDT']), 0.7, 700, 700),
      part(route([POOL_V], ['USDC', 'USDT']), 0.3, 300, outB),
    ]);
  const floor990 = (token: Address) => ({ ...O0, ...floorOn(token, 1000n, 990n, 10_000) });

  test('a split meets the server floor in AGGREGATE — no part carries the whole floor', () => {
    const legs = mustLegs(planToLegs(split7030(300), floor990(USDT)));
    // Each slice is floored on its own share, not the aggregate: 700·0.99 and 300·0.99.
    expect(legs.map((l) => l.minOut)).toEqual([e18(693n), e18(297n)]); // Σ === 990, each < 990
  });

  test('an aggregate below the server floor is NOT lowered — it reverts instead', () => {
    // Parts quote 900 in total; the server floor is 990. The floor is authoritative: the builder
    // must not scale it down to the stale replica, so the encoded batch cannot meet it and reverts.
    const legs = mustLegs(planToLegs(split7030(200), floor990(USDT)));
    expect(legs.reduce((s, l) => s + l.minOut, 0n)).toBe(e18(990n));
    for (const l of legs) expect(l.minOut).toBeGreaterThan(l.quotedOut);
  });

  test('a chained hop 2 carries its slice of the server floor, funded by hop 1', () => {
    const toks = ['USDC', 'USDT', 'DAI'];
    const p = plan(1000, 990, [
      part(route([POOL_V, POOL_S], toks), 0.7, 700, 700, [800]),
      part(route([POOL_S, POOL_V], toks), 0.3, 300, 300, [400]),
    ]);
    const legs = mustLegs(planToLegs(p, floor990(DAI)));
    expect(legs.length).toBe(4);
    // Hop 1 is funded from the wallet, floored on its own quote at the server tolerance.
    expect(legs[0].minOut).toBe(e18(792n)); // 800·0.99 USDT
    expect(legs[2].minOut).toBe(e18(396n)); // 400·0.99 USDT
    // Hop 2 spends hop 1's floor and carries only its part's slice of the end-to-end floor.
    expect(legs[1].amountIn).toBe(legs[0].minOut);
    expect(legs[3].amountIn).toBe(legs[2].minOut);
    expect(legs[1].minOut).toBe(e18(693n)); // 700/1000 of 990 DAI
    expect(legs[3].minOut).toBe(e18(297n)); // residual, so Σ === 990
    expect(legs[1].chained && legs[3].chained).toBe(true);
  });
});

/** The floor check must run on the server's raw `amount_out`, not the f64 plan amount. An 18-dec
 *  output past f64's 15-digit integer range is truncated when it lands in `quote.amountOut`, so a
 *  check against the plan asks for a DIFFERENT floor than the server authored. Both builders are
 *  pinned here; the pre-fix calls (`assertServerFloor(quotedOut, …)` / `(amount, …)`) throw. */
describe('server floors — checked against the server amount_out, not the plan float', () => {
  const amountOut = 1_000_000_000_000_000_003n; // 1e18 + 3 wei: not f64-representable
  const tolPbps = 1;
  const minOut = (amountOut * (1_000_000n - BigInt(tolPbps))) / 1_000_000n;
  // What `Number(formatUnits(amountOut, 18))` becomes: 1, i.e. `toUnits` hands over 1e18.
  const planFloatUnits = 1_000_000_000_000_000_000n;

  test('the regression is real: the truncated amount fails the server floor assertion', () => {
    const planExpected = (planFloatUnits * (1_000_000n - BigInt(tolPbps))) / 1_000_000n;
    expect(minOut).not.toBe(planExpected);
    // The delivered floor is consistent with the server integer...
    expect(() => assertServerFloor(amountOut, tolPbps, minOut, tolPbps)).not.toThrow();
    // ...and NOT with the f64 plan amount. This is the call the pre-fix builder made.
    expect(() => assertServerFloor(planFloatUnits, tolPbps, minOut, tolPbps)).toThrow();
  });

  const opts = {
    slippageFrac: 0.01,
    ...O,
    serverFloors: { [USDT.toLowerCase()]: { amountOut, minOut, tolPbps } },
    maxTolPbps: tolPbps,
  };
  const single = plan(1, 1, [part(route([P1], ['USDC', 'USDT']), 1, 1, 1)]);

  test('planToLegs encodes the server floor after checking the raw amount_out', () => {
    const legs = planToLegs(single, opts);
    expect(legs?.[0].minOut).toBe(minOut);
  });

  test('planToRouterPlan encodes the server floor after checking the raw amount_out', () => {
    const rp = planToRouterPlan(single, { ...opts, amountInUnits: 1n });
    expect(rp?.floors[0].minOut).toBe(minOut);
  });

  // The formula only proves the server agrees with ITSELF. `{X, 999000, X/1000}` — legal all the
  // way to the service's own ceiling — satisfies it and leaves no floor at all, so the caller's own
  // tolerance, the one number the server did not author, has to bound it.
  test('a tolerance wider than the caller asked for is refused, however consistent', () => {
    const wideTol = 999_000;
    const wide = (amountOut * (1_000_000n - BigInt(wideTol))) / 1_000_000n;
    const wideOpts = {
      ...opts,
      serverFloors: { [USDT.toLowerCase()]: { amountOut, minOut: wide, tolPbps: wideTol } },
    };
    expect(() => planToLegs(single, wideOpts)).toThrow(/exceeds the requested/);
    expect(() => planToRouterPlan(single, { ...wideOpts, amountInUnits: 1n })).toThrow(
      /exceeds the requested/,
    );
  });

  test('a server floor with no caller ceiling is refused, never encoded unbounded', () => {
    const { maxTolPbps: _drop, ...noCeiling } = opts;
    expect(() => planToLegs(single, noCeiling)).toThrow(/maxTolPbps is required/);
    expect(() => planToRouterPlan(single, { ...noCeiling, amountInUnits: 1n })).toThrow(
      /maxTolPbps is required/,
    );
  });
});
