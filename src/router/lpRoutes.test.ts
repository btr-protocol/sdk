import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildLeg } from '../amm/aimm.js';
import { STABLE_PROFILE, sigmaSeed } from '../amm/profiles';
// bun test: dual-route LP ranking (backend-priced) + EIP-5792 LP batch builders (spec §2).
import { covDebitToll } from '../pool/covLaw';
import { type BuildOpts, buildDepositCalls, buildRedeemCalls } from './index';
import { type LpRouteOpts, rankDeposit, rankRedeem } from './lpRoutes';
import type { NamedPool } from './route.js';

const P = STABLE_PROFILE;
const SIG = sigmaSeed('stable');

/** Star pool: USDC hub + AUDF/NZDF spokes. NZDF can be made thin (under-covered). */
function pool(
  tag: string,
  o?: { audfRes?: number; nzdfRes?: number; nzdfLiab?: number; hubRes?: number; audfMark?: number },
): NamedPool {
  return {
    tag,
    addr: `0x${tag}`,
    state: {
      base: 'USDC',
      solvencyOk: true,
      solvencyAtMs: Date.now(),
      exitTollWad: 0n,
      legs: {
        AUDF: buildLeg(
          'AUDF',
          o?.audfMark ?? 1,
          SIG,
          o?.audfRes ?? 1_000_000,
          1_000_000,
          3_000_000,
          6,
          P,
          0,
        ),
        NZDF: buildLeg(
          'NZDF',
          1,
          SIG,
          o?.nzdfRes ?? 1_000_000,
          o?.nzdfLiab ?? 1_000_000,
          3_000_000,
          6,
          P,
          0,
        ),
      },
      hub: { res: o?.hubRes ?? 2_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0 },
    },
  };
}
/** C = 1: every route's economics compare on the conversion alone. */
const healthyPool = () => pool('core');

const BE: LpRouteOpts = {
  slippageFrac: 0.005,
  backend: {
    meta: { addressOf: () => null, decimalsOf: () => 6 },
    baseDecimals: 6,
    backendBase: 'https://q.example/v1',
  },
};

const WAD_HEX = `0x${(10n ** 18n).toString(16)}`;
const raw6 = (tok: number): string => `0x${BigInt(Math.round(tok * 1e6)).toString(16)}`;
const tok6 = (raw: string): number => Number(BigInt(raw)) / 1e6;

// Backend stub: /route serves the market router's direct plan (identity pricing, capacity-capped);
// /quote and /quote-path answer 1:1. Local logic under test: gates, ranking, floors, haircut plumbing.
function installStub() {
  // @ts-expect-error stub fetch
  globalThis.fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(init.body ?? '{}');
    if (String(url).endsWith('/route')) {
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
    // A path body carries its input on the first hop; a leg body carries it at the top.
    const amountIn = body.legs ? body.legs[0].amount_in : body.amount_in;
    const mid = `0x${(10n ** 18n).toString(16)}`;
    return {
      ok: true,
      json: async () => ({
        amount_out: amountIn,
        gross_out: amountIn,
        avg_price: mid,
        mid_price: mid,
        mark_price: mid,
        spread_pbps: 40,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: '0x0',
        debit_toll: '0x0',
        credit_toll: '0x0',
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
  test('a cross-asset deposit is deposit-then-liability only: no unfloored swap-then-deposit arm', async () => {
    const { routes } = await rankDeposit([healthyPool()], 'AUDF', 'NZDF', 5_000, BE);
    expect(routes.map((r) => r.id)).toEqual(['deposit-first']);
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
    expect(gated.best).toBeNull();
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
    expect(best).toBeNull();
  });

  test('an address-less holder carries no liability route (served mode would read it HALTED)', async () => {
    const pools = [{ ...healthyPool(), addr: undefined }];
    const { routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, BE);
    expect(routes.map((r) => r.id)).not.toContain('deposit-first');
  });
});

describe('crossExit degenerate quotes', () => {
  const wad = (x: number) => `0x${BigInt(Math.round(x * 1e18)).toString(16)}`;
  const stubQuote = (o: { mid: number; mark: number; out?: string }) => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body?: string }) => {
      const b = JSON.parse(init.body ?? '{}');
      const amountIn = b.legs ? b.legs[0].amount_in : b.amount_in;
      const out = o.out ?? amountIn;
      return {
        ok: true,
        json: async () => ({
          amount_out: out,
          gross_out: out,
          avg_price: wad(o.mid),
          mid_price: wad(o.mid),
          mark_price: wad(o.mark),
          spread_pbps: 0,
          cov_toll: '0x0',
          proto_fee: '0x0',
          lp_fee: '0x0',
          debit_toll: '0x0',
          credit_toll: '0x0',
        }),
      };
    };
  };
  const cross = async () =>
    (await rankRedeem([healthyPool()], 'NZDF', 'AUDF', 5_000, BE)).routes.find(
      (r) => r.id === 'cross-exit',
    );

  test('mark cap collapsing the output to 0 is no-route, never a feasible zero', async () => {
    stubQuote({ mid: 1, mark: 0 });
    const r = await cross();
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('no-route');
  });

  test('an off-scale quote (null from backendConvert) is no-route, not backend-error', async () => {
    stubQuote({ mid: 1000, mark: 1000 }); // fill/mid = 1e-3
    const r = await cross();
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('no-route');
  });
});

describe('crossExit walls mirror the chain with a C toll', () => {
  // c_min 90% (code 45). A 10% toll stays in reserves: 100k out of a 1M/1M leg debits 90k
  // (R/L = 0.91, clear of c_min); 120k debits 108k (R/L = 0.892, past it).
  const at = async (amount: number) => {
    const p = healthyPool();
    p.state.legs.AUDF = { ...p.state.legs.AUDF, covBits: 45 };
    p.state.exitTollWad = 10n ** 17n; // 10%, no `c_toll` on the stub wire: derived from state
    return (await rankRedeem([p], 'NZDF', 'AUDF', amount, BE)).routes.find(
      (r) => r.id === 'cross-exit',
    );
  };
  test('above c_min passes and pays out net of toll; past it is walled', async () => {
    const ok = await at(100_000);
    expect(ok?.feasible).toBe(true);
    // Raw-unit floors toward the pool: never above 90k, a few raw units under it.
    expect(ok?.out).toBeLessThanOrEqual(90_000);
    expect(90_000 - (ok?.out ?? 0)).toBeLessThanOrEqual(5e-6);
    const bad = await at(120_000);
    expect(bad?.feasible).toBe(false);
    expect(bad?.reason).toBe('coverage-wall');
  });
});

describe('crossExit exit toll word: unknown vs zero', () => {
  const cross = async (w: bigint | null | undefined) => {
    const p = healthyPool();
    p.state.exitTollWad = w;
    const r = await rankRedeem([p], 'NZDF', 'AUDF', 100_000, BE);
    return r.routes.find((x) => x.id === 'cross-exit');
  };
  test.each([undefined, null])('exitTollWad %p is pending: no number, not quoted', async (w) => {
    const r = await cross(w);
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('toll-pending');
    expect(r?.out).toBe(0);
  });
  test('a real 0n toll pays the gross, never NaN', async () => {
    const r = await cross(0n);
    expect(r?.feasible).toBe(true);
    expect(Number.isFinite(r?.out)).toBe(true);
    expect(r?.out).toBeGreaterThan(0);
  });
  test('a toll above 100% is not fillable (chain caps at payout, exit reverts)', async () => {
    const r = await cross(2n * 10n ** 18n);
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('toll-exceeds-payout');
  });
});

describe('unknown exit toll: every LP exit route is pending', () => {
  test.each([undefined, null])(
    'exitTollWad %p: transfer-exit and same-asset pending, no best',
    async (w) => {
      const p = healthyPool();
      p.state.exitTollWad = w;
      const x = await rankRedeem([p], 'NZDF', 'AUDF', 100_000, BE);
      expect(x.best).toBeNull();
      expect(x.routes.every((r) => !r.feasible && r.reason === 'toll-pending')).toBe(true);
      expect(x.routes.map((r) => r.id).sort()).toEqual(['cross-exit', 'transfer-exit']);
      const s = await rankRedeem([p], 'NZDF', 'NZDF', 100_000, BE);
      expect(s.best).toBeNull();
      expect(s.routes[0].reason).toBe('toll-pending');
    },
  );
  test('a known toll is netted on the same-asset and transfer exits', async () => {
    const at = async (tw: bigint) => {
      const p = healthyPool();
      p.state.exitTollWad = tw;
      return {
        same: (await rankRedeem([p], 'NZDF', 'NZDF', 100_000, BE)).best,
        // The transfer's exit leg pays the POST-move toll, read through the resolver.
        transfer: (
          await rankRedeem([p], 'NZDF', 'AUDF', 100_000, {
            ...BE,
            postMoveExitTollWad: async () => tw,
          })
        ).routes.find((r) => r.id === 'transfer-exit'),
      };
    };
    const z = await at(0n);
    const t = await at(10n ** 17n);
    expect(z.transfer?.feasible).toBe(true);
    expect(t.transfer?.feasible).toBe(true);
    // Raw-unit law: within a few raw units of the 10% cut, never above it.
    expect(t.same?.out).toBeCloseTo((z.same?.out ?? 0) * 0.9, 5);
    expect(t.same?.out ?? 0).toBeLessThanOrEqual((z.same?.out ?? 0) * 0.9);
    expect(t.transfer?.out).toBeCloseTo((z.transfer?.out ?? 0) * 0.9, 5);
  });
});

describe('crossExit claim law: the from-leg debit', () => {
  // Hub-class terms on the from leg (NZDF): c_max 2.35, κ⁺ 14336. The stub is the backend's claim
  // contract on the uploaded books: `amount_out` = the quote (identity at C), `debit_toll` the
  // sdk's own bigint port of `CovLib.debitToll` (replayed bit-exact in cov.test.ts).
  const BITS = (5 | (14 << 6) | (1 << 12) | (26 << 15) | (16 << 20) | (51 << 26)) >>> 0;
  type Claim = { credit: boolean; face: string; c_wad: string };
  let seen: { claim?: Claim } | undefined;
  const install = () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_url: string, init: { body?: string }) => {
      const body = JSON.parse(init.body ?? '{}');
      if (!body.claim.credit) seen = body;
      const c = body.claim;
      const sp = (
        body.pool.spokes as { token: string; reserves: string; liabilities: string }[]
      ).find((x) => x.token === body.token_in);
      const face = BigInt(c.face);
      const fair = (face * BigInt(c.c_wad)) / 10n ** 18n;
      const debit = covDebitToll(
        BigInt(BITS),
        BigInt(sp?.reserves ?? '0x0'),
        BigInt(sp?.liabilities ?? '0x0'),
        face,
        fair,
        BigInt(c.c_wad),
      );
      const hex = (v: bigint) => `0x${v.toString(16)}`;
      return {
        ok: true,
        json: async () => ({
          amount_out: hex(fair),
          gross_out: hex(fair),
          avg_price: WAD_HEX,
          mid_price: WAD_HEX,
          mark_price: WAD_HEX,
          spread_pbps: 0,
          cov_toll: '0x0',
          proto_fee: '0x0',
          lp_fee: '0x0',
          debit_toll: hex(debit),
        }),
      };
    };
  };
  const exit = async (o: { res: number; liab: number; audfRes?: number }, face: number) => {
    install();
    seen = undefined;
    const p = pool('core', { nzdfRes: o.res, nzdfLiab: o.liab, audfRes: o.audfRes });
    p.state.legs.NZDF = { ...p.state.legs.NZDF, covBits: BITS };
    return (await rankRedeem([p], 'NZDF', 'AUDF', face, BE)).routes.find(
      (r) => r.id === 'cross-exit',
    );
  };
  const expectDebit = (res: number, liab: number, face: number, c: number): number => {
    const e6 = 10n ** 6n;
    const cw = BigInt(Math.round(c * 1e18));
    const f = BigInt(Math.round(face * 1e6));
    const fair = (f * cw) / 10n ** 18n;
    return (
      Number(covDebitToll(BigInt(BITS), BigInt(res) * e6, BigInt(liab) * e6, f, fair, cw)) / 1e6
    );
  };

  test('over-covered leg (c = 1.2, burning 10 % of L) pays the debit the swap law never quotes', async () => {
    const r = await exit({ res: 1_200_000, liab: 1_000_000 }, 100_000);
    expect(r?.feasible).toBe(true);
    expect(seen?.claim?.credit).toBe(false);
    // Floored toward the pool (`withdrawValue`, `fairValue`): never above the burned face.
    const sentFace = BigInt(seen?.claim?.face ?? '0x0');
    expect(sentFace).toBeLessThanOrEqual(100_000n * 10n ** 6n);
    expect(sentFace).toBeGreaterThanOrEqual(100_000n * 10n ** 6n - 3n);
    const c = 1.05; // pool rate: (2M + 1M + 1.2M) / (2M + 1M + 1M)
    const debit = expectDebit(1_200_000, 1_000_000, 100_000, c);
    expect(debit).toBeGreaterThan(10_000);
    expect(r?.out).toBeCloseTo(100_000 * c - debit, 4);
  });
  test('below C = 1 the debit scales up by 1/C', async () => {
    const r = await exit({ res: 1_200_000, liab: 1_000_000, audfRes: 100_000 }, 100_000);
    const c = (2_000_000 + 100_000 + 1_200_000) / 4_000_000; // 0.825
    const debit = expectDebit(1_200_000, 1_000_000, 100_000, c);
    expect(r?.out).toBeCloseTo(100_000 * c - debit, 4);
    const unscaled = (debit * c) / 1; // the pre-R7 formula charged t·out/face, (1−C) short
    expect(debit).toBeGreaterThan(unscaled);
  });
  test('at a wall the whole payout is the debit: refused, in-kind exit stays open', async () => {
    const r = await exit({ res: 2_400_000, liab: 1_000_000 }, 250_000);
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('coverage-wall');
  });
});

describe('slippageFrac validation', () => {
  for (const bad of [1, -0.1, Number.NaN]) {
    test(`rejects ${bad}`, async () => {
      const o = { ...BE, slippageFrac: bad };
      await expect(rankDeposit([healthyPool()], 'AUDF', 'NZDF', 100, o)).rejects.toThrow(
        'slippageFrac',
      );
      await expect(rankRedeem([healthyPool()], 'NZDF', 'AUDF', 100, o)).rejects.toThrow(
        'slippageFrac',
      );
    });
  }
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
        minLpOut: 990n,
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
        minLpOut: 990n,
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
      solvencyOk: true,
      solvencyAtMs: Date.now(),
      exitTollWad: 0n,
      legs,
      hub: { res: 2_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0 },
    },
  };
}

const leg = (sym: string, res = 1_000_000, liab = 1_000_000) =>
  buildLeg(sym, 1, SIG, res, liab, 3_000_000, 6, P, 0);

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
    expect(ok.best?.steps[0].amountOut).toBe(4_999.999998); // 5_000 floored toward the pool
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
  test('no SINGLE pool holds both legs: redeem enumerates nothing (cross-pool out of scope v1)', async () => {
    const pools = [mkPool('a', { AUDF: leg('AUDF') }), mkPool('b', { JPYC: leg('JPYC') })];
    const { best, routes } = await rankRedeem(pools, 'AUDF', 'JPYC', 5_000, BE);
    expect(best).toBeNull();
    expect(routes.length).toBe(0);
  });
});

describe('capacity clamp boundary', () => {
  test('maxRedeem exactly equal to the burned face passes the gate on both sides', async () => {
    const cap: LpRouteOpts = { ...BE, maxRedeem: () => 5_000, postMoveExitTollWad: async () => 0n };
    const dep = await rankDeposit([healthyPool()], 'AUDF', 'NZDF', 5_000, cap);
    expect(dep.routes.find((r) => r.id === 'deposit-first')?.feasible).toBe(true);
    const red = await rankRedeem([healthyPool()], 'NZDF', 'AUDF', 5_000, cap);
    for (const r of red.routes) expect(r.feasible).toBe(true);
  });
});

describe('market-mint sizing and liability-index conversion', () => {
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
    expect(indexed.best?.out).toBeCloseTo(6_000, 5);
  });
});

/** The chain settles LP entry and exit at POOL-LEVEL C (LED-A); the per-leg haircut these
 *  routes would price does not exist in the contracts. Hub 2M/2M + AUDF/NZDF at mark 1. */
describe('LP routes settle at pool C, not at a per-leg haircut', () => {
  test('same-asset exit pays min(c_leg, C): a covered leg in a short pool is capped at C', async () => {
    // hub 1.6M/2M, legs 1M/1M: C = 3.6M / 4M = 0.9. AUDF itself is fully covered.
    const r = await rankRedeem([pool('core', { hubRes: 1_600_000 })], 'AUDF', 'AUDF', 5_000, BE);
    expect(r.best?.out).toBeCloseTo(4_500, 5);
  });

  test('same-asset exit on a short leg in a whole pool is bounded by the leg, not taxed twice', async () => {
    // AUDF 0.5M/1M but hub 2.5M/2M: C = (2.5 + 0.5 + 1) / 4 = 1. In-kind delivery = c_leg = 0.5.
    const r = await rankRedeem(
      [pool('core', { audfRes: 500_000, hubRes: 2_500_000 })],
      'AUDF',
      'AUDF',
      5_000,
      BE,
    );
    expect(r.best?.out).toBeCloseTo(2_500, 5);
  });

  test('cross exit converts face · C and never haircuts the destination leg', async () => {
    // C = 0.9 (short hub); NZDF destination is itself under-covered: no second cut.
    const pools = [pool('core', { hubRes: 1_600_000, nzdfRes: 500_000 })];
    // C = (1.6 + 1 + 0.5) / 4 = 0.775
    const r = await rankRedeem(pools, 'AUDF', 'NZDF', 5_000, BE);
    const cross = r.routes.find((x) => x.id === 'cross-exit');
    expect(cross?.out).toBeCloseTo(5_000 * 0.775, 5);
  });

  test('a mark the pool cannot price leaves no rate: mints and cross exits refuse, same-asset stays open', async () => {
    const dark = [pool('core', { audfMark: 0 })];
    const cross = await rankRedeem(dark, 'NZDF', 'AUDF', 5_000, BE);
    expect(cross.routes.every((x) => !x.feasible)).toBe(true);
    expect(cross.routes.find((x) => x.id === 'cross-exit')?.reason).toBe('feed-unavailable');
    const dep = await rankDeposit(dark, 'NZDF', 'NZDF', 5_000, BE);
    expect(dep.best).toBeNull();
    expect(dep.routes[0]?.reason).toBe('feed-unavailable');
    // Degraded same-asset: min(c_leg, C_lower), C_lower = min(C_usable, dark c_k = 0.6).
    const short = [pool('core', { audfMark: 0, audfRes: 600_000 })];
    const same = await rankRedeem(short, 'NZDF', 'NZDF', 5_000, BE);
    expect(same.best?.out).toBeCloseTo(3_000, 5);
  });

  test('a deposit mints face amt / C', async () => {
    // hub 2.4M/2M: C = 4.4 / 4 = 1.1, so 5,500 buys 5,000 face.
    const dep = await rankDeposit([pool('core', { hubRes: 2_400_000 })], 'AUDF', 'AUDF', 5_500, BE);
    expect(dep.best?.out).toBeCloseTo(5_000, 6);
  });
});

describe('crossExit exit toll + keeper floor', () => {
  let seen: { claim?: { toll_wad?: string } } | undefined;
  // identity quote carrying a backend `c_toll` of 5% of the output
  const install = () => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async (_u: string, init: { body?: string }) => {
      const b = JSON.parse(init.body ?? '{}');
      if (b.claim && !b.claim.credit) seen = b;
      const out = BigInt(b.amount_in);
      return {
        ok: true,
        json: async () => ({
          amount_out: `0x${out.toString(16)}`,
          gross_out: `0x${out.toString(16)}`,
          avg_price: WAD_HEX,
          mid_price: WAD_HEX,
          mark_price: WAD_HEX,
          spread_pbps: 0,
          cov_toll: '0x0',
          proto_fee: '0x0',
          lp_fee: '0x0',
          debit_toll: '0x0',
          credit_toll: '0x0',
          c_toll: `0x${(out / 20n).toString(16)}`,
        }),
      };
    };
  };
  const run = async (mutate?: (p: NamedPool) => void) => {
    install();
    const p = healthyPool();
    p.state.exitTollWad = 5n * 10n ** 16n;
    mutate?.(p);
    return (await rankRedeem([p], 'NZDF', 'AUDF', 100_000, BE)).routes.find(
      (r) => r.id === 'cross-exit',
    );
  };
  test('sends toll_wad and pays amount_out - c_toll', async () => {
    const r = await run();
    expect(seen?.claim?.toll_wad).toBe(`0x${(5n * 10n ** 16n).toString(16)}`);
    expect(r?.feasible).toBe(true);
    expect(r?.out).toBeCloseTo(95_000, 5);
    expect(r?.out).toBeLessThanOrEqual(95_000);
  });
  test('out leg below out + minLiquidity is unfeasible', async () => {
    const mk = (min: number) => (p: NamedPool) => {
      p.state.legs.AUDF = { ...p.state.legs.AUDF, minLiquidity: min };
    };
    expect((await run(mk(905_000)))?.feasible).toBe(true);
    const bad = await run(mk(905_001));
    expect(bad?.feasible).toBe(false);
    expect(bad?.reason).toBe('min-liquidity');
  });
});

describe('same-asset settlement boundaries', () => {
  test('burn uses the liquidity index before the toll', async () => {
    const p = healthyPool();
    p.state.exitTollWad = 10n ** 17n;
    const result = await rankRedeem([p], 'AUDF', 'AUDF', 100, {
      ...BE,
      liquidityIndexWad: () => 2e18,
    });
    expect(result.best?.out).toBeCloseTo(180, 5);
    expect(result.best?.out).toBeLessThanOrEqual(180);
  });
  test('sub-wei toll rounds up and zero payout refuses', async () => {
    const p = healthyPool();
    p.state.exitTollWad = 1n;
    expect((await rankRedeem([p], 'AUDF', 'AUDF', 0.000001, BE)).best).toBeNull();
    // Chain: 4 − ceil(4·1/WAD) = 3 units. The quote floors the float gross by two units first
    // (`floorRaw`), then takes the same ceil'd toll: 1 unit, never above the chain.
    expect((await rankRedeem([p], 'AUDF', 'AUDF', 0.000004, BE)).best?.out).toBe(0.000001);
  });
  test('same-asset keeper floor and over-burn refuse', async () => {
    const p = healthyPool();
    p.state.legs.AUDF.minLiquidity = 999_901;
    expect((await rankRedeem([p], 'AUDF', 'AUDF', 100, BE)).routes[0]?.reason).toBe(
      'min-liquidity',
    );
    expect((await rankRedeem([p], 'AUDF', 'AUDF', 1_000_001, BE)).routes[0]?.reason).toBe(
      'insufficient-liability',
    );
  });
});
