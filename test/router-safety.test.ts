/**
 * Money-path guards on the two swap-calldata builders.
 *
 * Both of these functions emit calldata a wallet signs. Every case below is a shape that
 * previously produced *executable* calldata with no protection: a zero recipient (the pool
 * does not reject it, and the native path's `safeTransferETH(0)` succeeds), a zero minOut,
 * a slippage fraction >= 1 that collapses every floor to zero, and a float `minOut` that
 * went exponential above ~1e21 units. They are asserted here because none of them revert
 * on chain — they simply lose the money quietly.
 */

import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../src/abis/Pool';
import { type AbiError, encodeErrorResult, encodeFn } from '../src/eth/abi';
import { RpcRevertError } from '../src/eth/transport';
import type { Address, Eip1193Provider } from '../src/eth/types';
import { buildSwapCalls, planToLegs } from '../src/router/index';
import {
  activeFeedId,
  activeOracle,
  chainVenue,
  deployedChainIds,
  nativeUsdc,
  staticVenuePools,
} from '../src/venues/registry';
import {
  buildVenueApprovalCalls,
  buildVenueExecCalls,
  buildVenueSwapExecCalls,
  quoteAllExactIn,
} from '../src/venues/router';

/** Arc testnet: the only chain BTR is deployed on. */
const ARC = 5_042_002;
const ARC_TOKENS = chainVenue(ARC).tokens;

/** Encode a real Pool custom error exactly as the node would return it in `error.data`. */
const revertData = (name: string, args: unknown[]) => {
  const entry = POOL_ABI.find(
    (i: { type?: string; name?: string }) => i.type === 'error' && i.name === name,
  ) as AbiError;
  return encodeErrorResult(entry, args);
};

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const ALICE = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN_A = ARC_TOKENS.USDC; // both in the stable core, so pools are candidates
const TOKEN_B = ARC_TOKENS.USDT;

/** Provider that never answers — the quote path must fail on the recipient BEFORE any call. */
const deadProvider: Eip1193Provider = {
  request: async () => {
    throw new Error('provider should not have been called');
  },
} as unknown as Eip1193Provider;

describe('quoteAllExactIn refuses unsafe calldata inputs', () => {
  const base = {
    chainId: ARC,
    provider: deadProvider,
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    amountIn: 1_000_000n,
    minOut: 0n,
  };

  test('an explicit zero recipient throws instead of building burn-address calldata', async () => {
    // Pool.swap does not reject recipient == 0 and PoolIOLib.push -> safeTransferETH(0)
    // SUCCEEDS, so this calldata would have executed and paid the burn address.
    expect(quoteAllExactIn({ ...base, recipient: ZERO })).rejects.toThrow(/non-zero address/);
  });

  test('a missing recipient throws rather than defaulting to ZERO_ADDRESS', async () => {
    expect(
      quoteAllExactIn({ ...base, recipient: undefined as unknown as Address }),
    ).rejects.toThrow(/non-zero address/);
  });

  test('a negative minOut throws', async () => {
    expect(quoteAllExactIn({ ...base, recipient: ALICE, minOut: -1n })).rejects.toThrow(/minOut/);
  });

  test('recipient and minOut are required at the type level', () => {
    // @ts-expect-error recipient is mandatory: there is no safe default for it.
    const _a: Parameters<typeof quoteAllExactIn>[0] = { ...base, minOut: 0n };
    // @ts-expect-error minOut is mandatory: a defaulted 0 is zero slippage protection.
    const _b: Parameters<typeof quoteAllExactIn>[0] = {
      ...base,
      recipient: ALICE,
      minOut: undefined,
    };
    expect(true).toBe(true);
  });
});

describe('quoteAllExactIn separates a protocol halt from a transport failure', () => {
  const poolTag = staticVenuePools(ARC)[0].tag;
  const poolAddr = staticVenuePools(ARC)[0].address;

  const runWith = async (err: Error) => {
    const skips: { kind: string; reason: string; tag: string }[] = [];
    const provider = {
      request: async () => {
        throw err;
      },
    } as unknown as Eip1193Provider;
    await quoteAllExactIn({
      chainId: ARC,
      provider,
      tokenIn: TOKEN_A,
      tokenOut: TOKEN_B,
      amountIn: 1_000_000n,
      recipient: ALICE,
      minOut: 0n,
      onSkip: (s) => skips.push({ kind: s.kind, reason: s.reason, tag: s.tag }),
    });
    return skips;
  };

  test('a decoded custom error surfaces as a halt with its name, not a silent null', async () => {
    // StaleData(age,maxAge) — a deliberate on-chain stop. Delisting the venue as if the RPC blinked
    // is exactly the confusion this test exists to prevent.
    const data = revertData('StaleData', [9999, 1800]);
    const skips = await runWith(new RpcRevertError('execution reverted', 3, data));
    const halted = skips.filter((s) => s.kind === 'halt');
    expect(halted.length).toBeGreaterThan(0);
    expect(halted[0].reason).toBe('StaleData');
    expect(skips.some((s) => s.kind === 'transport')).toBe(false);
  });

  test('a deliberate depeg halt is named, not collapsed into a null quote', async () => {
    const skips = await runWith(
      new RpcRevertError(
        'execution reverted',
        3,
        revertData('BaseDepegged', [990000000000000000n, 1000n]),
      ),
    );
    expect(skips.filter((s) => s.kind === 'halt').map((s) => s.reason)).toContain('BaseDepegged');
  });

  test('an RPC transport failure is reported as transport, never as a halt', async () => {
    const skips = await runWith(new Error('fetch failed: ECONNRESET'));
    expect(skips.length).toBeGreaterThan(0);
    expect(skips.every((s) => s.kind === 'transport')).toBe(true);
  });

  test('an undecodable revert is still a halt (the pool refused), not transport', async () => {
    const skips = await runWith(new RpcRevertError('execution reverted', 3, '0xdeadbeef'));
    expect(skips.every((s) => s.kind === 'halt')).toBe(true);
  });

  test('every skip names the pool it came from', async () => {
    const skips = await runWith(new Error('boom'));
    expect(skips.some((s) => s.tag === poolTag)).toBe(true);
    expect(poolAddr).toBeTruthy();
  });
});

// ── planToLegs ───────────────────────────────────────────────────────────────

const POOL = '0x2222222222222222222222222222222222222222';
const meta: Record<string, { address: Address; decimals: number }> = {
  A: { address: TOKEN_A, decimals: 18 },
  B: { address: TOKEN_B, decimals: 18 },
  C: { address: ALICE, decimals: 18 },
};
const tokenOf = (s: string) => meta[s];
/** Every pool in these fixtures is the factory's; the allowlist itself is tested separately. */
const isOfficialPool = () => true;

const directPlan = (amountIn: number, amountOut: number) =>
  ({
    amountIn,
    parts: [
      {
        fraction: 1,
        route: { legs: [{ tokenIn: 'A', tokenOut: 'B', poolAddr: POOL }] },
        quote: { amountOut, fills: [{ amountOut }] },
      },
    ],
  }) as never;

describe('planToLegs validates slippage and derives minOut in bigint space', () => {
  test('slippageFrac >= 1 throws instead of yielding minOut = 0', () => {
    // The pre-fix path computed amountOut * (1 - 1) = 0 and shipped a batch with no floor.
    expect(() =>
      planToLegs(directPlan(100, 100), { slippageFrac: 1, tokenOf, isOfficialPool }),
    ).toThrow(/\[0, 1\)/);
    expect(() =>
      planToLegs(directPlan(100, 100), { slippageFrac: 1.5, tokenOf, isOfficialPool }),
    ).toThrow();
  });

  test('a negative or NaN slippageFrac throws', () => {
    expect(() =>
      planToLegs(directPlan(100, 100), { slippageFrac: -0.01, tokenOf, isOfficialPool }),
    ).toThrow();
    expect(() =>
      planToLegs(directPlan(100, 100), { slippageFrac: Number.NaN, tokenOf, isOfficialPool }),
    ).toThrow();
  });

  test('slippageFrac = 0 is legal and leaves minOut at the full quote', () => {
    const legs = planToLegs(directPlan(100, 100), { slippageFrac: 0, tokenOf, isOfficialPool });
    expect(legs?.[0].minOut).toBe(100n * 10n ** 18n);
  });

  test('minOut survives above 1e21 units, where toFixed used to go exponential', () => {
    // 1e6 tokens at 18 decimals = 1e24 units. The old float+toFixed path produced "1e+24"
    // and parseUnits could not read it, so the floor came out garbage.
    const legs = planToLegs(directPlan(1e6, 1e6), { slippageFrac: 0.005, tokenOf, isOfficialPool });
    const expected = (1_000_000n * 10n ** 18n * 995_000n) / 1_000_000n;
    expect(legs?.[0].minOut).toBe(expected);
    expect(legs?.[0].minOut.toString()).not.toContain('e');
    expect(legs?.[0].amountIn).toBe(1_000_000n * 10n ** 18n);
  });

  test('minOut rounds DOWN, never above what the quote promised', () => {
    const legs = planToLegs(directPlan(1, 1), { slippageFrac: 0.005, tokenOf, isOfficialPool });
    expect(legs?.[0].minOut).toBeLessThan(10n ** 18n);
    expect(legs?.[0].minOut).toBe((10n ** 18n * 995_000n) / 1_000_000n);
  });
});

/**
 * The registry is the one place a bot can silently trade the wrong chain: quoting another chain's
 * addresses from an Arc-configured bot reverts nowhere and logs nothing, it just executes against
 * a chain nobody meant. So resolution for an undeployed chain must THROW, not fall back.
 */
describe('chain resolution refuses to guess', () => {
  test('an undeployed chain throws instead of falling back to a deployed one', () => {
    const UNDEPLOYED = 1_337_999;
    expect(deployedChainIds()).not.toContain(UNDEPLOYED);
    expect(() => staticVenuePools(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => nativeUsdc(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => activeOracle(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => activeFeedId(UNDEPLOYED, 'USDC')).toThrow(/no BTR deployment for chain 1337999/);
  });

  // Arc's four-core ceremony broadcast four pools. The generator knew two pool classes when Arc
  // landed, so `cryptoPool` was dropped WITHOUT a throw — a venue that still resolved, still
  // quoted, and simply could not route WETH/WBTC/CBBTC/BNB/XAUT/PAXG. Pinned by tag and roster
  // size so losing a class again fails here rather than downstream as an unroutable pair.
  test('arc resolves all four broadcast pools, crypto and stocks cores included', () => {
    expect(deployedChainIds()).toContain(ARC);
    const byTag = Object.fromEntries(staticVenuePools(ARC).map((p) => [p.tag, p]));
    expect(Object.keys(byTag).sort()).toEqual(['btr-crypto', 'btr-fx', 'btr-stable', 'btr-stocks']);
    expect(byTag['btr-crypto']!.tokens).toHaveLength(11);
    expect(chainVenue(ARC).refFeeds).toContain('WETH-USDC');
  });

  // Faucet twins own no feed and are absent from `.symbols`, so they reach the router ONLY through
  // the `.feedTwins` exemption. Every layer has to agree or the leg is half-present: a token with
  // no pool never routes, a pool symbol with no token is dropped SILENTLY by `staticVenuePools`
  // (`.filter(Boolean)`), and a missing feed alias sends the bot's `liveMarks` to a `?? 1` that is
  // 14% wrong on EURC.b. This is the whole gate that kept the bot off the mintable legs.
  test('arc faucet twins are routable, marked and off the ordinal roster', () => {
    const v = chainVenue(ARC);
    const byTag = Object.fromEntries(staticVenuePools(ARC).map((p) => [p.tag, p]));
    for (const [sym, feed, tags] of [
      ['USDCB', 'USDT-USDC', ['btr-stable', 'btr-fx', 'btr-crypto', 'btr-stocks']],
      ['EURCB', 'EURC-USDC', ['btr-fx', 'btr-crypto']],
    ] as const) {
      expect(v.tokens[sym]).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // Borrowed, never minted: the alias must BE the shared feed's id, not a new one.
      expect(activeFeedId(ARC, sym)).toBe(v.feedIds[feed]!);
      for (const tag of tags) expect(byTag[tag]!.tokens).toContain(v.tokens[sym]!);
      // A twin in `rosters` would make the feed-completeness checks demand a feed that must not
      // exist, which is the break `noteFaucetTwins` exists to prevent.
      for (const roster of Object.values(v.rosters)) expect(roster).not.toContain(sym);
      // And it must never take an ordinal: the recorded order is the 26 real feeds.
      expect(Object.keys(v.feedIds).indexOf(`${sym}-USDC`)).toBeGreaterThanOrEqual(26);
    }
  });

  test('the error names what IS deployed, so the operator sees the mismatch', () => {
    expect(() => chainVenue(0)).toThrow(/deployed: \[5042002\]/);
  });

  test('every deployed chain resolves native USDC, an oracle and at least one pool', () => {
    for (const id of deployedChainIds()) {
      expect(nativeUsdc(id)).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(activeOracle(id)).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(staticVenuePools(id).length).toBeGreaterThan(0);
      // Every pool must list at least both its base and one counter-asset, else it quotes nothing.
      for (const p of staticVenuePools(id)) expect(p.tokens!.length).toBeGreaterThan(1);
    }
  });

  test('the base resolves to the signed USDC-USD reference, never a USDC/USDC identity', () => {
    const id = ARC;
    expect(activeFeedId(id, 'USDC')).toBe(chainVenue(id).feedIds['USDC-USD']!);
    expect(chainVenue(id).feedIds['USDC-USDC']).toBeUndefined();
  });
});

// ── Pool-address provenance, chained floors, unwrap direction ─────────────────

const ROGUE = '0x6666666666666666666666666666666666666666';

/** Direct part whose pool is `poolAddr`, so the allowlist is the only thing under test. */
const planOnPool = (poolAddr: string) =>
  ({
    amountIn: 100,
    parts: [
      {
        fraction: 1,
        route: { legs: [{ tokenIn: 'A', tokenOut: 'B', poolAddr }] },
        quote: { amountOut: 99, fills: [{ amountOut: 99 }] },
      },
    ],
  }) as never;

/** Cross part: A→B on POOL, then B→C on POOL2. */
const POOL2 = '0x3333333333333333333333333333333333333333';
const crossPlan = () =>
  ({
    amountIn: 100,
    parts: [
      {
        fraction: 1,
        route: {
          legs: [
            { tokenIn: 'A', tokenOut: 'B', poolAddr: POOL },
            { tokenIn: 'B', tokenOut: 'C', poolAddr: POOL2 },
          ],
        },
        quote: { amountOut: 98, fills: [{ amountOut: 99 }, { amountOut: 98 }] },
      },
    ],
  }) as never;

describe('planToLegs routes only through pools the caller vouches for', () => {
  const officialOnly = (p: Address) => p.toLowerCase() === POOL.toLowerCase();

  test('a pool outside the allowlist yields no plan at all', () => {
    expect(
      planToLegs(planOnPool(ROGUE), {
        slippageFrac: 0,
        tokenOf,
        isOfficialPool: officialOnly,
      }),
    ).toBeNull();
  });

  test('the same plan on an allowlisted pool builds', () => {
    const legs = planToLegs(planOnPool(POOL), {
      slippageFrac: 0,
      tokenOf,
      isOfficialPool: officialOnly,
    });
    expect(legs?.length).toBe(1);
    expect(legs?.[0].pool.toLowerCase()).toBe(POOL.toLowerCase());
  });

  test('one rejected hop of a cross kills the WHOLE plan, never just that hop', () => {
    // Fails closed: a partial plan would deliver the intermediate asset and call it the swap.
    expect(
      planToLegs(crossPlan(), { slippageFrac: 0, tokenOf, isOfficialPool: officialOnly }),
    ).toBeNull();
  });
});

describe('a chained second hop is floored by the server or not at all', () => {
  // A-926. The no-server fallback floored hop 2 at q2·(1−s)² (hop 1's floor funds hop 2, then s
  // again) while the UI promised q2·(1−s): ~2× the tolerance extractable, authored by the SDK.
  test('no server floor: the chained plan is refused, never floored locally', () => {
    expect(planToLegs(crossPlan(), { slippageFrac: 0.01, tokenOf, isOfficialPool })).toBeNull();
  });

  test('with a server floor hop 2 is funded by hop 1 floor and floored on the server number', () => {
    const c = meta.C;
    const amountOut = 98n * 10n ** BigInt(c.decimals);
    const floor = { amountOut, minOut: (amountOut * 99n) / 100n, tolPbps: 10_000 };
    const legs = planToLegs(crossPlan(), {
      slippageFrac: 0.5, // ignored on a chained part: the server tolerance scales hop 1
      tokenOf,
      isOfficialPool,
      serverFloors: { [c.address.toLowerCase()]: floor },
      maxTolPbps: floor.tolPbps,
    });
    expect(legs?.length).toBe(2);
    const [l1, l2] = legs as NonNullable<typeof legs>;
    expect(l1.minOut).toBe((l1.quotedOut * 99n) / 100n);
    expect(l2.amountIn).toBe(l1.minOut);
    expect(l2.minOut).toBe(floor.minOut);
    expect(l2.quotedOut).toBe(amountOut);
  });
});

describe('toUnits refuses a scale it cannot represent', () => {
  test('>18 decimals throws instead of silently clamping to 18', () => {
    const bad = { ...meta, B: { address: TOKEN_B, decimals: 24 } };
    expect(() =>
      planToLegs(planOnPool(POOL), {
        slippageFrac: 0,
        tokenOf: (s: string) => bad[s],
        isOfficialPool,
      }),
    ).toThrow(/\[0, 18\]/);
  });
});

describe('a nativeOut batch refuses to unwrap on someone else s behalf', () => {
  const WNATIVE = '0x4444444444444444444444444444444444444444' as Address;
  const BOB = '0x5555555555555555555555555555555555555555' as Address;
  const unwrapLeg = [
    {
      pool: POOL as Address,
      tokenIn: TOKEN_A,
      tokenOut: WNATIVE,
      amountIn: 10n,
      minOut: 9n,
      quotedOut: 10n,
      unwrapOut: true,
    },
  ];

  test('recipient != sender throws: the swap pays recipient, the withdraw burns from sender', () => {
    expect(() =>
      buildSwapCalls(unwrapLeg, { recipient: BOB, sender: ALICE, wrappedNative: WNATIVE }),
    ).toThrow(/recipient must be the sender/);
  });

  test('recipient == sender builds the unwrap', () => {
    const calls = buildSwapCalls(unwrapLeg, {
      recipient: ALICE,
      sender: ALICE,
      wrappedNative: WNATIVE,
    });
    expect(calls[calls.length - 1].to.toLowerCase()).toBe(WNATIVE.toLowerCase());
  });
});

describe('a chained batch refuses to swap on someone else s behalf', () => {
  const BOB = '0x5555555555555555555555555555555555555555' as Address;
  const MID = '0x7777777777777777777777777777777777777777' as Address;
  // Hop 1 pays `recipient`; hop 2 pulls the intermediate from `msg.sender`. Unless the two are the
  // same account, hop 1's output lands at the recipient and hop 2 either reverts or spends the
  // SENDER's own unrelated balance of the intermediate. Only the unwrap path used to be checked.
  const leg = (tokenIn: Address, tokenOut: Address, amountIn: bigint) => ({
    pool: POOL as Address,
    tokenIn,
    tokenOut,
    amountIn,
    minOut: amountIn - 1n,
    quotedOut: amountIn,
  });
  const chained = [leg(TOKEN_A, MID, 10n), leg(MID, TOKEN_B, 9n)];

  test('recipient != sender throws, with no unwrap anywhere in the batch', () => {
    expect(() => buildSwapCalls(chained, { recipient: BOB, sender: ALICE })).toThrow(
      /recipient must be the sender/,
    );
  });

  test('a chained batch with no sender at all is refused, never assumed self-directed', () => {
    expect(() => buildSwapCalls(chained, { recipient: BOB })).toThrow(/sender is required/);
  });

  test('an unchained split to a third party still builds', () => {
    const split = [leg(TOKEN_A, MID, 10n), leg(TOKEN_A, TOKEN_B, 10n)];
    expect(() => buildSwapCalls(split, { recipient: BOB, sender: ALICE })).not.toThrow();
  });

  test('recipient == sender builds both hops', () => {
    const calls = buildSwapCalls(chained, { recipient: ALICE, sender: ALICE });
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe('the venue swap deadline is a send-time window, not a quote-time one', () => {
  // `quoteAllExactIn` bakes `defaultDeadline()` into the calldata it returns. That window is then
  // spent on everything between the quote and the broadcast — an approval mining first, a wallet
  // prompt, an operator reading the numbers — and the swap reverts `DeadlineExpired` after paying
  // gas. `buildVenueExecCalls` re-stamps it, so the window starts when the call is BUILT.
  const quote = (deadline: bigint) => ({
    venue: 'btr' as const,
    pool: staticVenuePools(ARC)[0].address,
    tag: staticVenuePools(ARC)[0].tag,
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    amountIn: 1_000_000n,
    amountOut: 999_000n,
    calldata: encodeFn({
      abi: POOL_ABI,
      functionName: 'swap',
      args: [TOKEN_A, TOKEN_B, 1_000_000n, 990_000n, ALICE, deadline],
    }),
  });

  const tailWord = (d: string) => BigInt(`0x${d.slice(-64)}`);

  test('a stale quote-time deadline is replaced at build', () => {
    const stale = 1_000n; // long expired
    const [call] = buildVenueExecCalls(quote(stale), { needsApproval: () => false });
    expect(tailWord(call.data)).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });

  test('a swap built AFTER the approval is re-stamped then, not frozen at approval build', () => {
    const q = quote(1_000n);
    // Phase 1: approvals carry no deadline, so they can be built/sent well ahead.
    const approvals = buildVenueApprovalCalls(q, { approveMax: true });
    expect(approvals.length).toBe(1);
    expect(approvals[0].data.slice(0, 10)).toBe('0x095ea7b3'); // approve(token, pool)
    expect(approvals[0].to).toBe(TOKEN_A);
    // Phase 2: the swap is built at send time and gets the deadline chosen then.
    const [swap] = buildVenueSwapExecCalls(q, { deadline: 7_777n });
    expect(tailWord(swap.data)).toBe(7_777n);
    // Unmocked, the window starts at the swap build, not at approval build.
    const [fresh] = buildVenueSwapExecCalls(q);
    expect(tailWord(fresh.data)).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });

  test('buildVenueExecCalls composes the two phases', () => {
    const q = quote(1_000n);
    const both = buildVenueExecCalls(q, { approveMax: true });
    expect(both.length).toBe(2);
    expect(both[0].data.slice(0, 10)).toBe('0x095ea7b3'); // approve
    expect(both[1].to).toBe(q.pool);
    expect(both[1].data.slice(0, 10)).toBe(q.calldata.slice(0, 10)); // swap
  });

  test('a negative deadline is refused, not encoded as an invalid word', () => {
    expect(() => buildVenueSwapExecCalls(quote(1_000n), { deadline: -1n })).toThrow(/deadline/);
  });

  test('everything except the deadline word survives byte-for-byte', () => {
    const q = quote(1_000n);
    const [call] = buildVenueExecCalls(q, { needsApproval: () => false });
    const head = (d: string) => d.slice(0, d.length - 64);
    expect(head(call.data)).toBe(head(q.calldata));
    expect(call.to).toBe(q.pool);
  });

  test('an explicit deadline is honoured, and foreign calldata is left alone', () => {
    const [call] = buildVenueExecCalls(quote(1_000n), {
      needsApproval: () => false,
      deadline: 42n,
    });
    expect(tailWord(call.data)).toBe(42n);

    // Not a `Pool.swap`: nothing is rewritten.
    const foreign = { ...quote(1_000n), calldata: '0xdeadbeef' as const };
    const [other] = buildVenueExecCalls(foreign, { needsApproval: () => false });
    expect(other.data).toBe('0xdeadbeef');
  });
});
