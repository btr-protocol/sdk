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
import { planToLegs } from '../src/router/index';
import { quoteAllExactIn } from '../src/venues/router';
import { SEPOLIA_BTR, SEPOLIA_CHAIN_ID, SEPOLIA_TOKENS } from '../src/venues/sepolia';
import {
  activeFeedId,
  activeOracle,
  activeUsdc,
  chainVenue,
  deployedChainIds,
  staticVenuePools,
} from '../src/venues/registry';
import { RpcRevertError } from '../src/eth/transport';
import { encodeErrorResult, type AbiError } from '../src/eth/abi';
import { POOL_ABI } from '../src/abis/Pool';
import type { Address, Eip1193Provider } from '../src/eth/types';

/** Encode a real Pool custom error exactly as the node would return it in `error.data`. */
const revertData = (name: string, args: unknown[]) => {
  const entry = POOL_ABI.find(
    (i: { type?: string; name?: string }) => i.type === 'error' && i.name === name,
  ) as AbiError;
  return encodeErrorResult(entry, args);
};

const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const ALICE = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN_A = SEPOLIA_TOKENS.USDC; // both in the stable core, so pools are candidates
const TOKEN_B = SEPOLIA_TOKENS.USDT;

/** Provider that never answers — the quote path must fail on the recipient BEFORE any call. */
const deadProvider: Eip1193Provider = {
  request: async () => {
    throw new Error('provider should not have been called');
  },
} as unknown as Eip1193Provider;

describe('quoteAllExactIn refuses unsafe calldata inputs', () => {
  const base = {
    chainId: SEPOLIA_CHAIN_ID,
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
    const _b: Parameters<typeof quoteAllExactIn>[0] = { ...base, recipient: ALICE, minOut: undefined };
    expect(true).toBe(true);
  });
});

describe('quoteAllExactIn separates a protocol halt from a transport failure', () => {
  const poolTag = staticVenuePools(SEPOLIA_CHAIN_ID)[0].tag;
  const poolAddr = staticVenuePools(SEPOLIA_CHAIN_ID)[0].address;

  const runWith = async (err: Error) => {
    const skips: { kind: string; reason: string; tag: string }[] = [];
    const provider = {
      request: async () => {
        throw err;
      },
    } as unknown as Eip1193Provider;
    await quoteAllExactIn({
      chainId: SEPOLIA_CHAIN_ID,
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
    const skips = await runWith(new RpcRevertError('execution reverted', 3, revertData('BaseDepegged', [990000000000000000n, 1000n])));
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
    expect(() => planToLegs(directPlan(100, 100), { slippageFrac: 1, tokenOf })).toThrow(/\[0, 1\)/);
    expect(() => planToLegs(directPlan(100, 100), { slippageFrac: 1.5, tokenOf })).toThrow();
  });

  test('a negative or NaN slippageFrac throws', () => {
    expect(() => planToLegs(directPlan(100, 100), { slippageFrac: -0.01, tokenOf })).toThrow();
    expect(() => planToLegs(directPlan(100, 100), { slippageFrac: NaN, tokenOf })).toThrow();
  });

  test('slippageFrac = 0 is legal and leaves minOut at the full quote', () => {
    const legs = planToLegs(directPlan(100, 100), { slippageFrac: 0, tokenOf });
    expect(legs?.[0].minOut).toBe(100n * 10n ** 18n);
  });

  test('minOut survives above 1e21 units, where toFixed used to go exponential', () => {
    // 1e6 tokens at 18 decimals = 1e24 units. The old float+toFixed path produced "1e+24"
    // and parseUnits could not read it, so the floor came out garbage.
    const legs = planToLegs(directPlan(1e6, 1e6), { slippageFrac: 0.005, tokenOf });
    const expected = (1_000_000n * 10n ** 18n * 995_000n) / 1_000_000n;
    expect(legs?.[0].minOut).toBe(expected);
    expect(legs?.[0].minOut.toString()).not.toContain('e');
    expect(legs?.[0].amountIn).toBe(1_000_000n * 10n ** 18n);
  });

  test('minOut rounds DOWN, never above what the quote promised', () => {
    const legs = planToLegs(directPlan(1, 1), { slippageFrac: 0.005, tokenOf });
    expect(legs?.[0].minOut).toBeLessThan(10n ** 18n);
    expect(legs?.[0].minOut).toBe((10n ** 18n * 995_000n) / 1_000_000n);
  });
});

describe('SEPOLIA_BTR.fxPool is declared-but-undeployed', () => {
  test('fxPool is present as a key and explicitly undefined', () => {
    expect('fxPool' in SEPOLIA_BTR).toBe(true);
    expect(SEPOLIA_BTR.fxPool).toBeUndefined();
  });

  test('the venue registry lists no FX pool while it is undeployed', () => {
    expect(staticVenuePools(SEPOLIA_CHAIN_ID).some((p) => p.tag === 'btr-fx')).toBe(false);
  });

  test('no stale FX address from a superseded broadcast leaks into the registry', () => {
    const stale = '0x18c7376a4f9b3c3fb8a0a33faf3c55ad225cb229';
    expect(staticVenuePools(SEPOLIA_CHAIN_ID).some((p) => p.address.toLowerCase() === stale)).toBe(
      false,
    );
  });
});

/**
 * The registry is the one place a bot can silently trade the wrong chain: quoting Sepolia
 * addresses from an Arc-configured bot reverts nowhere and logs nothing, it just executes against
 * a chain nobody meant. So resolution for an undeployed chain must THROW, not fall back.
 */
describe('chain resolution refuses to guess', () => {
  test('an undeployed chain throws instead of falling back to a deployed one', () => {
    const UNDEPLOYED = 1_337_999;
    expect(deployedChainIds()).not.toContain(UNDEPLOYED);
    expect(() => staticVenuePools(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => activeUsdc(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => activeOracle(UNDEPLOYED)).toThrow(/no BTR deployment for chain 1337999/);
    expect(() => activeFeedId(UNDEPLOYED, 'USDC')).toThrow(/no BTR deployment for chain 1337999/);
  });

  // Arc's four-core ceremony broadcast three pools. The generator knew two pool classes when Arc
  // landed, so `cryptoPool` was dropped WITHOUT a throw — a venue that still resolved, still
  // quoted, and simply could not route WETH/WBTC/CBBTC/BNB/XAUT/PAXG. Pinned by tag and roster
  // size so losing a class again fails here rather than downstream as an unroutable pair.
  test('arc resolves all three broadcast pools, crypto core included', () => {
    const ARC = 5_042_002;
    expect(deployedChainIds()).toContain(ARC);
    const byTag = Object.fromEntries(staticVenuePools(ARC).map((p) => [p.tag, p]));
    expect(Object.keys(byTag).sort()).toEqual(['btr-crypto', 'btr-fx', 'btr-stable']);
    expect(byTag['btr-crypto']!.tokens).toHaveLength(9);
    expect(chainVenue(ARC).refFeeds).toContain('WETH-USDC');
  });

  test('the error names what IS deployed, so the operator sees the mismatch', () => {
    expect(() => chainVenue(0)).toThrow(new RegExp(`deployed: \\[5042002, ${SEPOLIA_CHAIN_ID}\\]`));
  });

  test('every deployed chain resolves a base, an oracle and at least one pool', () => {
    for (const id of deployedChainIds()) {
      expect(activeUsdc(id)).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(activeOracle(id)).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(staticVenuePools(id).length).toBeGreaterThan(0);
      // Every pool must list at least both its base and one counter-asset, else it quotes nothing.
      for (const p of staticVenuePools(id)) expect(p.tokens!.length).toBeGreaterThan(1);
    }
  });

  test('the base resolves to the signed USDC-USD reference, never a USDC/USDC identity', () => {
    const id = SEPOLIA_CHAIN_ID;
    expect(activeFeedId(id, 'USDC')).toBe(chainVenue(id).feedIds['USDC-USD']!);
    expect(chainVenue(id).feedIds['USDC-USDC']).toBeUndefined();
  });
});
