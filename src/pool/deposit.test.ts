import { describe, expect, test } from 'bun:test';
import { buildDepositCalls, buildRedeemCalls } from '../router/index';
import {
  MAX_DEADLINE_S,
  defaultDeadline,
  deposit,
  minLpOut,
  sendDeadline,
  simulateDeposit,
  simulatePoolCall,
  syncChainClock,
} from './index';

describe('minLpOut', () => {
  test('floors the shares less the slippage in bps', () => {
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

const P = `0x${'11'.repeat(20)}` as `0x${string}`;
const T = `0x${'22'.repeat(20)}` as `0x${string}`;
const U = `0x${'44'.repeat(20)}` as `0x${string}`;

describe('simulatePoolCall answers for any pool entrypoint', () => {
  test('swapLiability decodes the minted shares from the eth_call', async () => {
    const calls: { params: [{ from: string }] }[] = [];
    const provider = {
      request: async (r: { params: [{ from: string }] }) => {
        calls.push(r);
        return `0x${4242n.toString(16).padStart(64, '0')}`;
      },
    };
    const args = [T, T, 10n, 1n, 1n];
    expect(await simulatePoolCall<bigint>(provider as never, P, U, 'swapLiability', args)).toBe(
      4242n,
    );
    expect(calls[0].params[0].from).toBe(U);
  });
});

// r2 C-F-3: a bad back value parsed to 0 became an unfloored burn/liability swap.
describe('LP builders refuse a zero floor', () => {
  const opts = { recipient: U };
  test('deposit-first, cross exit and transfer exit', () => {
    const mint = {
      mode: 'transfer' as const,
      token: T,
      amount: 1n,
      targetToken: T,
      lpAmountIn: 1n,
    };
    expect(() => buildDepositCalls(P, { ...mint, minLpAmountOut: 0n }, opts)).toThrow(/positive/);
    const cross = { mode: 'cross' as const, tokenFrom: T, tokenTo: T, lpAmount: 1n };
    expect(() => buildRedeemCalls(P, { ...cross, minAmountOut: 0n }, opts)).toThrow(/positive/);
    const tr = { mode: 'transfer' as const, tokenFrom: T, tokenTo: T, lpAmountIn: 1n };
    for (const bad of [
      { minLpAmountOut: 0n, lpWithdraw: 1n, minAmountOut: 1n },
      { minLpAmountOut: 1n, lpWithdraw: 0n, minAmountOut: 1n },
      { minLpAmountOut: 1n, lpWithdraw: 1n, minAmountOut: 0n },
    ])
      expect(() => buildRedeemCalls(P, { ...tr, ...bad }, opts)).toThrow(/positive/);
    expect(buildRedeemCalls(P, { ...cross, minAmountOut: 1n }, opts)).toHaveLength(1);
  });
});

// r2 C-F-7: deadlines came off the device clock; a skewed device widened the window.
// R3C-1: the clock source may lie too, so a skew past MAX_CLOCK_SKEW_S refuses instead.
describe('syncChainClock', () => {
  const at = (timestamp: unknown) => ({ request: async () => ({ timestamp }) });
  const hex = (s: number) => `0x${s.toString(16)}`;
  const nowS = () => Math.floor(Date.now() / 1000);
  test('deadlines follow chain time, not the device clock', async () => {
    const chainNow = nowS() - 90; // device 90 s ahead, inside the bound
    await syncChainClock(at(hex(chainNow)) as never);
    const d = Number(defaultDeadline());
    expect(d - chainNow).toBeGreaterThanOrEqual(600);
    expect(d - chainNow).toBeLessThan(605);
    await syncChainClock(at(hex(nowS())) as never);
  });
  test('a chain clock past the skew bound refuses and keeps the last offset', async () => {
    await syncChainClock(at(hex(nowS())) as never);
    const before = defaultDeadline();
    await expect(syncChainClock(at(hex(nowS() + 3_600)) as never)).rejects.toThrow(/clock/);
    await expect(syncChainClock(at(hex(nowS() - 121)) as never)).rejects.toThrow(/bound 120s/);
    expect(defaultDeadline() - before).toBeLessThan(5n);
    await syncChainClock(at(hex(nowS() - 200)) as never, 300);
    await syncChainClock(at(hex(nowS())) as never);
  });
  test('no timestamp refuses', async () => {
    await expect(syncChainClock(at(undefined) as never)).rejects.toThrow(/timestamp/);
    await expect(syncChainClock({ request: async () => null } as never)).rejects.toThrow();
  });
});

describe('sendDeadline', () => {
  const POOL = `0x${'11'.repeat(20)}` as `0x${string}`;
  const TOK = `0x${'22'.repeat(20)}` as `0x${string}`;
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  test('defaults inside the window; a window past MAX_DEADLINE_S refuses', () => {
    expect(sendDeadline() - nowS).toBeLessThanOrEqual(BigInt(MAX_DEADLINE_S));
    expect(sendDeadline(nowS + 60n)).toBe(nowS + 60n);
    expect(() => sendDeadline(nowS + BigInt(MAX_DEADLINE_S) + 10n)).toThrow(/past chain time/);
    expect(() => sendDeadline(-1n)).toThrow(/>= 0/);
  });
  test('the calldata builders refuse a far-future deadline', () => {
    const far = nowS + 86_400n;
    const t = {
      mode: 'transfer' as const,
      token: TOK,
      amount: 1n,
      targetToken: TOK,
      lpAmountIn: 1n,
      minLpAmountOut: 1n,
    };
    expect(() =>
      buildDepositCalls(POOL, t, {
        recipient: POOL,
        needsApproval: () => false,
        deadline: far,
      }),
    ).toThrow(/past chain time/);
  });
});
