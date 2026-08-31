import { describe, expect, test } from 'bun:test';
// bun test: dual-route LP ranking + EIP-5792 LP batch builders (spec §2).
import { STABLE_PROFILE, sigmaSeed } from '../amm/__fixtures__/profiles';
import { buildLeg } from '../amm/aimm.js';
import type { NamedPool } from '../amm/router.js';
import { type BuildOpts, buildDepositCalls, buildRedeemCalls } from './index';
import { rankDeposit, rankRedeem } from './lpRoutes';

const P = STABLE_PROFILE;
const SIG = sigmaSeed('stable');

/** Star pool: USDC hub + AUDF/NZDF spokes. NZDF can be made thin (under-covered). */
function pool(
  tag: string,
  o?: { audfRes?: number; nzdfRes?: number; nzdfLiab?: number },
): NamedPool {
  return {
    tag,
    state: {
      base: 'USDC',
      legs: {
        AUDF: buildLeg('AUDF', 1, SIG, o?.audfRes ?? 1_000_000, 1_000_000, 3_000_000, 6, P),
        NZDF: buildLeg(
          'NZDF',
          1,
          SIG,
          o?.nzdfRes ?? 1_000_000,
          o?.nzdfLiab ?? 1_000_000,
          3_000_000,
          6,
          P,
        ),
      },
      hub: { res: 3_000_000, liab: 2_000_000, kappaCovBps: 0 },
    },
  };
}
const healthyPool = () => pool('core');
// Target leg under-covered AND thin: the market buy saturates fast; the transfer still credits.
const thinTargetPool = () => pool('core', { nzdfRes: 60_000 });

describe('rankDeposit (routes A / B)', () => {
  test('both routes feasible: comparison picks the max target-LP out', () => {
    const pools = [healthyPool()];
    const { best, routes } = rankDeposit(pools, 'AUDF', 'NZDF', 5_000);
    expect(routes.length).toBe(2);
    expect(best?.feasible).toBe(true);
    // Shared conversion terms cancel: with no haircuts both credit the same face (± rounding of
    // the deposit floor); the direct tiebreak keeps market-first on top.
    const [a, b] = routes;
    expect(a.id).toBe('market-first');
    expect(Math.abs(a.out - b.out) / a.out).toBeLessThan(1e-6);
    expect(best?.id).toBe('market-first');
    expect(best?.steps.map((s) => s.kind)).toEqual(['swap', 'deposit']);
  });

  test('market route past its reserve clip drops out; transfer wins by being the max feasible', () => {
    const pools = [thinTargetPool()];
    const { best, routes } = rankDeposit(pools, 'AUDF', 'NZDF', 200_000);
    const a = routes.find((r) => r.id === 'market-first');
    const b = routes.find((r) => r.id === 'deposit-first');
    expect(a?.feasible).toBe(false);
    expect(b?.feasible).toBe(true);
    expect(best?.id).toBe('deposit-first');
    expect(best?.out).toBeGreaterThan(0);
    // Liability step carries a minLpAmountOut floor; the deposit step carries none.
    expect(best?.steps[0].kind).toBe('deposit');
    expect(best?.steps[0].minOut).toBe(0);
    expect(best?.steps[1].minOut).toBeLessThan(best?.steps[1].amountOut ?? 0);
  });

  test('season gating surfaces cooldown instead of quoting a reverting batch (§2.5)', () => {
    const pools = [healthyPool()];
    const gated = rankDeposit(pools, 'AUDF', 'NZDF', 5_000, { maxRedeem: () => 0 });
    const b = gated.routes.find((r) => r.id === 'deposit-first');
    expect(b?.feasible).toBe(false);
    expect(b?.reason).toBe('cooldown');
    expect(gated.best?.id).toBe('market-first'); // A unaffected: it never burns fresh LP
    // Seasoned position above the size: gate lifts.
    const ok = rankDeposit(pools, 'AUDF', 'NZDF', 5_000, { maxRedeem: () => 10_000 });
    expect(ok.routes.find((r) => r.id === 'deposit-first')?.feasible).toBe(true);
  });

  test('flag-disabled legs gate only the liability route', () => {
    const pools = [healthyPool()];
    const { best, routes } = rankDeposit(pools, 'AUDF', 'NZDF', 5_000, {
      liabilityEnabled: (s) => s !== 'NZDF',
    });
    expect(routes.find((r) => r.id === 'deposit-first')?.reason).toBe('flag-disabled');
    expect(best?.id).toBe('market-first');
  });
});

describe("rankRedeem (routes A' / B')", () => {
  test('equal economics resolve on the gas tiebreak: one-call cross-exit wins', () => {
    const pools = [healthyPool()];
    const { best, routes } = rankRedeem(pools, 'NZDF', 'AUDF', 5_000);
    expect(routes.length).toBe(2);
    const [a, b] = routes;
    expect(a.id).toBe('cross-exit');
    // Same mirror pipeline ⇒ same output; fewer legs takes it.
    if (Math.abs(a.out - b.out) / a.out < 1e-9) {
      expect(a.hops).toBeLessThan(b.hops);
      expect(best?.id).toBe('cross-exit');
    }
    expect(best?.feasible).toBe(true);
  });

  test('unseasoned target-LP gates BOTH redeem routes as cooldown; best goes null', () => {
    const pools = [healthyPool()];
    const { best, routes } = rankRedeem(pools, 'NZDF', 'AUDF', 5_000, { maxRedeem: () => 4_999 });
    for (const r of routes) {
      expect(r.feasible).toBe(false);
      expect(r.reason).toBe('cooldown');
    }
    expect(best).toBeNull();
  });

  test("flag-disabled destination gates only B'", () => {
    const pools = [healthyPool()];
    const { best, routes } = rankRedeem(pools, 'NZDF', 'AUDF', 5_000, {
      liabilityEnabled: (s) => s !== 'AUDF',
    });
    expect(routes.find((r) => r.id === 'transfer-exit')?.reason).toBe('flag-disabled');
    expect(best?.id).toBe('cross-exit');
  });

  test('under-covered source leg: haircuts price both routes, floors stay below quotes', () => {
    const pools = [pool('core', { audfRes: 500_000 })]; // AUDF 50% covered
    const { best, routes } = rankRedeem(pools, 'NZDF', 'AUDF', 5_000);
    expect(best?.out).toBeGreaterThan(0);
    for (const r of routes) {
      for (const s of r.steps) {
        if (s.kind !== 'deposit') expect(s.minOut).toBeLessThanOrEqual(s.amountOut);
      }
    }
  });
});

// ── calldata builders ───────────────────────────────────────────────────────────

const POOL = ('0x' + '11'.repeat(20)) as `0x${string}`;
const TOK_X = ('0x' + '22'.repeat(20)) as `0x${string}`;
const TOK_T = ('0x' + '33'.repeat(20)) as `0x${string}`;
const USER = ('0x' + '44'.repeat(20)) as `0x${string}`;

const opts: BuildOpts = { recipient: USER };

describe('buildDepositCalls', () => {
  test('Route A: [approvals?, swaps…, deposit]', () => {
    const calls = buildDepositCalls(
      POOL,
      {
        mode: 'market',
        legs: [
          {
            pool: POOL,
            tokenIn: TOK_X,
            tokenOut: TOK_T,
            amountIn: 1000n,
            quotedOut: 990n,
            minOut: 990n,
          },
        ],
        depositToken: TOK_T,
        depositAmount: 990n,
      },
      opts,
    );
    // Default opts approve every non-native leg: [approve(X), swap, deposit].
    expect(calls.length).toBe(3);
    expect(calls[0].to.toLowerCase()).toBe(TOK_X);
    expect(calls[1].to.toLowerCase()).toBe(POOL);
    expect(calls[2].to.toLowerCase()).toBe(POOL);
    expect(calls.every((c) => c.data.startsWith('0x'))).toBe(true);
  });

  test('Route B: exactly ONE approve, then deposit, then swapLiability', () => {
    const calls = buildDepositCalls(
      POOL,
      {
        mode: 'transfer',
        token: TOK_X,
        amount: 1000n,
        targetToken: TOK_T,
        lpAmountIn: 999n,
        minLpAmountOut: 900n,
      },
      opts,
    );
    expect(calls.length).toBe(3);
    expect(calls[0].to.toLowerCase()).toBe(TOK_X); // approve(X → pool)
    expect(calls[1].to.toLowerCase()).toBe(POOL); // deposit
    expect(calls[2].to.toLowerCase()).toBe(POOL); // swapLiability
    expect(calls.every((c) => c.value === 0n)).toBe(true);
  });

  test('cached allowance skips the approval (needsApproval)', () => {
    const calls = buildDepositCalls(
      POOL,
      {
        mode: 'transfer',
        token: TOK_X,
        amount: 1000n,
        targetToken: TOK_T,
        lpAmountIn: 999n,
        minLpAmountOut: 900n,
      },
      { ...opts, needsApproval: () => false },
    );
    expect(calls.length).toBe(2);
    expect(calls[0].to.toLowerCase()).toBe(POOL);
  });
});

describe('buildRedeemCalls', () => {
  test("Route A': single withdrawTo, no approvals", () => {
    const calls = buildRedeemCalls(
      POOL,
      { mode: 'cross', tokenFrom: TOK_T, tokenTo: TOK_X, lpAmount: 500n, minAmountOut: 480n },
      opts,
    );
    expect(calls.length).toBe(1);
    expect(calls[0].to.toLowerCase()).toBe(POOL);
    expect(calls[0].value).toBe(0n);
  });

  test("Route B': [swapLiability, withdraw], shared deadline, no approvals", () => {
    const deadline = 1234567890n; // one shared value per atomic batch (spec §4)
    const calls = buildRedeemCalls(
      POOL,
      {
        mode: 'transfer',
        tokenFrom: TOK_T,
        tokenTo: TOK_X,
        lpAmountIn: 500n,
        minLpAmountOut: 480n,
        lpWithdraw: 485n,
        minAmountOut: 470n,
      },
      { ...opts, deadline },
    );
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.to.toLowerCase() === POOL)).toBe(true);
    expect(calls.every((c) => c.value === 0n)).toBe(true);
  });
});

// ── same-asset direct paths ─────────────────────────────────────────────────────
// Spec §3: the deposit tab DEFAULTS to pay-leg receipt (X → X-LP); §2.1 B' tail names the
// same-asset exit. Neither is a dual-route problem: both short-circuit to one call.

/** Minimal pool with arbitrary legs, for edge fixtures below. */
function mkPool(tag: string, legs: Record<string, ReturnType<typeof buildLeg>>): NamedPool {
  return {
    tag,
    state: {
      base: 'USDC',
      legs,
      hub: { res: 3_000_000, liab: 2_000_000, kappaCovBps: 0 },
    },
  };
}

const leg = (sym: string, res = 1_000_000, liab = 1_000_000) =>
  buildLeg(sym, 1, SIG, res, liab, 3_000_000, 6, P);

describe('same-asset direct paths', () => {
  test('rankDeposit(X, X): single direct-deposit route, face 1:1, no price guard', () => {
    const { best, routes } = rankDeposit([healthyPool()], 'AUDF', 'AUDF', 5_000);
    expect(routes.length).toBe(1);
    expect(best?.label).toBe('direct deposit');
    expect(best?.feasible).toBe(true);
    expect(best?.out).toBe(5_000);
    expect(best?.steps.length).toBe(1);
    const step = best?.steps[0];
    expect(step?.kind).toBe('deposit');
    expect(step?.amountIn).toBe(5_000);
    expect(step?.amountOut).toBe(5_000); // mints at index, face 1:1
    expect(step?.minOut).toBe(0); // deposits carry NO price guard (spec §4)
  });

  test('rankDeposit(X, X) with no pool listing X: nothing routable', () => {
    const { best, routes } = rankDeposit(
      [mkPool('other', { JPYC: leg('JPYC') })],
      'AUDF',
      'AUDF',
      5_000,
    );
    expect(best).toBeNull();
    expect(routes.length).toBe(0);
  });

  test('rankRedeem(T, T): one-call withdraw, haircut only', () => {
    // Covered leg: full face out.
    const ok = rankRedeem([healthyPool()], 'AUDF', 'AUDF', 5_000);
    expect(ok.routes.length).toBe(1);
    expect(ok.best?.steps[0].kind).toBe('withdraw');
    expect(ok.best?.steps[0].amountOut).toBe(5_000);
    // Under-covered leg (50% covered): the deficit is the only cost, no spread/proto fee.
    const cut = rankRedeem([pool('core', { audfRes: 500_000 })], 'AUDF', 'AUDF', 5_000);
    expect(cut.best?.out).toBeGreaterThan(0);
    expect(cut.best?.out).toBeLessThan(5_000);
    expect(cut.best?.steps[0].minOut).toBeLessThanOrEqual(cut.best?.steps[0].amountOut ?? 0);
  });

  test('rankRedeem(T, T) still honors the season gate (it burns LP like every exit)', () => {
    const gated = rankRedeem([healthyPool()], 'AUDF', 'AUDF', 5_000, { maxRedeem: () => 4_999 });
    expect(gated.best).toBeNull();
    expect(gated.routes[0]?.reason).toBe('cooldown');
  });
});

describe('missing liability liquidity / single-pool scope edges', () => {
  test('in-leg liabilities exhausted: transfer route is no-route, market capacity-clamped, best null', () => {
    const pools = [mkPool('core', { AUDF: leg('AUDF', 1_000_000, 0), NZDF: leg('NZDF') })];
    const { best, routes } = rankDeposit(pools, 'AUDF', 'NZDF', 5_000);
    const b = routes.find((r) => r.id === 'deposit-first');
    expect(b?.feasible).toBe(false);
    expect(b?.reason).toBe('no-route'); // liabIn > L_in would revert on-chain
    const a = routes.find((r) => r.id === 'market-first');
    expect(a?.feasible).toBe(false);
    expect(a?.reason).toBe('capacity'); // selling into a leg with L=0 has no depth either
    expect(best).toBeNull();
  });

  test('no SINGLE pool holds both legs: redeem enumerates nothing (cross-pool out of scope v1)', () => {
    const pools = [mkPool('a', { AUDF: leg('AUDF') }), mkPool('b', { JPYC: leg('JPYC') })];
    const { best, routes } = rankRedeem(pools, 'AUDF', 'JPYC', 5_000);
    expect(best).toBeNull();
    expect(routes.length).toBe(0);
  });
});

describe('capacity clamp boundary', () => {
  test('maxRedeem exactly equal to the burned face passes the gate on both sides', () => {
    const cap = { maxRedeem: () => 5_000 };
    const dep = rankDeposit([healthyPool()], 'AUDF', 'NZDF', 5_000, cap);
    expect(dep.routes.find((r) => r.id === 'deposit-first')?.feasible).toBe(true);
    const red = rankRedeem([healthyPool()], 'NZDF', 'AUDF', 5_000, cap);
    for (const r of red.routes) expect(r.feasible).toBe(true);
  });
});

describe('audit regressions', () => {
  // The tail deposit spends what the SWAP delivered, and only the swap's `minOut` is guaranteed to
  // be there: an adverse-but-within-slippage fill leaves the user short of the quote, so a deposit
  // sized at the quote reverts `TransferFromFailed()` AFTER the swap has landed. `buildDepositCalls`
  // documents the contract - "pass Σ per-part minOut (the guaranteed floor); anything above it stays
  // with the user as target tokens" - and this is the producer side of it. The earlier assertion
  // here pinned the terminal QUOTE, which is the shortfall this test now forbids; the concern it
  // was written for (never SUM the hop floors - hop 1 is a different token entirely) still holds
  // and is pinned below.
  test('market-mint deposit is sized at the terminal FLOOR, never the quote or summed hops', () => {
    const pools = [
      mkPool('a', { AUDF: leg('AUDF') }),
      mkPool('b', { AUDF: leg('AUDF'), NZDF: leg('NZDF') }),
    ];
    const { best } = rankDeposit(pools, 'AUDF', 'NZDF', 10_000);
    expect(best?.steps.map((s) => s.kind)).toEqual(['swap', 'deposit']);
    const [finalHop, deposit] = best?.steps ?? [];
    // Exactly the final hop's floor: what the batch is guaranteed to be holding by then.
    expect(deposit?.amountIn).toBeCloseTo(finalHop?.minOut ?? 0, 8);
    // Never the quote - that is the amount the wallet may not have.
    expect(deposit?.amountIn).toBeLessThan(finalHop?.amountOut ?? 0);
    // Never a sum across hops either.
    const summed = (best?.steps ?? [])
      .filter((s) => s.kind === 'swap')
      .reduce((n, s) => n + s.amountOut, 0);
    expect(deposit?.amountIn).toBeLessThanOrEqual(summed);
  });

  test('a 2-hop market mint deposits only the FINAL leg floor, not hop 1 in another token', () => {
    // AUDF -> NZDF only exists via pool b; hop 1 bridges through AUDF in pool a. Summing every
    // step's output would add an AUDF amount to an NZDF deposit.
    const pools = [
      mkPool('a', { AUDF: leg('AUDF') }),
      mkPool('b', { AUDF: leg('AUDF'), NZDF: leg('NZDF') }),
    ];
    const { best } = rankDeposit(pools, 'AUDF', 'NZDF', 10_000);
    const swaps = (best?.steps ?? []).filter((s) => s.kind === 'swap');
    const deposit = (best?.steps ?? []).find((s) => s.kind === 'deposit');
    const terminal = swaps.filter((s) => s.tokenOut === 'NZDF');
    expect(terminal.length).toBeGreaterThan(0);
    // The deposit equals Σ of the NZDF-terminal floors and nothing else.
    expect(deposit?.amountIn).toBeCloseTo(
      terminal.reduce((n, s) => n + s.minOut, 0),
      8,
    );
    expect(deposit?.tokenIn).toBe('NZDF');
  });

  test('liability routes convert shares to face at accrued liquidity indexes', () => {
    const pools = [healthyPool()];
    const indexes = { AUDF: 1.2e18, NZDF: 1.5e18 };
    const indexed = rankRedeem(pools, 'AUDF', 'NZDF', 5_000, {
      liquidityIndexWad: (sym) => indexes[sym as keyof typeof indexes] ?? 1e18,
    });
    expect(indexed.best?.steps[0].kind).toBe('withdrawTo');
    expect(indexed.best?.steps[0].amountIn).toBeCloseTo(5_000, 6);
    expect(indexed.best?.out).toBeCloseTo(5_999.610_006_6, 6);
  });
});
