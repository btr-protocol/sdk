// bun test: LP exit quotes never promise more than the chain pays (review of feat/lp-exit-toll).
// Every case here fails open on 26aaa3f: a missing toll input must leave the route pending.
import { afterEach, describe, expect, test } from 'bun:test';
import { buildLegV1 as buildLeg } from '../amm/legFixture.js';
import { STABLE_PROFILE, sigmaSeed } from '../amm/profiles';
import { backendConvert, quoteSwapLiabilityCoreAsync } from '../pool/liabilityQuote';
import { toUnits } from '../utils/format';
import {
  type LpRouteOpts,
  type PostMoveTollCtx,
  TOLL_FUTURE_SLACK_MS,
  changeFace,
  rankRedeem,
} from './lpRoutes';
import { solvencyGate } from './lpRoutes.js';
import type { NamedPool } from './route.js';

const SIG = sigmaSeed('stable');
const WAD = 10n ** 18n;
const WAD_HEX = `0x${WAD.toString(16)}`;
const hex = (v: bigint) => `0x${v.toString(16)}`;

function pool(o?: { audfRes?: number; audfLiab?: number; nzdfMark?: number }): NamedPool {
  const leg = (sym: string, res: number, liab: number, mark = 1) =>
    buildLeg(sym, mark, SIG, res, liab, 3_000_000, 6, STABLE_PROFILE, 0);
  return {
    tag: 'core',
    addr: '0xcore',
    state: {
      base: 'USDC',
      solvencyOk: true,
      // Read now: fresh against the default clock and age bound (an unstamped word is stale).
      solvencyAtMs: Date.now(),
      exitTollWad: 0n,
      legs: {
        AUDF: leg('AUDF', o?.audfRes ?? 1_000_000, o?.audfLiab ?? 1_000_000),
        NZDF: leg('NZDF', 1_000_000, 1_000_000, o?.nzdfMark ?? 1),
      },
      hub: { res: 2_000_000, liab: 2_000_000, vegaBps: 0, kappaCovBps: 0, storageVersion: 1 },
    },
  };
}

const BE: LpRouteOpts = {
  slippageFrac: 0.005,
  backend: {
    meta: { addressOf: () => null, decimalsOf: () => 6 },
    baseDecimals: 6,
    backendBase: 'https://q.example/v1',
  },
};

/** Identity claim quote. `tolls` picks which claim-toll words the back sends (0 each). */
function stub(
  o: {
    tolls?: ('debit_toll' | 'credit_toll' | 'c_toll')[];
    out?: (inRaw: bigint) => bigint;
    lpFee?: (outRaw: bigint) => bigint;
  } = {},
) {
  const sent: Record<string, unknown>[] = [];
  // @ts-expect-error stub fetch
  globalThis.fetch = async (_u: string, init: { body?: string }) => {
    const b = JSON.parse(init.body ?? '{}');
    sent.push(b);
    const inRaw = BigInt(b.legs ? b.legs[0].amount_in : b.amount_in);
    const out = o.out ? o.out(inRaw) : inRaw;
    const extra = Object.fromEntries((o.tolls ?? []).map((k) => [k, '0x0']));
    return {
      ok: true,
      json: async () => ({
        amount_out: hex(out),
        gross_out: hex(out),
        avg_price: WAD_HEX,
        mid_price: WAD_HEX,
        mark_price: WAD_HEX,
        spread_pbps: 0,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: hex(o.lpFee ? o.lpFee(out) : 0n),
        ...extra,
      }),
    };
  };
  return sent;
}
const ALL: ('debit_toll' | 'credit_toll')[] = ['debit_toll', 'credit_toll'];

afterEach(() => {
  // @ts-expect-error restore the real fetch
  globalThis.fetch = undefined;
});

const route = async (p: NamedPool, from: string, to: string, lp: number, opts = BE) =>
  (await rankRedeem([p], from, to, lp, opts)).routes;

describe('F1: a claim toll the back omits is unknown, never 0', () => {
  test('cross-exit without debit_toll is pending, not the gross', async () => {
    stub({ tolls: ['credit_toll'] });
    const r = (await route(pool(), 'NZDF', 'AUDF', 100_000)).find((x) => x.id === 'cross-exit');
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('toll-pending');
    expect(r?.out).toBe(0);
    stub({ tolls: ALL });
    const ok = (await route(pool(), 'NZDF', 'AUDF', 100_000)).find((x) => x.id === 'cross-exit');
    expect(ok?.feasible).toBe(true);
  });

  test('a liability credit without credit_toll or debit_toll fails closed', async () => {
    const leg = { symbol: 'NZDF', reserves: 100, liabilities: 100, indexWad: 1e18, covBits: 45 };
    const inLeg = { symbol: 'AUDF', reserves: 1e6, liabilities: 1e6, indexWad: 1e18 };
    const q = (extra: Record<string, number>) => async () => ({
      amountOut: 10,
      grossOut: 10,
      avgPrice: 1,
      midPrice: 1,
      markPrice: 1,
      midPremiumBps: 0,
      netPremiumBps: 0,
      priceImpactBps: 0,
      spreadBps: 0,
      lpFeeBps: 0,
      protoFeeBps: 0,
      covTollBps: 0,
      saturated: false,
      route: ['AUDF', 'NZDF'],
      ...extra,
    });
    // Present and walled: refused. Absent: the old `?? 0` admitted this same credit.
    expect(
      await quoteSwapLiabilityCoreAsync(inLeg, leg, 20, 1, q({ debitToll: 0, creditToll: 10 })),
    ).toBeNull();
    await expect(
      quoteSwapLiabilityCoreAsync(inLeg, leg, 20, 1, q({ debitToll: 0 })),
    ).rejects.toThrow();
    await expect(
      quoteSwapLiabilityCoreAsync(inLeg, leg, 20, 1, q({ creditToll: 0 })),
    ).rejects.toThrow();
  });

  test('an exit conversion never sends toll_wad 0 for an unloaded toll', async () => {
    const sent = stub({ tolls: ALL });
    const p = pool();
    p.state.exitTollWad = null;
    const conv = backendConvert(
      p.state,
      'NZDF',
      'AUDF',
      { ...BE.backend!, poolAddress: '0xcore' },
      'exit',
    );
    await expect(conv(1_000, 1)).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

describe('F2: transfer-exit prices its exit leg off the post-move toll', () => {
  test('no post-move toll source: pending, never the entry word', async () => {
    stub({ tolls: ALL });
    const r = (await route(pool(), 'NZDF', 'AUDF', 100_000)).find((x) => x.id === 'transfer-exit');
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('toll-pending');
  });

  test('the post-move toll nets the exit, over the post-move books', async () => {
    stub({ tolls: ALL });
    const seen: PostMoveTollCtx[] = [];
    const at = async (tw: bigint | null) =>
      (
        await route(pool(), 'NZDF', 'AUDF', 100_000, {
          ...BE,
          postMoveExitTollWad: async (ctx) => {
            seen.push(ctx);
            return tw;
          },
        })
      ).find((x) => x.id === 'transfer-exit');
    // Entry word 0 (balanced pool); the exit after the move pays 1%.
    const zero = await at(0n);
    const one = await at(10n ** 16n);
    expect(one?.feasible).toBe(true);
    expect(one?.out).toBeLessThanOrEqual((zero?.out ?? 0) * 0.99);
    expect(seen[1].postState.legs.NZDF.liab).toBeCloseTo(900_000, 5);
    expect(seen[1].postState.legs.AUDF.liab).toBeCloseTo(1_100_000, 5);
    expect(seen[1].lpAmountOut).toBeCloseTo(100_000, 5);
    const unread = await at(null);
    expect(unread?.reason).toBe('toll-pending');
  });
});

describe('F3: same-asset toll is the settlement (lower-pass) toll', () => {
  const dark = () => {
    const p = pool({ nzdfMark: Number.NaN });
    // `poolSolvencyWad` on a dark leg: (lower bound, ok = false, toll 0).
    p.state.solvencyOk = false;
    p.state.exitTollWad = 0n;
    return p;
  };

  test('degraded pool: the 0 toll word is not used without a preview', async () => {
    const [r] = await route(dark(), 'AUDF', 'AUDF', 10_000);
    expect(r.feasible).toBe(false);
    expect(r.reason).toBe('feed-unavailable');
  });

  test('ok word not loaded: pending even with a toll word', async () => {
    const p = pool();
    p.state.solvencyOk = undefined;
    const [r] = await route(p, 'AUDF', 'AUDF', 10_000);
    expect(r.reason).toBe('toll-pending');
  });

  // Exits are never blocked: a dark leg cannot be priced off the state's toll word, so the chain's own
  // preview (the lower-pass toll it will charge) prices a same-asset exit.
  test('degraded pool with previewWithdraw: the same-asset exit is priced by the preview', async () => {
    const calls: [string, number][] = [];
    const [r] = await route(dark(), 'AUDF', 'AUDF', 10_000, {
      ...BE,
      // 10k gross less a 2% lower-pass toll.
      previewWithdraw: async (_p, sym, lp) => {
        calls.push([sym, lp]);
        return 9_800_000_000n;
      },
    });
    expect(calls).toEqual([['AUDF', 10_000]]);
    expect(r.feasible).toBe(true);
    expect(r.out).toBe(9_800);
    expect(r.minOut).toBeCloseTo(9_800 * (1 - BE.slippageFrac), 6);
  });

  test('degraded pool with an unread preview: unpriced, never a zero or a model price', async () => {
    const [r] = await route(dark(), 'AUDF', 'AUDF', 10_000, {
      ...BE,
      previewWithdraw: async () => null,
    });
    expect(r.feasible).toBe(false);
    expect(r.reason).toBe('feed-unavailable');
    expect(r.out).toBe(0);
  });

  test('a degraded pool still refuses a claim larger than the leg owes', async () => {
    const [r] = await route(dark(), 'AUDF', 'AUDF', 2_000_000, {
      ...BE,
      previewWithdraw: async () => 9_800_000_000n,
    });
    expect(r.reason).toBe('insufficient-liability');
  });

  test('a live pool takes the lower of the state toll and the preview', async () => {
    const p = pool();
    p.state.exitTollWad = 10n ** 16n; // 1%
    const opts = (raw: bigint | null): LpRouteOpts => ({ ...BE, previewWithdraw: async () => raw });
    expect((await route(p, 'AUDF', 'AUDF', 10_000, opts(9_800_000_000n)))[0].out).toBe(9_800);
    expect((await route(p, 'AUDF', 'AUDF', 10_000, opts(null)))[0].out).toBeLessThanOrEqual(9_900);
  });

  test('cross-exit on a degraded pool refuses (creditRate lower bound is not the state C)', async () => {
    stub({ tolls: ALL });
    const p = pool();
    p.state.solvencyOk = false;
    const r = (await route(p, 'NZDF', 'AUDF', 10_000)).find((x) => x.id === 'cross-exit');
    expect(r?.reason).toBe('feed-unavailable');
  });
});

/** Deterministic xorshift for the rounding sweep. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}
const cTollRef = (amt: bigint, tw: bigint) => {
  const f = (amt * tw + WAD - 1n) / WAD;
  return f > amt ? amt : f;
};

describe('F4: raw-unit payout never above the chain integer law', () => {
  test('same-asset: toUnits(out) <= amt - _cToll(amt) over a share/index sweep', async () => {
    // Short leg (R/L < 1) under a short pool: mu = min(c_leg, C), both non-dyadic.
    const R = 999_999_999_937n;
    const L = 1_000_000_000_000n;
    const p = pool({ audfRes: Number(R) / 1e6, audfLiab: Number(L) / 1e6 });
    const tw = 3_141_592_653_589_793n;
    p.state.exitTollWad = tw;
    // Chain C over raw books (all decimals 6 = base's, marks WAD).
    const nav = 2_000_000_000_000n + R + 1_000_000_000_000n;
    const claim = 2_000_000_000_000n + L + 1_000_000_000_000n;
    const cap = (nav * WAD) / claim;
    const cLeg = (R * WAD) / L;
    const mu = cLeg < cap ? cLeg : cap;
    const rand = rng(7);
    let worst = 0n;
    for (let i = 0; i < 400; i++) {
      const lpRaw = BigInt(Math.floor(rand() * 5e10)) + 1n;
      const idx = 1_000_000_000_000_000_000n + BigInt(Math.floor(rand() * 3e17));
      const wv = (lpRaw * idx) / WAD;
      const amt = (wv * mu) / WAD;
      const chain = amt - cTollRef(amt, tw);
      const r = (
        await route(p, 'AUDF', 'AUDF', Number(lpRaw) / 1e6, {
          ...BE,
          liquidityIndexWad: () => Number(idx),
        })
      )[0];
      const got = r.feasible ? toUnits(r.out, 6) : 0n;
      if (got - chain > worst) worst = got - chain;
    }
    expect(worst).toBe(0n);
  });

  test('cross: toUnits(out) <= amount_out - c_toll - debit_toll over raw wire words', async () => {
    // 18-decimal legs: the payout carries more digits than f64 holds, so float subtraction of the
    // wire words can land above the chain's integer difference.
    const p18 = pool();
    for (const s of ['AUDF', 'NZDF']) p18.state.legs[s] = { ...p18.state.legs[s], decimals: 18 };
    const be18: LpRouteOpts = {
      ...BE,
      backend: {
        ...BE.backend!,
        meta: { addressOf: () => null, decimalsOf: () => 18 },
        baseDecimals: 18,
      },
    };
    const rand = rng(11);
    const big = () =>
      BigInt(Math.floor(rand() * 2 ** 52)) * 1_000n + BigInt(Math.floor(rand() * 1e3));
    let worst = 0n;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const cut = big() / 1_000n;
      const cT = big();
      const dT = big();
      let chain = 0n;
      // @ts-expect-error stub fetch
      globalThis.fetch = async (_u: string, init: { body?: string }) => {
        const b = JSON.parse(init.body ?? '{}');
        const out = BigInt(b.amount_in) - cut;
        chain = out - cT - dT;
        return {
          ok: true,
          json: async () => ({
            amount_out: hex(out),
            gross_out: hex(out),
            avg_price: WAD_HEX,
            mid_price: WAD_HEX,
            mark_price: WAD_HEX,
            spread_pbps: 0,
            cov_toll: '0x0',
            proto_fee: '0x0',
            lp_fee: '0x0',
            c_toll: hex(cT),
            debit_toll: hex(dT),
          }),
        };
      };
      const lp = 1_000 + rand() * 90_000;
      const r = (await route(p18, 'NZDF', 'AUDF', lp, be18)).find((x) => x.id === 'cross-exit');
      if (!r?.feasible) continue;
      n++;
      const got = toUnits(r.out, 18);
      if (got - chain > worst) worst = got - chain;
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBe(0n);
  });
});

/** One in-kind leg whose coverage dwarfs 1 (`mu ≫ 1`): R = 1e9 raw, L = 1000 raw, 6 decimals. */
function richPool(o: { res: number; liab: number }): NamedPool {
  return {
    tag: 'core',
    addr: '0xcore',
    state: {
      base: 'USDC',
      solvencyOk: true,
      solvencyAtMs: Date.now(),
      exitTollWad: 0n,
      legs: { AUDF: buildLeg('AUDF', 1, SIG, o.res, o.liab, 3_000_000, 6, STABLE_PROFILE, 0) },
      hub: { res: 0, liab: 0, vegaBps: 0, kappaCovBps: 0, storageVersion: 1 },
    },
  };
}
/** `_quoteWithdrawSame` over raw words (`PoolLiquidityLib.sol:434,118-126,497-498`, `_cToll`). */
const chainSame = (lp: bigint, idx: bigint, R: bigint, L: bigint, cap: bigint, tw: bigint) => {
  const face = (lp * idx) / WAD;
  const cLeg = (R * WAD) / L;
  const amt = (face * (cLeg < cap ? cLeg : cap)) / WAD;
  return amt - cTollRef(amt, tw);
};

describe('F5: integer face and mu (mu ≫ 1): same-asset and transfer never above the chain', () => {
  test('review reproducer: R=1e9, L=1000 raw, lp=999 raw, idx 1.0009009', async () => {
    const p = richPool({ res: 1_000, liab: 0.001 });
    const idx = 1_000_900_900_000_000_000n;
    const r = (
      await route(p, 'AUDF', 'AUDF', 999 / 1e6, { ...BE, liquidityIndexWad: () => Number(idx) })
    )[0];
    // Chain: face floor(999.9009) = 999, mu = min(1e6, C = 1e6) → 999_000_000 raw.
    const chain = chainSame(999n, idx, 1_000_000_000n, 1_000n, 10n ** 24n, 0n);
    expect(chain).toBe(999_000_000n);
    expect(r.feasible).toBe(true);
    expect(toUnits(r.out, 6)).toBeLessThanOrEqual(chain);
    // Tight: within one face unit's mu of the chain (the f64 books shade toward the pool).
    expect(toUnits(r.out, 6)).toBeGreaterThanOrEqual(chain - 1_000_000n);
  });

  test('same-asset sweep, mu in [1, 1000), random index and toll', async () => {
    const rand = rng(23);
    let worst = -(10n ** 30n);
    for (let i = 0; i < 300; i++) {
      const L = BigInt(Math.floor(rand() * 1e9)) + 1_000n;
      const R = (L * BigInt(Math.floor(rand() * 1e6) + 1_000)) / 1_000n;
      const p = richPool({ res: Number(R) / 1e6, liab: Number(L) / 1e6 });
      const tw = BigInt(Math.floor(rand() * 5e16));
      p.state.exitTollWad = tw;
      const idx = WAD + BigInt(Math.floor(rand() * 9e17));
      const lp = (((L * WAD) / idx) * BigInt(Math.floor(rand() * 1e6))) / 1_000_000n + 1n;
      const r = (
        await route(p, 'AUDF', 'AUDF', Number(lp) / 1e6, {
          ...BE,
          liquidityIndexWad: () => Number(idx),
        })
      )[0];
      // C over one leg = R/L as well: the cap never binds below c_leg here.
      const chain = chainSame(lp, idx, R, L, (R * WAD) / L, tw);
      const got = r.feasible ? toUnits(r.out, 6) : 0n;
      if (got - chain > worst) worst = got - chain;
    }
    expect(worst).toBeLessThanOrEqual(0n);
  });

  test('transfer-exit: the tail pays the chain law on the shares it burns', async () => {
    // Every book rich (C ≈ c_leg ≈ 1000): mu ≫ 1 on the tail withdraw. Identity claim conversion.
    stub({ tolls: ALL });
    const p = pool({ audfRes: 1_000_000, audfLiab: 1_000 });
    p.state.legs.NZDF = { ...p.state.legs.NZDF, liab: 1_000 };
    p.state.hub = { res: 2_000_000, liab: 2_000, vegaBps: 0, kappaCovBps: 0, storageVersion: 1 };
    const idx = 1_000_900_900_000_000_000n;
    const tw = 7n * 10n ** 15n;
    let post: PostMoveTollCtx | undefined;
    const r = (
      await route(p, 'NZDF', 'AUDF', 0.999, {
        ...BE,
        liquidityIndexWad: () => Number(idx),
        postMoveExitTollWad: async (ctx) => {
          post = ctx;
          return tw;
        },
      })
    ).find((x) => x.id === 'transfer-exit');
    expect(r?.feasible).toBe(true);
    const lpBurn = toUnits(r?.steps[1].amountIn ?? 0, 6);
    expect(lpBurn).toBeGreaterThan(0n);
    // Chain law on the post-move books over the burned shares: mu = min(c_leg, C), raw books.
    const ps = post!.postState;
    const a = ps.legs.AUDF;
    const raw = (v: number) => BigInt(Math.round(v * 1e6));
    const books = [ps.hub!, ...Object.values(ps.legs)].map((l) => {
      const b = l as { res: number; liab: number };
      return [raw(b.res), raw(b.liab)] as const;
    });
    const nav = books.reduce((t, [r]) => t + r, 0n);
    const claim = books.reduce((t, [, l]) => t + l, 0n);
    const capW = (nav * WAD) / claim;
    expect(capW).toBeGreaterThan(500n * WAD);
    const chain = chainSame(lpBurn, idx, raw(a.res), raw(a.liab), capW, tw);
    expect(chain).toBeGreaterThan(0n);
    expect(toUnits(r?.out ?? 0, 6)).toBeLessThanOrEqual(chain);
  });
});

describe('F5b: cross-exit claim face floors like the chain', () => {
  test('face 1_000_000.9 raw goes out as <= 1_000_000, payout <= the floored claim', async () => {
    const sent = stub({ tolls: ALL });
    const p = pool();
    // lp = 1_000_000 raw, idx 1.0000009: chain withdrawValue = floor(1_000_000.9) = 1_000_000.
    const r = (
      await route(p, 'NZDF', 'AUDF', 1, {
        ...BE,
        liquidityIndexWad: () => 1_000_000_900_000_000_000,
      })
    ).find((x) => x.id === 'cross-exit');
    expect(r?.feasible).toBe(true);
    const b = sent.at(-1) as { amount_in: string; claim: { face: string; c_wad: string } };
    expect(BigInt(b.claim.face)).toBeLessThanOrEqual(1_000_000n);
    const fair = (1_000_000n * BigInt(b.claim.c_wad)) / WAD;
    expect(BigInt(b.amount_in)).toBeLessThanOrEqual(fair);
    expect(toUnits(r?.out ?? 0, 6)).toBeLessThanOrEqual(fair);
  });
});

describe('stale solvency words: refused, not priced', () => {
  const at = (ageMs: number) => {
    const p = pool();
    p.state.exitTollWad = 10n ** 15n;
    p.state.solvencyAtMs = 1_000_000;
    return { p, opts: { ...BE, now: () => 1_000_000 + ageMs } as LpRouteOpts };
  };
  test('same-asset and cross: fresh priced, older than the bound toll-stale', async () => {
    stub({ tolls: ALL });
    const fresh = at(5_000);
    expect((await route(fresh.p, 'AUDF', 'AUDF', 1_000, fresh.opts))[0].feasible).toBe(true);
    const old = at(31_000);
    expect((await route(old.p, 'AUDF', 'AUDF', 1_000, old.opts))[0].reason).toBe('toll-stale');
    const cross = (await route(old.p, 'NZDF', 'AUDF', 1_000, old.opts)).find(
      (x) => x.id === 'cross-exit',
    );
    expect(cross?.reason).toBe('toll-stale');
    // The same-asset exit is never closed by stale words: the chain's preview prices it (no model),
    // and with no preview read it is unpriced under the gate's own reason. Cross stays refused.
    const pv = await route(old.p, 'AUDF', 'AUDF', 1_000, {
      ...old.opts,
      previewWithdraw: async () => 990_000_000n,
    });
    expect(pv[0].feasible).toBe(true);
    expect(pv[0].out).toBe(990);
  });
});

describe('same-asset previews obey the shared solvency gate', () => {
  test.each(['toll', 'solvency'] as const)(
    '%s pending: no model, the preview alone prices the exit',
    async (word) => {
      const p = pool();
      if (word === 'toll') p.state.exitTollWad = null;
      else p.state.solvencyOk = null;
      let calls = 0;
      const plan = await rankRedeem([p], 'AUDF', 'AUDF', 1_000, {
        ...BE,
        previewWithdraw: async () => {
          calls++;
          return 990_000_000n;
        },
      });
      expect(plan.routes[0].feasible).toBe(true);
      expect(plan.best?.out).toBe(990);
      expect(calls).toBe(1);
      // ...and with the preview unread there is no price, under the gate's own reason.
      const unread = await rankRedeem([p], 'AUDF', 'AUDF', 1_000, { ...BE });
      expect(unread.best).toBeNull();
      expect(unread.routes[0].reason).toBe('toll-pending');
    },
  );

  test('fresh at the caller age bound retains the lower preview quote', async () => {
    const p = pool();
    p.state.exitTollWad = 10n ** 16n;
    p.state.solvencyAtMs = 1_000;
    const opts = {
      ...BE,
      now: () => 1_100,
      maxTollAgeMs: 100,
      previewWithdraw: async () => 980_000_000n,
    };
    const fresh = await rankRedeem([p], 'AUDF', 'AUDF', 1_000, opts);
    expect(fresh.best?.out).toBe(980);
    expect(fresh.best?.minOut).toBe(980 * (1 - BE.slippageFrac));
    const stale = await rankRedeem([p], 'AUDF', 'AUDF', 1_000, {
      ...opts,
      now: () => 1_101,
    });
    // Stale words close nothing: the preview prices the exit, the model is not consulted.
    expect(stale.best?.out).toBe(980);
    const noPreview = await rankRedeem([p], 'AUDF', 'AUDF', 1_000, {
      ...opts,
      now: () => 1_101,
      previewWithdraw: undefined,
    });
    expect(noPreview.best).toBeNull();
    expect(noPreview.routes[0].reason).toBe('toll-stale');
    expect(noPreview.routes[0].out).toBe(0);
  });
});

describe('transfer-exit obeys the shared solvency gate', () => {
  // A post-move toll source is wired, so only the solvency words can hold the route back.
  const T: LpRouteOpts = { ...BE, postMoveExitTollWad: async () => 0n };
  const pick = async (p: NamedPool, id: string, opts: LpRouteOpts = T) =>
    (await route(p, 'NZDF', 'AUDF', 10_000, opts)).find((x) => x.id === id);

  test('fresh and live: transfer and cross priced', async () => {
    stub({ tolls: ALL });
    expect((await pick(pool(), 'transfer-exit'))?.feasible).toBe(true);
    expect((await pick(pool(), 'cross-exit'))?.feasible).toBe(true);
  });

  test.each([undefined, null])(
    'ok word %p (not loaded): transfer pending with a post-move toll, cross pending',
    async (ok) => {
      stub({ tolls: ALL });
      const p = pool();
      p.state.solvencyOk = ok;
      for (const id of ['transfer-exit', 'cross-exit']) {
        const r = await pick(p, id);
        expect(r?.feasible).toBe(false);
        expect(r?.reason).toBe('toll-pending');
        expect(r?.out).toBe(0);
      }
    },
  );

  test('degraded (ok = false, marks priced): transfer refuses', async () => {
    stub({ tolls: ALL });
    const p = pool();
    p.state.solvencyOk = false;
    const r = await pick(p, 'transfer-exit');
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('feed-unavailable');
    expect(r?.out).toBe(0);
  });

  test('stale words: transfer refuses with a post-move toll', async () => {
    stub({ tolls: ALL });
    const p = pool();
    p.state.solvencyAtMs = 1_000_000;
    const r = await pick(p, 'transfer-exit', { ...T, now: () => 1_031_000 });
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('toll-stale');
    expect(r?.out).toBe(0);
  });
});

describe('solvency freshness fails closed', () => {
  test.each([
    ['unstamped', undefined],
    ['null stamp', null],
  ] as const)(
    '%s: cross and transfer are toll-stale; same-asset is priced by the preview',
    async (_name, at) => {
      stub({ tolls: ALL });
      const p = pool();
      p.state.solvencyAtMs = at;
      const opts: LpRouteOpts = {
        ...BE,
        now: () => 1_000_000,
        postMoveExitTollWad: async () => 0n,
        previewWithdraw: async () => 990_000_000n,
      };
      // Same-asset: priced by the preview (the exit stays open); with none read, toll-stale.
      expect((await route(p, 'AUDF', 'AUDF', 1_000, opts))[0].feasible).toBe(true);
      expect(
        (await route(p, 'AUDF', 'AUDF', 1_000, { ...opts, previewWithdraw: undefined }))[0].reason,
      ).toBe('toll-stale');
      const rs = await route(p, 'NZDF', 'AUDF', 1_000, opts);
      for (const id of ['cross-exit', 'transfer-exit']) {
        const r = rs.find((x) => x.id === id);
        expect(r?.feasible).toBe(false);
        expect(r?.reason).toBe('toll-stale');
      }
      // Stamped exactly now (age 0) is fresh.
      p.state.solvencyAtMs = 1_000_000;
      expect((await route(p, 'AUDF', 'AUDF', 1_000, opts))[0].feasible).toBe(true);
    },
  );
});

describe('same-asset preview can only lower the model quote', () => {
  test('a preview above the state model never raises the payout', async () => {
    const p = pool();
    p.state.exitTollWad = 10n ** 16n; // 1%: the model pays <= 9,900 of 10k
    const model = (await route(p, 'AUDF', 'AUDF', 10_000))[0];
    expect(model.feasible).toBe(true);
    expect(model.out).toBeLessThanOrEqual(9_900);
    // A lagging replica preview at the full 10k gross (no toll).
    const [r] = await route(p, 'AUDF', 'AUDF', 10_000, {
      ...BE,
      previewWithdraw: async () => 10_000_000_000n,
    });
    expect(r.feasible).toBe(true);
    expect(r.out).toBe(model.out);
    expect(r.out).toBeLessThan(10_000);
  });
});

describe('the stamp is chain time, compared with chain time', () => {
  const T = 1_700_000_000_000;
  const at = (stamp: number, now: number, max?: number) => {
    const p = pool();
    p.state.exitTollWad = 10n ** 15n;
    p.state.solvencyAtMs = stamp;
    return {
      p,
      opts: { ...BE, now: () => now, ...(max ? { maxTollAgeMs: max } : {}) } as LpRouteOpts,
    };
  };
  const reason = async (x: ReturnType<typeof at>) =>
    (await route(x.p, 'AUDF', 'AUDF', 1_000, x.opts))[0];

  test('a device 100 s behind the chain: a stamp read now ranks when now is the chain clock', async () => {
    // Device clock T - 100 s; chain time T. The stamp is the header time, ahead of the device.
    const devicePrices = await reason(at(T, T - 100_000));
    expect(devicePrices.reason).toBe('toll-clock');
    const chainPrices = await reason(at(T, T + 2_000));
    expect(chainPrices.feasible).toBe(true);
  });

  test('61 s old in chain time against a 60 s bound is toll-stale; 60 s is fresh', async () => {
    expect((await reason(at(T, T + 61_000, 60_000))).reason).toBe('toll-stale');
    expect((await reason(at(T, T + 60_000, 60_000))).feasible).toBe(true);
  });

  test('a stamp up to the future slack ahead reads as age 0; beyond it is refused as toll-clock', async () => {
    expect((await reason(at(T + TOLL_FUTURE_SLACK_MS, T))).feasible).toBe(true);
    const far = await reason(at(T + TOLL_FUTURE_SLACK_MS + 1, T));
    expect(far.feasible).toBe(false);
    expect(far.reason).toBe('toll-clock');
    expect(far.out).toBe(0);
  });

  test('a non-finite clock fails closed', async () => {
    expect((await reason(at(T, Number.NaN))).reason).toBe('toll-stale');
  });
});

describe('transfer-exit: the tail is sized at the post-fee index the second call reads', () => {
  test('swapLiability books its LP fee into the out leg index before the mint; the tail face follows it', async () => {
    // lp fee 1% of the converted amount; rich books as in the F5 case. Identity claim conversion.
    stub({ tolls: ALL, lpFee: (out) => out / 100n });
    const p = pool({ audfRes: 1_000_000, audfLiab: 1_000 });
    p.state.legs.NZDF = { ...p.state.legs.NZDF, liab: 1_000 };
    p.state.hub = { res: 2_000_000, liab: 2_000, vegaBps: 0, kappaCovBps: 0, storageVersion: 1 };
    const idx = 1_000_900_900_000_000_000n;
    const tw = 7n * 10n ** 15n;
    let post: PostMoveTollCtx | undefined;
    const opts: LpRouteOpts = {
      ...BE,
      liquidityIndexWad: () => Number(idx),
      postMoveExitTollWad: async (ctx) => {
        post = ctx;
        return tw;
      },
    };
    const r = (await route(p, 'NZDF', 'AUDF', 0.999, opts)).find((x) => x.id === 'transfer-exit');
    expect(r?.feasible).toBe(true);
    const lpBurn = toUnits(r?.steps[1].amountIn ?? 0, 6);
    const ps = post!.postState;
    const raw = (v: number) => BigInt(Math.round(v * 1e6));
    const books = [ps.hub!, ...Object.values(ps.legs)].map((l) => {
      const b = l as { res: number; liab: number };
      return [raw(b.res), raw(b.liab)] as const;
    });
    const capW =
      (books.reduce((t, [x]) => t + x, 0n) * WAD) / books.reduce((t, [, l]) => t + l, 0n);
    const a = ps.legs.AUDF;
    const fee = (0.999 * 0.9999) / 100; // ~1% of the converted amount, in face (C = 1)
    const idxPost = BigInt(Math.floor(Number(idx) * (1 + fee / 1_000)));
    const pre = chainSame(lpBurn, idx, raw(a.res), raw(a.liab), capW, tw);
    const postIdx = chainSame(lpBurn, idxPost, raw(a.res), raw(a.liab), capW, tw);
    expect(postIdx).toBeGreaterThan(pre);
    const got = toUnits(r?.out ?? 0, 6);
    // Never above the chain at the index the call reads, and priced on that index, not the pre-mint one.
    expect(got).toBeLessThanOrEqual(postIdx);
    expect(got).toBeGreaterThan(pre);
  });
});

describe('changeFace: a missing book is refused, never conjured from undefined', () => {
  test('hub, leg and a leg with no entry', () => {
    const p = pool();
    expect(changeFace(p.state, 'USDC', 5)).toBe(true);
    expect(p.state.hub!.liab).toBe(2_000_005);
    expect(changeFace(p.state, 'AUDF', -5)).toBe(true);
    expect(p.state.legs.AUDF.liab).toBe(999_995);
    const before = Object.keys(p.state.legs).join();
    expect(changeFace(p.state, 'GHOST', 1)).toBe(false);
    expect(Object.keys(p.state.legs).join()).toBe(before);
    expect(Object.keys(p.state.legs)).not.toContain('GHOST');
  });
});

describe('solvencyGate: the one gate the ranker and the send both run', () => {
  const T = 1_000_000;
  const o = { ...BE, now: () => T } as LpRouteOpts;
  const at = (over: Partial<NamedPool['state']>) => {
    const p = pool();
    p.state.exitTollWad = 10n ** 15n;
    p.state.solvencyAtMs = T;
    Object.assign(p.state, over);
    return solvencyGate(p.state, o);
  };
  test('fresh and live: open', () => expect(at({})).toBeNull());
  test('a fresh stamp does not make a degraded pool pass', () =>
    expect(at({ solvencyOk: false })).toBe('feed-unavailable'));
  test('unread words, an old stamp and a far-future stamp each name their reason', () => {
    expect(at({ solvencyOk: null })).toBe('toll-pending');
    expect(at({ solvencyAtMs: T - 60_000 })).toBe('toll-stale');
    expect(at({ solvencyAtMs: T + 60_000 })).toBe('toll-clock');
  });
});

describe('the same-asset exit is priced by the preview it is given', () => {
  test('stale words, then a different preview: the figure follows the preview passed in', async () => {
    const p = pool();
    p.state.solvencyAtMs = 1_000; // far older than the bound against `now`
    const at = (raw: bigint) =>
      rankRedeem([p], 'AUDF', 'AUDF', 1_000, {
        ...BE,
        now: () => 10_000_000,
        previewWithdraw: async () => raw,
      });
    expect(solvencyGate(p.state, { ...BE, now: () => 10_000_000 })).toBe('toll-stale');
    const a = await at(990_000_000n);
    expect(a.best?.out).toBe(990);
    expect((await at(900_000_000n)).best?.out).toBe(900);
    // A lagging replica's preview is the chain's own answer for the block it read: the route is
    // priced by it, and the send floor (minOut) follows it.
    expect(a.best?.minOut).toBe(990 * (1 - BE.slippageFrac));
  });
});

describe('an absent coverage word is not a zero the wall check can use', () => {
  const unversioned = (): NamedPool => {
    const p = pool();
    // A leg of an unknown generation (no storageVersion) carrying no covBits.
    p.state.legs.AUDF = { ...p.state.legs.AUDF, storageVersion: undefined, covBits: undefined };
    return p;
  };
  test('cross-exit into it is refused, never walled by a 0', async () => {
    stub({ tolls: ALL });
    const r = (await route(unversioned(), 'NZDF', 'AUDF', 10_000)).find(
      (x) => x.id === 'cross-exit',
    );
    expect(r?.feasible).toBe(false);
    expect(r?.reason).toBe('backend-error'); // the wire refuses it (CovWordMissing) before any wall check
  });
  test('known v1: the same leg prices as before', async () => {
    stub({ tolls: ALL });
    const p = unversioned();
    p.state.legs.AUDF = { ...p.state.legs.AUDF, storageVersion: 1 };
    const r = (await route(p, 'NZDF', 'AUDF', 10_000)).find((x) => x.id === 'cross-exit');
    expect(r?.feasible).toBe(true);
  });
});
