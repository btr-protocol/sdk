/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, test } from 'bun:test';
import { buildCurve } from '../amm/aimm';
import type { Eip1193Provider } from '../eth/types';
import {
  MARK_WORD,
  POOL_STORAGE,
  POOL_STORAGE_V3,
  POOL_STRUCTS,
  POOL_STRUCTS_V3,
  addressAt,
  decodeCustody,
  decodeMark,
  i8At,
  mappingBase,
  mappingBaseU16,
  readCurve,
  readMarks,
  readSolvencyState,
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
    solvencyArmed: 0n,
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
    poolAdmin: 11n,
    // 12 is RESERVED; LED-A appended the roster and the fallback.
    legs: 13n,
    lastGoodCWad: 14n,
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
      solvencyArmed: [0, 26],
      wnative: [1, 0],
      treasury: [2, 0],
      factory: [3, 0],
      poolAdmin: [11, 0],
    },
    Asset: {
      reserves: [0, 0],
      liabilities: [0, 16],
      anchor: [1, 0],
      minLiquidity: [1, 20],
      liquidityIndexWad: [2, 0],
      minDispersionPbps: [2, 12],
      curveId: [2, 16],
      minFeePbps: [2, 18],
      vegaBps: [2, 20],
      depositCapCode: [2, 22],
      decimals: [2, 24],
      deadSeedPow10: [2, 25],
      flags: [2, 26],
      kappaCovBps: [2, 28],
      maxLiabWeightBps: [2, 30],
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

test('layout v3 slots match dex ArtifactGuards.t.sol', () => {
  expect(POOL_STORAGE_V3).toEqual({
    baseToken: 0n,
    initialized: 0n,
    protoSharePct: 0n,
    flashFeePbps: 0n,
    flowCooldownSecs: 0n,
    solvencyArmed: 0n,
    wnative: 1n,
    treasury: 2n,
    factory: 3n,
    assets: 4n,
    oracleConfigs: 5n,
    curves: 6n,
    custody: 7n,
    assetHooks: 8n,
    lpTokens: 9n,
    poolAdmin: 10n,
    // 11 is RESERVED.
    legs: 12n,
    lastGoodCWad: 13n,
    marks: 14n,
  });
  expect(POOL_STRUCTS_V3.PoolStorage.poolAdmin).toEqual([10, 0]);
  expect(POOL_STRUCTS_V3.Custody).toEqual({ protocolFees: [0, 0], invested: [0, 16] });
  expect(POOL_STRUCTS_V3.Asset).toEqual(POOL_STRUCTS.Asset);
  expect(POOL_STRUCTS_V3.OracleConfig).toEqual(POOL_STRUCTS.OracleConfig);
  expect(POOL_STRUCTS_V3.HookSlot).toEqual(POOL_STRUCTS.HookSlot);
});

// Parity vectors shared with dex-evm test/unit/MarkWordLib.t.sol and core tests/storage.rs.
describe('marks words (MarkWordLib)', () => {
  test('offsets match dex abi/constants.json', () => {
    expect(MARK_WORD).toEqual({
      OBS_SHIFT: 128,
      SIGMA_SHIFT: 160,
      CONF_SHIFT: 187,
      TTL_SHIFT: 203,
      MAX_DEV_SHIFT: 219,
      HALT_SHIFT: 230,
      INTERNAL_SHIFT: 231,
      UOA_SHIFT: 232,
      REF_BAND_SHIFT: 233,
      MAX_DEV_MAX: 2047,
    });
  });

  test('decode the three MarkWordLib vectors', () => {
    expect(
      decodeMark('0x0000c90190708000100001406b49d21e00000000000000000de111a6b7de4000'),
    ).toEqual({
      mark1e18: 1_000_100_000_000_000_000n,
      obs: 1_800_000_030,
      sigmaPbps: 320,
      confidenceBps: 2,
      ttlSecs: 3600,
      maxDevBps: 50,
      halted: false,
      internal: false,
      uoa: true,
      refBandBps: 100,
    });
    expect(
      decodeMark('0x01fffefffffffffffdf5e100ffffffffffffffffffffffffffffffffffffffff'),
    ).toEqual({
      mark1e18: (1n << 128n) - 1n,
      obs: 0xffffffff,
      sigmaPbps: 100_000_000,
      confidenceBps: 0xffff,
      ttlSecs: 0xffff,
      maxDevBps: 2047,
      halted: true,
      internal: true,
      uoa: false,
      refBandBps: 0xffff,
    });
    // Word 1 (reference feed): the same feed bits, no mirror.
    expect(
      decodeMark('0x000000400012c01f400000006b49d20000000000000000b2e4b323d9c5100000'),
    ).toEqual({
      mark1e18: 3300n * 10n ** 18n,
      obs: 1_800_000_000,
      sigmaPbps: 0,
      confidenceBps: 1000,
      ttlSecs: 600,
      maxDevBps: 0,
      halted: true,
      internal: false,
      uoa: false,
      refBandBps: 0,
    });
  });

  test('custody splits into protocolFees (low) and invested (high)', () => {
    const w = `0x${((5_000_000n << 128n) | 123_000_000n).toString(16).padStart(64, '0')}` as const;
    expect(decodeCustody(w)).toEqual({ protocolFees: 123_000_000n, invested: 5_000_000n });
  });
});

describe('storage word packing (LSB-aligned)', () => {
  // Word with uint16=0x1234 at offset 0, uint16=0xABCD at offset 2, uint32=0xDEADBEEF at offset 6
  // Built from the right: ... | DEADBEEF | ABCD | 1234
  const word = `0x${(() => {
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
  })()}` as `0x${string}`;

  test('u16At / u32At', () => {
    expect(u16At(word, 0)).toBe(0x1234);
    expect(u16At(word, 2)).toBe(0xabcd);
    expect(u32At(word, 6)).toBe(0xdeadbeef);
  });

  test('u8At / i8At', () => {
    const w = `0x${'00'.repeat(30)}807f` as `0x${string}`;
    expect(u8At(w, 0)).toBe(0x7f);
    expect(u8At(w, 1)).toBe(0x80);
    expect(i8At(w, 0)).toBe(0x7f);
    expect(i8At(w, 1)).toBe(-128);
  });

  test('addressAt offset 0', () => {
    const addr = '1111111111111111111111111111111111111111';
    const w = `0x${'00'.repeat(12)}${addr}` as `0x${string}`;
    expect(addressAt(w, 0).toLowerCase()).toBe(`0x${addr}`);
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

describe('readCurve (NUQuarticLib.Curve storage decode)', () => {
  const POOL = '0x00000000000000000000000000000000000000AA' as const;
  const u64 = (v: bigint) => (v < 0n ? v + (1n << 64n) : v) & ((1n << 64n) - 1n);
  const u128 = (v: bigint) => (v < 0n ? v + (1n << 128n) : v) & ((1n << 128n) - 1n);

  // Pack a decoded curve exactly like NUQuarticLib.set writes storage.
  function packWords(c: ReturnType<typeof buildCurve>): Map<bigint, bigint> {
    let header = BigInt(c.m);
    // Interior boundaries ONLY: b_m is the BPS constant and is never stored (NUQuarticLib.set).
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

  test('unset curve (header 0) returns null', async () => {
    expect(await readCurve(providerFor(new Map()), POOL, 3)).toBeNull();
  });
});

/** The layout-versioned readers, over a mock that answers `storageVersion()` and reads by slot. */
describe('versioned readers', () => {
  const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
  const word = (hex: string) => `0x${hex.padStart(64, '0')}` as `0x${string}`;
  const providerWith = (version: number, slots: Map<bigint, string>): Eip1193Provider =>
    ({
      request: async ({ method, params }: { method: string; params: unknown[] }) =>
        method === 'eth_call'
          ? word(version.toString(16))
          : (slots.get(BigInt(params[1] as string)) ?? word('0')),
    }) as unknown as Eip1193Provider;
  const rate = word((970n * 10n ** 15n).toString(16));

  test('lastGoodCWad: slot 14 on v2, 13 on v3 and every later version', async () => {
    expect(await readSolvencyState(providerWith(2, new Map([[14n, rate]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    expect(await readSolvencyState(providerWith(3, new Map([[13n, rate]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    expect(await readSolvencyState(providerWith(3, new Map([[14n, rate]])), POOL)).toEqual({
      lastGoodCWad: 0n,
    });
    expect(await readSolvencyState(providerWith(4, new Map([[13n, rate]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
  });

  test('a never-observed rate reads 0', async () => {
    const st = await readSolvencyState(providerWith(2, new Map()), POOL);
    expect(st).toEqual({ lastGoodCWad: 0n });
  });

  test('readMarks: both words on v3, null on v2', async () => {
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const base = mappingBase(TOKEN, POOL_STORAGE_V3.marks);
    const slots = new Map([
      [base, '0x0000c90190708000100001406b49d21e00000000000000000de111a6b7de4000'],
      [base + 1n, '0x000000400012c01f400000006b49d20000000000000000b2e4b323d9c5100000'],
    ]);
    const m = await readMarks(providerWith(3, slots), POOL, TOKEN);
    expect(m?.primary.mark1e18).toBe(1_000_100_000_000_000_000n);
    expect(m?.ref.mark1e18).toBe(3300n * 10n ** 18n);
    expect(await readMarks(providerWith(2, slots), POOL, TOKEN)).toBeNull();
  });
});
