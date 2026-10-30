import { describe, expect, test } from 'bun:test';
import vectors from '../../test/fixtures/lp-toll-vectors.json';
import { buildDepositCalls } from '../router/index';
import { rankDeposit } from '../router/lpRoutes';
import { deposit, simulateDeposit } from './index';
import {
  bandRefusesEntry,
  cToll,
  depositShares,
  entryGapPbps,
  exposureTollPbps,
  hopSpreadPbps,
  minLpOut,
} from './lpToll';

const B = (s: string) => BigInt(s);

describe('lpToll vectors (shared with back/crates/quote)', () => {
  test('entryGap', () => {
    for (const v of vectors.entryGap) expect(entryGapPbps(B(v.age), B(v.maxDev))).toBe(B(v.want));
  });
  test('hop spread', () => {
    for (const v of vectors.hop) {
      const h = v.h as Record<string, string | boolean | undefined>;
      const got = hopSpreadPbps(
        {
          minFeePbps: B(h.minFee as string),
          staleExcessSecs: B(h.excess as string),
          sigmaPbps: B(h.sigma as string),
          maxDevBps: B(h.maxDev as string),
          obsAgeSecs: B(h.obsAge as string),
          refBandBps: B(h.refBand as string),
          refAgeSecs: h.refAge === undefined ? undefined : B(h.refAge as string),
          uoa: h.uoa as boolean,
          baseObsAgeSecs: h.baseAge === undefined ? undefined : B(h.baseAge as string),
          baseMaxDevBps: h.baseMaxDev === undefined ? undefined : B(h.baseMaxDev as string),
        },
        v.entry,
      );
      expect([v.name, got]).toEqual([v.name, B(v.want)]);
    }
  });
  test('exposure toll', () => {
    for (const v of vectors.toll) {
      const legs = v.legs.map((l) => ({
        reserveBase: B(l.r),
        claimBase: B(l.l),
        spreadPbps: B(l.sp),
      }));
      expect([v.name, exposureTollPbps(legs, B(v.g))]).toEqual([v.name, B(v.want)]);
    }
  });
  test('cToll and deposit receipt', () => {
    for (const v of vectors.cToll) expect(cToll(B(v.amt), B(v.toll))).toBe(B(v.want));
    for (const v of vectors.deposit) {
      const d = depositShares(B(v.amt), B(v.toll), B(v.c), B(v.idx));
      expect([d.face, d.shares]).toEqual([B(v.face), B(v.shares)]);
    }
  });
  test('banded clamp refuses entry', () => {
    for (const v of vectors.band) {
      const ref = v.ref === null ? null : { price: B(v.ref.price), ok: v.ref.ok };
      expect(bandRefusesEntry(B(v.mark), B(v.band), ref)).toBe(v.want);
    }
  });
  test('minLpOut floors', () => {
    expect(minLpOut(10_000n, 50n)).toBe(9_950n);
  });
});

describe('depositMin plumbing', () => {
  const POOL = `0x${'11'.repeat(20)}` as `0x${string}`;
  const TOK = `0x${'22'.repeat(20)}` as `0x${string}`;
  const USER = `0x${'44'.repeat(20)}` as `0x${string}`;
  const sel = (d: string) => d.slice(0, 10);
  test('a floor selects depositMin, none keeps deposit', () => {
    const t = {
      mode: 'transfer' as const,
      token: TOK,
      amount: 1000n,
      targetToken: TOK,
      lpAmountIn: 1n,
      minLpAmountOut: 1n,
    };
    const plain = buildDepositCalls(POOL, t, { recipient: USER, needsApproval: () => false });
    const floored = buildDepositCalls(
      POOL,
      { ...t, minLpOut: 990n },
      { recipient: USER, needsApproval: () => false },
    );
    expect(sel(plain[0].data)).not.toBe(sel(floored[0].data));
    expect(floored[0].data.length).toBeGreaterThan(plain[0].data.length);
  });
  test('pool.deposit sends depositMin with a floor', async () => {
    const sent: string[] = [];
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_sendTransaction') sent.push((params?.[0] as { data: string }).data);
        return '0xhash';
      },
    };
    await deposit(provider as never, POOL, { token: TOK, amount: 5n, minLpOut: 4n });
    await deposit(provider as never, POOL, { token: TOK, amount: 5n });
    expect(sent[0].length).toBeGreaterThan(sent[1].length);
  });
});

describe('simulateDeposit reads the minted shares off the real entrypoint', () => {
  test('the first word of DepositResult, from the caller', async () => {
    const calls: { from?: string; to?: string }[] = [];
    const word = (v: bigint) => v.toString(16).padStart(64, '0');
    const provider = {
      request: async ({ params }: { params?: unknown[] }) => {
        calls.push(params?.[0] as { from?: string });
        return `0x${word(999n)}${word(1000n)}${word(7n)}`;
      },
    };
    const USER = `0x${'44'.repeat(20)}` as `0x${string}`;
    const POOL = `0x${'11'.repeat(20)}` as `0x${string}`;
    const TOK = `0x${'22'.repeat(20)}` as `0x${string}`;
    expect(await simulateDeposit(provider as never, POOL, USER, TOK, 1000n)).toBe(999n);
    expect(calls[0].from).toBe(USER);
    expect(calls[0].to).toBe(POOL);
  });
});

describe('lpRoutes entry toll', () => {
  test('direct deposit mints (amt - toll)/C', async () => {
    const pools = [
      {
        tag: 'p',
        addr: POOL0,
        state: { base: 'USDC', legs: {}, hub: { res: 100, liab: 100, decimals: 6 } },
      },
    ] as never;
    const free = await rankDeposit(pools, 'USDC', 'USDC', 100, { slippageFrac: 0.01 });
    const tolled = await rankDeposit(pools, 'USDC', 'USDC', 100, {
      slippageFrac: 0.01,
      entryTollPbps: 10_000,
    });
    expect(tolled.best?.out).toBeCloseTo((free.best?.out ?? 0) * 0.99, 9);
  });
});
const POOL0 = `0x${'11'.repeat(20)}` as `0x${string}`;
