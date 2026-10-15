/** SA-C10-16: the wallet-path writers refuse a chain the caller did not ask for.
 *
 *  The front checks the wallet chain too, but a direct SDK caller had no guard: a wallet switched
 *  to another network after the quote would send the same calldata on the wrong chain. The check
 *  is opt-in (`expectedChainId`), so existing callers send exactly as before.
 */
import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../abis/Pool.js';
import { Contract } from '../eth/contract.js';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';
import { deposit, swap, withdraw } from './index.js';

const POOL = '0x0000000000000000000000000000000000000010' as Address;
const USER = '0x00000000000000000000000000000000000000aa' as Address;
const TOKEN = '0x0000000000000000000000000000000000000001' as Address;

/** A wallet on chain 56 that records every method it is asked for. */
function wallet() {
  const seen: string[] = [];
  const provider = {
    request: ({ method }: { method: string; params?: unknown[] }): Promise<unknown> => {
      seen.push(method);
      if (method === 'eth_chainId') return Promise.resolve('0x38');
      if (method === 'eth_sendTransaction') return Promise.resolve('0xhash' as Hex);
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as Eip1193Provider;
  return { provider, seen };
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
    expect(seen).toEqual(['eth_chainId', 'eth_sendTransaction']);
  });

  test('swap refuses another chain before anything is sent', async () => {
    const { provider, seen } = wallet();
    await expect(swap(provider, POOL, swapParams(1))).rejects.toThrow(/chain mismatch/);
    expect(seen).toEqual(['eth_chainId']);
  });

  test('swap without expectedChainId sends unchecked, as before', async () => {
    const { provider, seen } = wallet();
    await expect(swap(provider, POOL, swapParams())).resolves.toBe('0xhash');
    expect(seen).toEqual(['eth_sendTransaction']);
  });

  test('deposit and withdraw refuse another chain before anything is sent', async () => {
    const { provider: p1, seen: s1 } = wallet();
    await expect(
      deposit(p1, POOL, { token: TOKEN, amount: 1n, expectedChainId: 1 }),
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
