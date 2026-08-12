// Regression tests for the compact ABI coder.
// Covers the 2026-06 fixes: keccak selector derivation (no more hardcoded-only
// table), canonical tuple signatures, dynamic-tuple encoding inside arrays
// (multicall3 aggregate3), and container-resolved pointer decoding.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { POOL_ABI } from '../abis/Pool';
import type { AbiFunction } from './abi';
import {
  canonicalType,
  decodeAbiParameters,
  decodeFn,
  encodeAbiParameters,
  encodeFn,
  getPlan,
  getSelector,
} from './abi';

const MC3_ABI = [{
  name: 'aggregate3',
  inputs: [{ type: 'tuple[]', components: [
    { name: 't', type: 'address' },
    { name: 'f', type: 'bool' },
    { name: 'd', type: 'bytes' },
  ]}],
  outputs: [{ type: 'tuple[]', components: [
    { name: 's', type: 'bool' },
    { name: 'r', type: 'bytes' },
  ]}],
}];

describe('getSelector', () => {
  test('derives well-known selectors (4byte-verified)', () => {
    expect(getSelector('balanceOf(address)')).toBe('0x70a08231');
    expect(getSelector('aggregate3((address,bool,bytes)[])')).toBe('0x82ad56cb');
  });

  test('derives unknown selectors via keccak-256 (ERC-4626)', () => {
    expect(getSelector('convertToAssets(uint256)')).toBe('0x07a2d13a');
    expect(getSelector('totalAssets()')).toBe('0x01e1d114');
    expect(getSelector('maxDeposit(address)')).toBe('0x402d267d');
    expect(getSelector('maxWithdraw(address)')).toBe('0xce96cb77');
    expect(getSelector('redeem(uint256,address,address)')).toBe('0xba087652');
    expect(getSelector('withdraw(uint256,address,address)')).toBe('0xb460af94');
  });
});

// Guards the defect class that put a selector for the retired 5-arg
// `swap(address,address,uint256,uint256,address)` into a hand-written table: BTR contract
// signatures must exist in exactly one place, the generated ABIs under src/abis.
describe('no hand-maintained mirrors of on-chain signatures', () => {
  test('POOL_ABI is the sole source of the swap signature', () => {
    const swaps = (POOL_ABI as unknown as AbiFunction[]).filter((f) => f.name === 'swap');
    expect(swaps.length).toBe(1); // no overloads: one signature to keep straight
    const sig = `swap(${(swaps[0]?.inputs ?? []).map(canonicalType).join(',')})`;
    // Pinned by hand off Pool.sol: 6 args, trailing deadline.
    expect(sig).toBe('swap(address,address,uint256,uint256,address,uint256)');
    expect(getPlan(POOL_ABI, 'swap').selector).toBe('0x9908fc8b');
    // The retired 5-arg form hashes to a real-looking selector that no longer resolves —
    // it would land in Pool.fallback and be DELEGATECALLed into PoolAux.
    expect(getSelector('swap(address,address,uint256,uint256,address)')).toBe('0xd5bcb9b5');
    expect(getPlan(POOL_ABI, 'swap').selector).not.toBe('0xd5bcb9b5');
  });

  test('only external-standard modules declare ABI fragments outside src/abis', () => {
    // ERC/WETH9/LayerZero shapes are frozen by their standards and have no generated ABI here.
    // Everything BTR-owned must import from src/abis, so no other file may inline a function ABI.
    const allowed = new Set([
      'eth/erc20.ts', 'eth/erc721.ts', 'eth/erc777.ts', 'eth/erc1155.ts',
      'eth/erc4626.ts', 'eth/erc7540.ts', 'eth/layerzero-oft.ts',
      'eth/abi.ts', // type declarations, not fragments
      'router/index.ts', // WNATIVE_ABI (WETH9 wrap/unwrap)
    ]);
    const src = new URL('..', import.meta.url).pathname;
    const offenders = [...new Bun.Glob('**/*.ts').scanSync({ cwd: src })]
      .filter((f) => !f.startsWith('abis/') && !f.endsWith('.test.ts') && !allowed.has(f))
      .filter((f) => readFileSync(`${src}${f}`, 'utf8').includes("type: 'function'"));
    expect(offenders).toEqual([]);
  });
});

describe('canonicalType', () => {
  test('expands tuples to component types', () => {
    expect(canonicalType(MC3_ABI[0].inputs[0] as never)).toBe('(address,bool,bytes)[]');
    expect(canonicalType({ type: 'uint256' })).toBe('uint256');
    expect(canonicalType({
      type: 'tuple',
      components: [{ type: 'address' }, { type: 'tuple[]', components: [{ type: 'bytes' }] }],
    })).toBe('(address,(bytes)[])');
  });
});

describe('aggregate3 encoding (tuple[] of dynamic tuples)', () => {
  test('matches canonical ABI layout', () => {
    const data = encodeFn({
      abi: MC3_ABI,
      functionName: 'aggregate3',
      args: [[{ t: '0x0b9cca59cefde03ad8e41da272d946861fa7717f', f: true, d: '0x01e1d114' }]],
    });
    const words = data.slice(10).match(/.{1,64}/g) ?? [];
    expect(data.slice(0, 10)).toBe('0x82ad56cb');           // canonical selector
    expect(BigInt(`0x${words[0]}`)).toBe(0x20n);             // arg head → tail ptr
    expect(BigInt(`0x${words[1]}`)).toBe(1n);                // array length
    expect(BigInt(`0x${words[2]}`)).toBe(0x20n);             // per-element offset (dynamic tuple)
    expect(words[3].endsWith('0b9cca59cefde03ad8e41da272d946861fa7717f')).toBe(true);
    expect(BigInt(`0x${words[4]}`)).toBe(1n);                // bool true
    expect(BigInt(`0x${words[5]}`)).toBe(0x60n);             // bytes offset within tuple
    expect(BigInt(`0x${words[6]}`)).toBe(4n);                // bytes length
    expect(words[7].startsWith('01e1d114')).toBe(true);      // calldata payload
  });

  test('round-trips through output decoder', () => {
    // Encode a fake aggregate3 RETURN payload using the output tuple shape,
    // then decode it via decodeFn.
    const ret = encodeAbiParameters(
      [MC3_ABI[0].outputs[0] as never],
      [[{ s: true, r: `0x${'2dc75f'.padStart(64, '0')}` }, { s: false, r: '0x' }]],
    );
    const decoded = decodeFn({ abi: MC3_ABI, functionName: 'aggregate3', data: ret }) as { s: boolean; r: string }[];
    expect(decoded.length).toBe(2);
    expect(decoded[0].s).toBe(true);
    expect(BigInt(decoded[0].r)).toBe(0x2dc75fn);
    expect(decoded[1].s).toBe(false);
    expect(decoded[1].r).toBe('0x');
  });
});

describe('parameter round-trips', () => {
  test('mixed static + dynamic params', () => {
    const params = [{ type: 'string' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'address' }];
    const vals = ['hello world', 42n, '0xdeadbeef', '0x0b9cca59cefde03ad8e41da272d946861fa7717f'];
    const out = decodeAbiParameters(params, encodeAbiParameters(params, vals));
    expect(out[0]).toBe('hello world');
    expect(out[1]).toBe(42n);
    expect(out[2]).toBe('0xdeadbeef');
    expect(out[3]).toBe('0x0b9cca59cefde03ad8e41da272d946861fa7717f');
  });

  test('uint256[] dynamic array', () => {
    const params = [{ type: 'uint256[]' }];
    const out = decodeAbiParameters(params, encodeAbiParameters(params, [[1n, 2n, 3n]]));
    expect(out[0]).toEqual([1n, 2n, 3n]);
  });

  test('static tuple stays inline', () => {
    const params = [{ type: 'tuple', components: [{ name: 'a', type: 'uint256' }, { name: 'b', type: 'address' }] }];
    const enc = encodeAbiParameters(params, [{ a: 7n, b: '0x0b9cca59cefde03ad8e41da272d946861fa7717f' }]);
    expect(enc.length).toBe(2 + 64 * 2); // two inline words, no pointer
    const out = decodeAbiParameters(params, enc) as { a: bigint; b: string }[];
    expect(out[0].a).toBe(7n);
    expect(out[0].b).toBe('0x0b9cca59cefde03ad8e41da272d946861fa7717f');
  });
});
