/** The wallet-path writers refuse a chain the caller did not ask for.
 *
 *  The front checks the wallet chain too, but a direct SDK caller had no guard: a wallet switched
 *  to another network after the quote would send the same calldata on the wrong chain. The check
 *  is opt-in (`expectedChainId`), so existing callers send exactly as before.
 */
import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { getSelector } from '../eth/abi.js';
import { Contract } from '../eth/contract.js';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';
import { deposit, swap, withdraw } from './index.js';

const POOL = '0x0000000000000000000000000000000000000010' as Address;
const USER = '0x00000000000000000000000000000000000000aa' as Address;
const TOKEN = '0x0000000000000000000000000000000000000001' as Address;

/** A wallet on chain 56 that records every method it is asked for, and every tx it is sent. */
function wallet(estimate = 780_023n) {
  const seen: string[] = [];
  const sent: { from?: string; gas?: string }[] = [];
  const provider = {
    request: ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      seen.push(method);
      if (method === 'eth_chainId') return Promise.resolve('0x38');
      if (method === 'eth_accounts') return Promise.resolve([USER]);
      if (method === 'eth_estimateGas') return Promise.resolve(`0x${estimate.toString(16)}`);
      if (method === 'eth_sendTransaction') {
        sent.push(params?.[0] as { from?: string; gas?: string });
        return Promise.resolve('0xhash' as Hex);
      }
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as Eip1193Provider;
  return { provider, seen, sent };
}

const swapParams = (expectedChainId?: number) => ({
  tokenIn: TOKEN,
  tokenOut: TOKEN,
  amountIn: 1n,
  minAmountOut: 1n,
  recipient: USER,
  deadline: 1n,
  ...(expectedChainId === undefined ? {} : { expectedChainId }),
});

describe('wallet-path writers bind the chain when asked', () => {
  test('swap sends on the expected chain', async () => {
    const { provider, seen } = wallet();
    await expect(swap(provider, POOL, swapParams(56))).resolves.toBe('0xhash');
    expect(seen).toEqual(['eth_chainId', 'eth_accounts', 'eth_estimateGas', 'eth_sendTransaction']);
  });

  test('swap refuses another chain before anything is sent', async () => {
    const { provider, seen } = wallet();
    await expect(swap(provider, POOL, swapParams(1))).rejects.toThrow(/chain mismatch/);
    expect(seen).toEqual(['eth_chainId']);
  });

  test('swap without expectedChainId sends unchecked, as before', async () => {
    const { provider, seen } = wallet();
    await expect(swap(provider, POOL, swapParams())).resolves.toBe('0xhash');
    expect(seen).toEqual(['eth_accounts', 'eth_estimateGas', 'eth_sendTransaction']);
  });

  test('pool txs carry the estimate × 1.25 as their gas limit, not the bare estimate', async () => {
    const { provider, sent } = wallet(780_023n);
    await swap(provider, POOL, swapParams());
    await deposit(provider, POOL, { token: TOKEN, amount: 1n });
    await withdraw(provider, POOL, { token: TOKEN, lpAmount: 1n, minAmountOut: 1n });
    expect(sent.map((t) => t.gas)).toEqual(['0xee0b5', '0xee0b5', '0xee0b5']); // 975,029
  });

  test('a pool tx refuses to send with no account connected', async () => {
    const provider = {
      request: ({ method }: { method: string }) =>
        method === 'eth_accounts' ? Promise.resolve([]) : Promise.reject(new Error(method)),
    } as unknown as Eip1193Provider;
    await expect(deposit(provider, POOL, { token: TOKEN, amount: 1n })).rejects.toThrow(
      /No account connected/,
    );
  });

  test('deposit and withdraw refuse another chain before anything is sent', async () => {
    const { provider: p1, seen: s1 } = wallet();
    await expect(
      deposit(p1, POOL, { token: TOKEN, amount: 1n, minLpOut: 1n, expectedChainId: 1 }),
    ).rejects.toThrow(/chain mismatch/);
    expect(s1).toEqual(['eth_chainId']);
    const { provider: p2, seen: s2 } = wallet();
    await expect(
      withdraw(p2, POOL, { token: TOKEN, lpAmount: 1n, minAmountOut: 1n, expectedChainId: 1 }),
    ).rejects.toThrow(/chain mismatch/);
    expect(s2).toEqual(['eth_chainId']);
  });

  test('Contract.write refuses another chain before anything is sent', async () => {
    const { provider, seen } = wallet();
    const c = new Contract({ address: POOL, abi: POOL_ABI, provider, account: USER });
    await expect(c.write('deposit', [TOKEN, 1n], { expectedChainId: 1 })).rejects.toThrow(
      /chain mismatch/,
    );
    expect(seen).toEqual(['eth_chainId']);
  });
});

describe('pool send: estimate and send share the sender; a revert names the pool error', () => {
  test('the send carries the same from the estimate ran from', async () => {
    const { provider, sent } = wallet(780_023n);
    await deposit(provider, POOL, { token: TOKEN, amount: 1n });
    expect(sent[0].from).toBe(USER);
  });

  test('an estimate that reverts with a pool custom error throws the decoded name, and sends nothing', async () => {
    const expired = getSelector('Expired()');
    const seen: string[] = [];
    const provider = {
      request: async ({ method }: { method: string }) => {
        seen.push(method);
        if (method === 'eth_chainId') return '0x38';
        if (method === 'eth_accounts') return [USER];
        if (method === 'eth_estimateGas')
          throw Object.assign(new Error('execution reverted'), { data: expired });
        throw new Error(`unexpected ${method}`);
      },
    } as unknown as Eip1193Provider;
    await expect(swap(provider, POOL, swapParams())).rejects.toThrow(/pool reverted: Expired/);
    expect(seen).not.toContain('eth_sendTransaction');
  });
});
