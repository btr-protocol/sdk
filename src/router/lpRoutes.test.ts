import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildLeg } from '../amm/aimm.js';
// bun test: dual-route LP ranking (backend-priced) + EIP-5792 LP batch builders (spec §2).
import { STABLE_PROFILE, sigmaSeed } from '../amm/profiles';
import { type BuildOpts, buildDepositCalls, buildRedeemCalls } from './index';
import { type LpRouteOpts, rankDeposit, rankRedeem } from './lpRoutes';
import type { NamedPool } from './route.js';

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
      hub: { res: 3_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0 },
    },
  };
}
const healthyPool = () => pool('core');

const BE: LpRouteOpts = {
  backend: {
    meta: { addressOf: () => null, decimalsOf: () => 6 },
    baseDecimals: 6,
    backendBase: 'https://q.example/v1',
  },
};

const WAD_HEX = `0x${(10n ** 18n).toString(16)}`;
const raw6 = (tok: number): string => `0x${BigInt(Math.round(tok * 1e6)).toString(16)}`;
const tok6 = (raw: string): number => Number(BigInt(raw)) / 1e6;

// Backend stub: /route serves the single-pool direct plan (identity pricing, capacity-capped);
// /quote answers legs 1:1. Local logic under test: gates, ranking, floors, haircut plumbing.
function installStub() {
  // @ts-expect-error stub fetch
  globalThis.fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? '{}');
    if (String(url).endsWith('/route')) {
      // Single-pool 'liab' wires are the liability converter's intra-pool cross, not the
      // market router: they carry no router capacity cap, so answer identity.
      const tags = ((body.pools ?? []) as { tag: string }[]).map((p) => p.tag);
      if (tags.length === 1 && tags[0] === 'liab') {
        const out = raw6(tok6(body.amount_in));
        const legs = [
          {
            pool_tag: 'liab',
            token_in: body.token_in,
            token_out: body.token_out,
            amount_in: body.amount_in,
            amount_out: out,
          },
        ];
        return {
          ok: true,
          json: async () => ({
            best_amount_out: out,
            best_is_split: false,
            best_parts: [{ legs, fraction: WAD_HEX, amount_out: out }],
            singles: [{ legs, amount_in: body.amount_in, amount_out: out }],
          }),
        };
      }
      const amt = tok6(body.amount_in);
      const holding = (
        body.pools as { tag: string; spokes: { token: string; liabilities: string }[] }[]
      ).find(
        (p) =>
          p.spokes.some((s) => s.token === body.token_in) &&
          p.spokes.some((s) => s.token === body.token_out),
      );
      const inSpoke = holding?.spokes.find((s) => s.token === body.token_in);
      const empty = !holding || inSpoke?.liabilities === '0x0' || !(amt > 0) || amt > 100_000;
      if (empty) {
        return {
          ok: true,
          json: async () => ({
            best_amount_out: '0x0',
            best_is_split: false,
            best_parts: [],
            singles: [],
          }),
        };
      }
      const out = raw6(amt);
      const legs = [
        {
          pool_tag: holding.tag,
          token_in: body.token_in,
          token_out: body.token_out,
          amount_in: body.amount_in,
          amount_out: out,
        },
      ];
      return {
        ok: true,
        json: async () => ({
          best_amount_out: out,
          best_is_split: false,
          best_parts: [{ legs, fraction: WAD_HEX, amount_out: out }],
          singles: [{ legs, amount_in: body.amount_in, amount_out: out }],
        }),
      };
    }
    const mid = `0x${(10n ** 18n).toString(16)}`;
    return {
      ok: true,
      json: async () => ({
        amount_out: body.amount_in,
        gross_out: body.amount_in,
        avg_price: mid,
        mid_price: mid,
        mark_price: mid,
        spread_pbps: 40,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: '0x0',
      }),
    };
  };
}

beforeEach(installStub);
afterEach(() => {
  // @ts-expect-error restore the real fetch
  globalThis.fetch = undefined;
});

describe('rankDeposit (routes A / B)', () => {
  test('both routes feasible: comparison picks the max target-LP out', async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, BE);
    expect(routes.length).toBe(2);
    expect(best?.feasible).toBe(true);
    const [a, b] = routes;
    expect(a.id).toBe('market-first');
    expect(Math.abs(a.out - b.out) / a.out).toBeLessThan(1e-6);
    expect(best?.id).toBe('market-first');
    expect(best?.steps.map((s) => s.kind)).toEqual(['swap', 'deposit']);
  });

  test('market route past capacity drops out; transfer wins by being the max feasible', async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 200_000, BE);
    const a = routes.find((r) => r.id === 'market-first');
    const b = routes.find((r) => r.id === 'deposit-first');
    expect(a?.feasible).toBe(false);
    expect(b?.feasible).toBe(true);
    expect(best?.id).toBe('deposit-first');
    expect(best?.out).toBeGreaterThan(0);
    expect(best?.steps[0].kind).toBe('deposit');
    expect(best?.steps[0].minOut).toBe(0);
    expect(best?.steps[1].minOut).toBeLessThan(best?.steps[1].amountOut ?? 0);
  });

  test('season gating surfaces cooldown instead of quoting a reverting batch (§2.5)', async () => {
    const pools = [healthyPool()];
    const gated = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, {
      ...BE,
      maxRedeem: () => 0,
    });
    const b = gated.routes.find((r) => r.id === 'deposit-first');
    expect(b?.feasible).toBe(false);
    expect(b?.reason).toBe('cooldown');
    expect(gated.best?.id).toBe('market-first');
    const ok = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, {
      ...BE,
      maxRedeem: () => 10_000,
    });
    expect(ok.routes.find((r) => r.id === 'deposit-first')?.feasible).toBe(true);
  });

  test('flag-disabled legs gate only the liability route', async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, {
      ...BE,
      liabilityEnabled: (s) => s !== 'NZDF',
    });
    expect(routes.find((r) => r.id === 'deposit-first')?.reason).toBe('flag-disabled');
    expect(best?.id).toBe('market-first');
  });
});

describe("rankRedeem (routes A' / B')", () => {
  test('equal economics resolve on the gas tiebreak: one-call cross-exit wins', async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankRedeem(pools, 'NZDF', 'AUDF', 5_000, BE);
    expect(routes.length).toBe(2);
    const [a, b] = routes;
    expect(a.id).toBe('cross-exit');
    if (Math.abs(a.out - b.out) / a.out < 1e-9) {
      expect(a.hops).toBeLessThan(b.hops);
      expect(best?.id).toBe('cross-exit');
    }
    expect(best?.feasible).toBe(true);
  });

  test('unseasoned target-LP gates BOTH redeem routes as cooldown; best goes null', async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankRedeem(pools, 'NZDF', 'AUDF', 5_000, {
      ...BE,
      maxRedeem: () => 4_999,
    });
    for (const r of routes) {
      expect(r.feasible).toBe(false);
      expect(r.reason).toBe('cooldown');
    }
    expect(best).toBeNull();
  });

  test("flag-disabled destination gates only B'", async () => {
    const pools = [healthyPool()];
    const { best, routes } = await rankRedeem(pools, 'NZDF', 'AUDF', 5_000, {
      ...BE,
      liabilityEnabled: (s) => s !== 'AUDF',
    });
    expect(routes.find((r) => r.id === 'transfer-exit')?.reason).toBe('flag-disabled');
    expect(best?.id).toBe('cross-exit');
  });

  test('under-covered source leg: haircuts price both routes, floors stay below quotes', async () => {
    const pools = [pool('core', { audfRes: 500_000 })]; // AUDF 50% covered
    const { best, routes } = await rankRedeem(pools, 'NZDF', 'AUDF', 5_000, BE);
    expect(best?.out).toBeGreaterThan(0);
    for (const r of routes) {
      for (const s of r.steps) {
        if (s.kind !== 'deposit') expect(s.minOut).toBeLessThanOrEqual(s.amountOut);
      }
    }
  });
});

// ── calldata builders ───────────────────────────────────────────────────────────

const POOL = `0x${'11'.repeat(20)}` as `0x${string}`;
const TOK_X = `0x${'22'.repeat(20)}` as `0x${string}`;
const TOK_T = `0x${'33'.repeat(20)}` as `0x${string}`;
const USER = `0x${'44'.repeat(20)}` as `0x${string}`;

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
    expect(calls[0].to.toLowerCase()).toBe(TOK_X);
    expect(calls[1].to.toLowerCase()).toBe(POOL);
    expect(calls[2].to.toLowerCase()).toBe(POOL);
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
    const deadline = 1234567890n;
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

/** Minimal pool with arbitrary legs, for edge fixtures below. */
function mkPool(tag: string, legs: Record<string, ReturnType<typeof buildLeg>>): NamedPool {
  return {
    tag,
    state: {
      base: 'USDC',
      legs,
      hub: { res: 3_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0 },
    },
  };
}

const leg = (sym: string, res = 1_000_000, liab = 1_000_000) =>
  buildLeg(sym, 1, SIG, res, liab, 3_000_000, 6, P);

describe('same-asset direct paths', () => {
  test('rankDeposit(X, X): single direct-deposit route, face 1:1, no price guard', async () => {
    const { best, routes } = await rankDeposit([healthyPool()], 'AUDF', 'AUDF', 5_000, BE);
    expect(routes.length).toBe(1);
    expect(best?.label).toBe('direct deposit');
    expect(best?.feasible).toBe(true);
    expect(best?.out).toBe(5_000);
    expect(best?.steps.length).toBe(1);
    const step = best?.steps[0];
    expect(step?.kind).toBe('deposit');
    expect(step?.amountIn).toBe(5_000);
    expect(step?.amountOut).toBe(5_000);
    expect(step?.minOut).toBe(0);
  });

  test('rankDeposit(X, X) with no pool listing X: nothing routable', async () => {
    const { best, routes } = await rankDeposit(
      [mkPool('other', { JPYC: leg('JPYC') })],
      'AUDF',
      'AUDF',
      5_000,
      BE,
    );
    expect(best).toBeNull();
    expect(routes.length).toBe(0);
  });

  test('rankRedeem(T, T): one-call withdraw, haircut only', async () => {
    const ok = await rankRedeem([healthyPool()], 'AUDF', 'AUDF', 5_000, BE);
    expect(ok.routes.length).toBe(1);
    expect(ok.best?.steps[0].kind).toBe('withdraw');
    expect(ok.best?.steps[0].amountOut).toBe(5_000);
    const cut = await rankRedeem([pool('core', { audfRes: 500_000 })], 'AUDF', 'AUDF', 5_000, BE);
    expect(cut.best?.out).toBeGreaterThan(0);
    expect(cut.best?.out).toBeLessThan(5_000);
    expect(cut.best?.steps[0].minOut).toBeLessThanOrEqual(cut.best?.steps[0].amountOut ?? 0);
  });

  test('rankRedeem(T, T) still honors the season gate (it burns LP like every exit)', async () => {
    const gated = await rankRedeem([healthyPool()], 'AUDF', 'AUDF', 5_000, {
      ...BE,
      maxRedeem: () => 4_999,
    });
    expect(gated.best).toBeNull();
    expect(gated.routes[0]?.reason).toBe('cooldown');
  });
});

describe('missing liability liquidity / single-pool scope edges', () => {
  test('in-leg liabilities exhausted: transfer route is no-route, market empty, best null', async () => {
    const pools = [mkPool('core', { AUDF: leg('AUDF', 1_000_000, 0), NZDF: leg('NZDF') })];
    const { best, routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, BE);
    const b = routes.find((r) => r.id === 'deposit-first');
    expect(b?.feasible).toBe(false);
    expect(b?.reason).toBe('no-route');
    const a = routes.find((r) => r.id === 'market-first');
    expect(a?.feasible).toBe(false);
    expect(a?.reason).toBe('capacity');
    expect(best).toBeNull();
  });

  test('no SINGLE pool holds both legs: redeem enumerates nothing (cross-pool out of scope v1)', async () => {
    const pools = [mkPool('a', { AUDF: leg('AUDF') }), mkPool('b', { JPYC: leg('JPYC') })];
    const { best, routes } = await rankRedeem(pools, 'AUDF', 'JPYC', 5_000, BE);
    expect(best).toBeNull();
    expect(routes.length).toBe(0);
  });
});

describe('capacity clamp boundary', () => {
  test('maxRedeem exactly equal to the burned face passes the gate on both sides', async () => {
    const cap: LpRouteOpts = { ...BE, maxRedeem: () => 5_000 };
    const dep = await rankDeposit([healthyPool()], 'AUDF', 'NZDF', 5_000, cap);
    expect(dep.routes.find((r) => r.id === 'deposit-first')?.feasible).toBe(true);
    const red = await rankRedeem([healthyPool()], 'NZDF', 'AUDF', 5_000, cap);
    for (const r of red.routes) expect(r.feasible).toBe(true);
  });
});

describe('audit regressions', () => {
  test('market-mint deposit is sized at the terminal FLOOR, never the quote or summed hops', async () => {
    const pools = [
      mkPool('a', { AUDF: leg('AUDF') }),
      mkPool('b', { AUDF: leg('AUDF'), NZDF: leg('NZDF') }),
    ];
    const { best } = await rankDeposit(pools, 'AUDF', 'NZDF', 10_000, BE);
    expect(best?.steps.map((s) => s.kind)).toEqual(['swap', 'deposit']);
    const [finalHop, deposit] = best?.steps ?? [];
    expect(deposit?.amountIn).toBeCloseTo(finalHop?.minOut ?? 0, 8);
    expect(deposit?.amountIn).toBeLessThan(finalHop?.amountOut ?? 0);
    const summed = (best?.steps ?? [])
      .filter((s) => s.kind === 'swap')
      .reduce((n, s) => n + s.amountOut, 0);
    expect(deposit?.amountIn).toBeLessThanOrEqual(summed);
  });

  test('a 2-hop market mint deposits only the FINAL leg floor, not hop 1 in another token', async () => {
    const pools = [
      mkPool('a', { AUDF: leg('AUDF') }),
      mkPool('b', { AUDF: leg('AUDF'), NZDF: leg('NZDF') }),
    ];
    const { best } = await rankDeposit(pools, 'AUDF', 'NZDF', 10_000, BE);
    const swaps = (best?.steps ?? []).filter((s) => s.kind === 'swap');
    const deposit = (best?.steps ?? []).find((s) => s.kind === 'deposit');
    const terminal = swaps.filter((s) => s.tokenOut === 'NZDF');
    expect(terminal.length).toBeGreaterThan(0);
    expect(deposit?.amountIn).toBeCloseTo(
      terminal.reduce((n, s) => n + s.minOut, 0),
      8,
    );
    expect(deposit?.tokenIn).toBe('NZDF');
  });

  test('liability routes convert shares to face at accrued liquidity indexes', async () => {
    const pools = [healthyPool()];
    const indexes = { AUDF: 1.2e18, NZDF: 1.5e18 };
    const indexed = await rankRedeem(pools, 'AUDF', 'NZDF', 5_000, {
      ...BE,
      liquidityIndexWad: (sym) => indexes[sym as keyof typeof indexes] ?? 1e18,
    });
    expect(indexed.best?.steps[0].kind).toBe('withdrawTo');
    expect(indexed.best?.steps[0].amountIn).toBeCloseTo(5_000, 6);
    // 5k shares @ idx 1.2 = 6k face in, identity backend quotes it straight through.
    expect(indexed.best?.out).toBeCloseTo(6_000, 6);
  });
});
