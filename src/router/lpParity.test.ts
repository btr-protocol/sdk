// Parity vs the dex-evm Pool recording: chain `withdrawTo` payouts and `poolSolvencyWad`, with the
// backend convert stubbed by btr-core's own recorded answer (not the sdk's port). Fixture is generated
// from the dex-evm recording; do not edit by hand.
import { afterEach, describe, expect, test } from 'bun:test';
import { buildLegV1 as buildLeg } from '../../test/legFixture.js';
import { STABLE_PROFILE, sigmaSeed } from '../amm/profiles';
import { poolSolvency } from '../pool/liability.js';
import vectors from './__fixtures__/lp_parity_vectors.json';
import { type LpRouteOpts, rankRedeem } from './lpRoutes.js';
import type { NamedPool } from './route.js';

interface Core {
  amountOut: string;
  grossOut: string;
  debitToll: string;
  cToll: string;
  markPrice: string;
}
interface Leg {
  symbol: string;
  base: boolean;
  decimals: number;
  reserves: string;
  liabilities: string;
  markWad?: string;
  covBits: number;
  minLiquidity: string;
  anchor: string | null;
}
interface Row {
  from: string;
  to: string;
  lp: string;
  index: string;
  chain: string | null;
  core: Core | null;
}
interface Phase {
  tag: string;
  cWad: string;
  exitTollWad: string;
  legs: Leg[];
  rows: Row[];
}

const SIG = sigmaSeed('stable');
const human = (raw: string, dec: number): number => Number(BigInt(raw)) / 10 ** dec;

/** `markWad` is relative to the leg's anchor; the sdk's `twap` is base per token (composed down the tree). */
function baseMark(legs: Leg[], sym: string): number {
  const l = legs.find((x) => x.symbol === sym);
  if (!l || l.base) return 1;
  return human(l.markWad ?? '0', 18) * (l.anchor ? baseMark(legs, l.anchor) : 1);
}

function build(ph: Phase): NamedPool {
  const base = ph.legs.find((l) => l.base);
  if (!base) throw new Error('no base leg');
  const legs: NamedPool['state']['legs'] = {};
  for (const l of ph.legs) {
    if (l.base) continue;
    const res = human(l.reserves, l.decimals);
    const leg = buildLeg(
      l.symbol,
      baseMark(ph.legs, l.symbol),
      SIG,
      res,
      human(l.liabilities, l.decimals),
      res,
      l.decimals,
      STABLE_PROFILE,
      0,
      { covBits: l.covBits },
    );
    legs[l.symbol] = {
      ...leg,
      minLiquidity: human(l.minLiquidity, l.decimals),
      liquidRes: res,
      ...(l.anchor ? { anchor: l.anchor } : {}),
    };
  }
  return {
    tag: ph.tag,
    addr: '0x1111111111111111111111111111111111111111',
    state: {
      base: base.symbol,
      legs,
      hub: {
        res: human(base.reserves, base.decimals),
        liab: human(base.liabilities, base.decimals),
        vegaBps: 0,
        kappaCovBps: 0,
        storageVersion: 7,
        covBits: base.covBits,
        kneeBits: 0,
        minLiquidity: human(base.minLiquidity, base.decimals),
        liquidRes: human(base.reserves, base.decimals),
      },
      // Every recorded phase settled cross exits at the live rate (cWad re-derives from the books).
      solvencyOk: true,
      solvencyCWad: BigInt(ph.cWad), // the chain's own rate, as the front carries it
      solvencyAtMs: Date.now(),
      exitTollWad: BigInt(ph.exitTollWad),
    },
  };
}

const originalFetch = globalThis.fetch;
let current: Core | null = null;
const stubFetch = () => {
  // @ts-expect-error stub fetch
  globalThis.fetch = async () => {
    if (!current) return { ok: false, status: 422, json: async () => ({ reason: 'refused' }) };
    const c = current;
    return {
      ok: true,
      json: async () => ({
        amount_out: c.amountOut,
        gross_out: c.grossOut,
        debit_toll: c.debitToll,
        c_toll: c.cToll,
        mark_price: c.markPrice,
        mid_price: c.markPrice,
        avg_price: c.markPrice,
        spread_pbps: 0,
        cov_toll: '0x0',
        proto_fee: '0x0',
        lp_fee: '0x0',
      }),
    };
  };
};
afterEach(() => {
  globalThis.fetch = originalFetch;
});

for (const ph of vectors as Phase[]) {
  describe(`lp parity ${ph.tag}`, () => {
    const pool = build(ph);
    const dec = (s: string): number => ph.legs.find((l) => l.symbol === s)?.decimals ?? Number.NaN;

    test('poolSolvency matches the chain cWad', () => {
      const c = poolSolvency(pool.state);
      const want = Number(BigInt(ph.cWad)) / 1e18;
      expect(c).not.toBeNull();
      expect(Math.abs((c as number) - want) / want).toBeLessThan(1e-9);
    });

    ph.rows.forEach((row, i) => {
      test(`row ${i} ${row.from}->${row.to} lp ${row.lp}`, async () => {
        stubFetch();
        current = row.core;
        const opts: LpRouteOpts = {
          slippageFrac: 0.005,
          liquidityIndexWad: (s) => (s === row.from ? Number(BigInt(row.index)) : 1e18),
          backend: {
            meta: { addressOf: () => null, decimalsOf: dec },
            baseDecimals: dec(pool.state.base),
            backendBase: 'https://q.example/v1',
          },
        };
        const r = (
          await rankRedeem([pool], row.from, row.to, human(row.lp, dec(row.from)), opts)
        ).routes.find((x) => x.id === 'cross-exit');
        if (row.chain === null) {
          expect(r?.feasible).toBe(false);
          return;
        }
        expect(r?.feasible).toBe(true);
        const want = Number(BigInt(row.chain));
        const got = (r?.out ?? 0) * 10 ** dec(row.to);
        // Raw units, the chain's integer law. The sdk rounds every step toward the pool (gross floored,
        // c_toll and debit ceiled: at most 4 raw under) and never pays above the chain. What remains is
        // the f64 `out` itself: an 18-decimal payout above 2^53 raw cannot be exact in a double, which
        // measures at most 3.2e-14 relative here, so the bound is 1e-13 (it was 2e-8).
        const noise = want * 1e-13;
        expect(got - want).toBeLessThanOrEqual(noise);
        expect(want - got).toBeLessThanOrEqual(noise + 4);
      });
    });
  });
}
