/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, test } from 'bun:test';
import { buildCurve } from '../amm/aimm';
import type { Eip1193Provider } from '../eth/types';
import {
  POOL_STORAGE,
  POOL_STRUCTS,
  addressAt,
  i8At,
  mappingBase,
  mappingBaseU16,
  readCurve,
  u8At,
  u16At,
  u32At,
} from './storage';

// POOL_STORAGE / POOL_STRUCTS are generated from solc's storageLayout, so a test that re-reads
// that same artifact proves nothing. These expectations are written out by hand on purpose: they
// are the offline tripwire that catches a regeneration against the wrong build, and they run with
// no dex checkout at all.
test('PoolStorage absolute slots match dex PoolStorageLayout.t.sol', () => {
  expect(POOL_STORAGE).toEqual({
    baseToken: 0n,
    initialized: 0n,
    protoSharePct: 0n,
    flashFeePbps: 0n,
    flowCooldownSecs: 0n,
    wnative: 1n,
    treasury: 2n,
    factory: 3n,
    assets: 4n,
    oracleConfigs: 5n,
    curves: 6n,
    protocolFees: 7n,
    assetHooks: 8n,
    invested: 9n,
    lpTokens: 10n,
  });
});

test('packed field offsets match the Solidity struct packing', () => {
  expect(POOL_STRUCTS).toEqual({
    PoolStorage: {
      baseToken: [0, 0],
      initialized: [0, 20],
      protoSharePct: [0, 21],
      flashFeePbps: [0, 22],
      flowCooldownSecs: [0, 24],
      wnative: [1, 0],
      treasury: [2, 0],
      factory: [3, 0],
    },
    Asset: {
      reserves: [0, 0],
      liabilities: [0, 16],
      anchor: [1, 0],
      minLiquidity: [1, 20],
      liquidityIndexWad: [2, 0],
      minDispersionPbps: [2, 12],
      presetId: [2, 16],
      minFeePbps: [2, 18],
      vegaBps: [2, 20],
      haircutSuppressorBps: [2, 22],
      decimals: [2, 24],
      deadSeedPow10: [2, 25],
      flags: [2, 26],
      kappaCovBps: [2, 28],
    },
    // Quote-source half (feedId, primary, mode, quoteUnit) then the breaker half.
    OracleConfig: {
      feedId: [0, 0],
      primary: [1, 0],
      mode: [1, 20],
      quoteUnit: [1, 21],
      refBandBps: [1, 22],
      refFeedId: [2, 0],
      refPrimary: [3, 0],
    },
    HookSlot: {
      target: [0, 0],
      flags: [0, 20],
      lastCreditAt: [0, 24],
    },
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
    // Interior boundaries ONLY: b_m is the BPS constant and is never stored (NUQuartic.set).
    // Writing it here too would leave the directory one entry wider than the contract's.
    c.boundaries.slice(0, -1).forEach((b, j) => {
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
