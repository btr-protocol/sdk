/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, test } from 'bun:test';
import { buildCurve } from '../amm/aimm';
import type { Eip1193Provider } from '../eth/types';
import {
  POOL_STORAGE,
  addressAt,
  i8At,
  mappingBase,
  mappingBaseU16,
  readCurve,
  u8At,
  u16At,
  u32At,
} from './storage';

test('PoolStorage absolute slots match dex PoolStorageLayout.t.sol', () => {
  expect(POOL_STORAGE).toEqual({
    baseToken: 0n,
    wnative: 1n,
    treasury: 2n,
    assets: 3n,
    oracleConfigs: 4n,
    riskConfigs: 5n,
    curves: 6n,
    lpBalances: 7n,
    protocolFees: 8n,
    feeParams: 9n,
    flowCooldownSeconds: 10n,
    lastDepositTime: 11n,
    lastLPStakeTime: 12n,
    factory: 13n,
    assetHooks: 14n,
    invested: 15n,
  });
});

describe('storage word packing (LSB-aligned)', () => {
  // Word with uint16=0x1234 at offset 0, uint16=0xABCD at offset 2, uint32=0xDEADBEEF at offset 6
  // Built from the right: ... | DEADBEEF | ABCD | 1234
  const word = ('0x' +
    (() => {
      const b = new Uint8Array(32);
      b[31] = 0x34;
      b[30] = 0x12; // u16 0x1234 at offset 0
      b[29] = 0xcd;
      b[28] = 0xab; // u16 0xABCD at offset 2
      b[25] = 0xef;
      b[24] = 0xbe;
      b[23] = 0xad;
      b[22] = 0xde; // u32 0xDEADBEEF at offset 6
      return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    })()) as `0x${string}`;

  test('u16At / u32At', () => {
    expect(u16At(word, 0)).toBe(0x1234);
    expect(u16At(word, 2)).toBe(0xabcd);
    expect(u32At(word, 6)).toBe(0xdeadbeef);
  });

  test('u8At / i8At', () => {
    const w = ('0x' + '00'.repeat(30) + '80' + '7f') as `0x${string}`;
    expect(u8At(w, 0)).toBe(0x7f);
    expect(u8At(w, 1)).toBe(0x80);
    expect(i8At(w, 0)).toBe(0x7f);
    expect(i8At(w, 1)).toBe(-128);
  });

  test('addressAt offset 0', () => {
    const addr = '1111111111111111111111111111111111111111';
    const w = (`0x` + '00'.repeat(12) + addr) as `0x${string}`;
    expect(addressAt(w, 0).toLowerCase()).toBe('0x' + addr);
  });
});

describe('mappingBase', () => {
  test('is deterministic 32-byte slot', () => {
    const a = mappingBase('0x6dF80a290E0585dad752c25f2808E83b5624290d', 7n);
    const b = mappingBase('0x6dF80a290E0585dad752c25f2808E83b5624290d', 7n);
    expect(a).toBe(b);
    expect(a).not.toBe(mappingBase('0x6dF80a290E0585dad752c25f2808E83b5624290d', 6n));
  });
  test('uint16 key hashes like abi.encode(uint256(key), slot)', () => {
    expect(mappingBaseU16(1, 6n)).not.toBe(mappingBaseU16(2, 6n));
    expect(mappingBaseU16(1, 6n)).toBe(mappingBaseU16(1, 6n));
  });
});

describe('readCurve (NUQuartic.Curve storage decode)', () => {
  const POOL = '0x00000000000000000000000000000000000000AA' as const;
  const u64 = (v: bigint) => (v < 0n ? v + (1n << 64n) : v) & ((1n << 64n) - 1n);
  const u128 = (v: bigint) => (v < 0n ? v + (1n << 128n) : v) & ((1n << 128n) - 1n);

  // Pack a decoded curve exactly like NUQuartic.set writes storage.
  function packWords(c: ReturnType<typeof buildCurve>): Map<bigint, bigint> {
    let header = BigInt(c.m);
    c.boundaries.forEach((b, j) => {
      header |= BigInt(b) << BigInt(8 + 16 * j);
    });
    header |= BigInt(c.dispRef) << 232n;
    header |= BigInt(c.flags) << 248n;
    const base = mappingBaseU16(7, POOL_STORAGE.curves);
    const words = new Map<bigint, bigint>([[base, header]]);
    c.segs.forEach((s, i) => {
      words.set(
        base + 1n + BigInt(2 * i),
        u64(s.c0) | (u64(s.c1) << 64n) | (u64(s.c2) << 128n) | (u64(s.c3) << 192n),
      );
      words.set(base + 1n + BigInt(2 * i + 1), u64(s.c4) | (u128(s.S) << 64n));
    });
    return words;
  }

  const providerFor = (words: Map<bigint, bigint>): Eip1193Provider => ({
    request: async ({ params }) => {
      const slot = BigInt((params as string[])[1]);
      return `0x${(words.get(slot) ?? 0n).toString(16).padStart(64, '0')}`;
    },
  });

  test('round-trips a packed curve (header directory + 2m seg slots)', async () => {
    const wQ = Array.from({ length: 9 }, (_, i) => BigInt(i - 4) * 125_000_000_000n);
    const c = buildCurve([2000, 4000, 6000, 8000], wQ, 1000, 1);
    const got = await readCurve(providerFor(packWords(c)), POOL, 7);
    expect(got).toEqual(c);
  });

  test('unset preset (header 0) returns null', async () => {
    expect(await readCurve(providerFor(new Map()), POOL, 3)).toBeNull();
  });
});
