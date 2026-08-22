import { describe, expect, test } from 'bun:test';
// bun test — dual-route LP ranking + EIP-5792 LP batch builders (spec §2).
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
        legs: [{ pool: POOL, tokenIn: TOK_X, tokenOut: TOK_T, amountIn: 1000n, minOut: 990n }],
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
