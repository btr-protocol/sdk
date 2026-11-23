/** Builders vs hand-assembled calldata (selector ‖ 32-byte words), byte for byte: the bytes the
 *  front encoded inline before it called these builders. */
import { describe, expect, test } from 'bun:test';
import { BatchOp } from './abis/solidity.generated.js';
import {
  batchRiskOpCall,
  claimTreasuryCalls,
  faucetClaimCalls,
  faucetRegisterCall,
  poolExitCall,
} from './calls.js';
import { getSelector } from './eth/abi.js';
import type { Address, Eip1193Provider, Hex } from './eth/types.js';
import { TxRevertedError, send } from './eth/send.js';
import { POOL_ABI } from './abis/Pool.js';
import { ADMIN_ABI } from './abis/Admin.js';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const w = (v: bigint | number | string) =>
  (typeof v === 'string' ? v.slice(2).toLowerCase() : BigInt(v).toString(16)).padStart(64, '0');
const ADMIN = A(0xad);
const P1 = A(0x11);
const P2 = A(0x12);
const T1 = A(0x21);
const T2 = A(0x22);

describe('call builders: exact calldata', () => {
  test('batchRiskOp(address[],address[],uint8,uint16)', () => {
    const c = batchRiskOpCall(
      ADMIN,
      [
        { pool: P1, token: T1 },
        { pool: P2, token: T2 },
      ],
      BatchOp.HALT,
      1,
      ADMIN_ABI,
    );
    const sig = getSelector('batchRiskOp(address[],address[],uint8,uint16)');
    // head: offset(pools)=0x80, offset(tokens)=0x80+0x60, op, src; tails: len + items
    const expected = `${sig}${w(0x80)}${w(0xe0)}${w(BatchOp.HALT)}${w(1)}${w(2)}${w(P1)}${w(P2)}${w(2)}${w(T1)}${w(T2)}`;
    expect(c).toEqual({ to: ADMIN, data: expected as Hex });
  });

  test('claimTreasury(address,address) per leg', () => {
    const sig = getSelector('claimTreasury(address,address)');
    expect(
      claimTreasuryCalls(ADMIN, [
        { pool: P1, token: T1 },
        { pool: P2, token: T2 },
      ], ADMIN_ABI),
    ).toEqual([
      { to: ADMIN, data: `${sig}${w(P1)}${w(T1)}` as Hex },
      { to: ADMIN, data: `${sig}${w(P2)}${w(T2)}` as Hex },
    ]);
  });

  test('faucet claim(address) / register()', () => {
    const F = A(0xfa);
    expect(faucetClaimCalls(F, [T1])).toEqual([
      { to: F, data: `${getSelector('claim(address)')}${w(T1)}` as Hex },
    ]);
    expect(faucetRegisterCall(F)).toEqual({ to: F, data: getSelector('register()') as Hex });
  });

  test('withdraw / withdrawTo with explicit floor and deadline', () => {
    expect(poolExitCall(P1, { token: T1 }, 5n, 4n, 99n).data).toBe(
      `${getSelector('withdraw(address,uint256,uint256,uint256)')}${w(T1)}${w(5)}${w(4)}${w(99)}` as Hex,
    );
    expect(poolExitCall(P1, { token: T1, toToken: T2 }, 5n, 4n, 99n).data).toBe(
      `${getSelector('withdrawTo(address,address,uint256,uint256,uint256)')}${w(T1)}${w(T2)}${w(5)}${w(4)}${w(99)}` as Hex,
    );
  });
});

describe('send', () => {
  const USER = A(0xaa);
  function wallet(status: '0x1' | '0x0' = '0x1', estimateErr?: unknown) {
    const seen: string[] = [];
    const sent: Record<string, string>[] = [];
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        seen.push(method);
        if (method === 'eth_chainId') return '0x38';
        if (method === 'eth_accounts') return [USER];
        if (method === 'eth_estimateGas') {
          if (estimateErr) throw estimateErr;
          return '0x64';
        }
        if (method === 'eth_sendTransaction') {
          sent.push(params?.[0] as Record<string, string>);
          return `0x${String(sent.length).padStart(64, '0')}`;
        }
        if (method === 'eth_getTransactionReceipt') return { status, blockNumber: '0x1' };
        throw new Error(`unexpected ${method}`);
      },
    } as unknown as Eip1193Provider;
    return { provider, seen, sent };
  }
  const calls = [
    { to: P1, data: '0x01' as Hex },
    { to: P2, data: '0x02' as Hex, value: 7n },
  ];

  test('estimates x1.25, sends in order, waits each receipt', async () => {
    const { provider, seen, sent } = wallet();
    const r = await send(provider, calls, { expectedChainId: 56 });
    expect(r.map((x) => x.receipt?.status)).toEqual(['0x1', '0x1']);
    expect(sent.map((t) => [t.to, t.gas, t.value, t.from])).toEqual([
      [P1, '0x7d', '0x0', USER],
      [P2, '0x7d', '0x7', USER],
    ]);
    expect(seen.filter((m) => m !== 'eth_getTransactionReceipt')).toEqual([
      'eth_chainId',
      'eth_accounts',
      'eth_estimateGas',
      'eth_sendTransaction',
      'eth_estimateGas',
      'eth_sendTransaction',
    ]);
  });

  test('wrong chain: nothing sent', async () => {
    const { provider, seen } = wallet();
    await expect(send(provider, calls, { expectedChainId: 1 })).rejects.toThrow(/chain mismatch/);
    expect(seen).toEqual(['eth_chainId']);
  });

  test('a mined revert stops before the next call', async () => {
    const { provider, sent } = wallet('0x0');
    await expect(send(provider, calls)).rejects.toBeInstanceOf(TxRevertedError);
    expect(sent).toHaveLength(1);
  });

  test('an estimate revert decodes against the given ABIs, nothing sent', async () => {
    const err = Object.assign(new Error('reverted'), { data: getSelector('Expired()') });
    const { provider, sent } = wallet('0x1', err);
    await expect(send(provider, calls, { abis: [POOL_ABI], label: 'pool' })).rejects.toThrow(
      'pool reverted: Expired',
    );
    expect(sent).toHaveLength(0);
  });
});
