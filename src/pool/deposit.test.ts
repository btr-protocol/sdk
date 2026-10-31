import { describe, expect, test } from 'bun:test';
import { buildDepositCalls } from '../router/index';
import { deposit, minLpOut, simulateDeposit } from './index';

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
