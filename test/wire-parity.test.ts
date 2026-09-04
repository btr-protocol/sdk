import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
// Offline wire parity: the deleted quote-parity net compared TS math to chain math over RPC.
// No TS pricer remains, so parity is wire-level: hex codec round-trips, guards fail closed,
// and malformed/outage wires never masquerade as no-liquidity.
import { routeAsync } from '../src/amm/aimm.js';
import { backendConvert } from '../src/pool/liability.js';
import { hexToF64, rankDeposit, toRawHex, wirePlanToSwap } from '../src/router/lpRoutes.js';

describe('wire codec', () => {
  test('hexToF64/toRawHex round-trip token units', () => {
    expect(hexToF64(toRawHex(5_000, 6), 6)).toBeCloseTo(5_000, 6);
    expect(hexToF64(toRawHex(1, 18), 18)).toBeCloseTo(1, 9);
    expect(hexToF64('0x0', 6)).toBe(0);
  });
  test('WAD fraction parses without tripping the 2^53 guard', () => {
    expect(hexToF64(`0x${(10n ** 18n).toString(16)}`, 18)).toBeCloseTo(1, 9);
  });
  test('values past 2^53 integer tokens throw instead of rounding', () => {
    expect(() => hexToF64(`0x${(2n ** 60n).toString(16)}`, 0)).toThrow();
    expect(() => toRawHex(2 ** 60, 0)).toThrow();
    expect(() => toRawHex(Number.NaN, 6)).toThrow();
    expect(() => hexToF64('0xzz', 6)).toThrow();
  });
});

describe('wirePlanToSwap', () => {
  const decOf = () => 6;
  test('maps a single-leg route wire to plan + singles', () => {
    const amt = toRawHex(1_000, 6);
    const out = toRawHex(990, 6);
    const res = {
      best_amount_out: out,
      best_is_split: false,
      best_parts: [
        {
          legs: [
            {
              pool_tag: 'core',
              token_in: 'AUDF',
              token_out: 'NZDF',
              amount_in: amt,
              amount_out: out,
            },
          ],
          fraction: `0x${(10n ** 18n).toString(16)}`,
          amount_out: out,
        },
      ],
      singles: [
        {
          legs: [
            {
              pool_tag: 'core',
              token_in: 'AUDF',
              token_out: 'NZDF',
              amount_in: amt,
              amount_out: out,
            },
          ],
          amount_in: amt,
          amount_out: out,
        },
      ],
    };
    const { plan, singles } = wirePlanToSwap(
      [],
      { tokenIn: 'AUDF', tokenOut: 'NZDF', amountIn: 1_000 },
      res,
      decOf,
    );
    expect(plan.amountOut).toBeCloseTo(990, 6);
    expect(plan.parts.length).toBe(1);
    expect(plan.parts[0].fraction).toBeCloseTo(1, 9);
    expect(singles.length).toBe(1);
  });
  test('malformed wire throws with context instead of a BigInt TypeError', () => {
    const bad = { best_amount_out: '0xzz', best_is_split: false, best_parts: [], singles: [] };
    expect(() =>
      wirePlanToSwap([], { tokenIn: 'A', tokenOut: 'B', amountIn: 1 }, bad, decOf),
    ).toThrow(/wirePlanToSwap/);
  });
});

describe('backend aliases + guards', () => {
  test('routeAsync is the live POST /v1/route entry (rankSwapAsync alias deleted)', () => {
    expect(typeof routeAsync).toBe('function');
  });
  test('backendConvert throws on an unknown leg instead of a silent zero-Quote', async () => {
    const state = { base: 'USDC', legs: {} };
    const convert = backendConvert(state, 'AUDF', 'NZDF', {
      meta: { addressOf: () => null, decimalsOf: () => 6 },
      baseDecimals: 6,
      backendBase: 'https://q.example/v1',
    });
    await expect(convert(100)).rejects.toThrow(/unknown leg/);
  });
});

describe('outage vs no-liquidity', () => {
  beforeEach(() => {
    // @ts-expect-error stub fetch
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  });
  afterEach(() => {
    // @ts-expect-error restore the real fetch
    globalThis.fetch = undefined;
  });
  test('a 500 from /route surfaces backend-error, never a silent null', async () => {
    const { STABLE_PROFILE, sigmaSeed } = await import('../src/amm/profiles.js');
    const { buildLeg } = await import('../src/amm/aimm.js');
    const pools = [
      {
        tag: 'core',
        state: {
          base: 'USDC',
          legs: {
            AUDF: buildLeg(
              'AUDF',
              1,
              sigmaSeed('stable'),
              1_000_000,
              1_000_000,
              3_000_000,
              6,
              STABLE_PROFILE,
            ),
            NZDF: buildLeg(
              'NZDF',
              1,
              sigmaSeed('stable'),
              1_000_000,
              1_000_000,
              3_000_000,
              6,
              STABLE_PROFILE,
            ),
          },
          hub: { res: 3_000_000, liab: 2_000_000, kappaCovBps: 0 },
        },
      },
    ];
    const { best, routes } = await rankDeposit(pools, 'AUDF', 'NZDF', 5_000, {
      backend: {
        meta: { addressOf: () => null, decimalsOf: () => 6 },
        baseDecimals: 6,
        backendBase: 'https://q.example/v1',
      },
    });
    expect(best).toBeNull();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.feasible).toBe(false);
      expect(r.reason).toBe('backend-error');
    }
  });
});
