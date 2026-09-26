/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, test } from 'bun:test';
import { buildCurve } from '../amm/aimm';
import type { Eip1193Provider } from '../eth/types';
import {
  MARK_STORE,
  MARK_WORD,
  MARK_WORD_V4,
  P8_CONF_TABLE,
  POOL_STORAGE,
  POOL_STORAGE_V3,
  POOL_STORAGE_V4,
  POOL_STORAGE_V5,
  POOL_STRUCTS,
  POOL_STRUCTS_V3,
  POOL_STRUCTS_V4,
  addressAt,
  curvePointer,
  decodeCustody,
  decodeLegOracle,
  decodeMark,
  decodeMarkWord,
  decodeP8Classes,
  decodeStoreWord,
  i8At,
  laneFloat,
  mappingBase,
  mappingBaseU16,
  p8ClassOf,
  p8Conf,
  p8Sigma,
  p8StoreWord,
  p8TierSlot,
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

test('layout v4 slots match dex ArtifactGuards.t.sol', () => {
  expect(POOL_STORAGE_V4).toEqual({
    baseToken: 0n,
    initialized: 0n,
    protoSharePct: 0n,
    flashFeePbps: 0n,
    flowCooldownSecs: 0n,
    solvencyArmed: 0n,
    lastGoodCWad9: 0n,
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
    marks: 13n,
  });
  expect(POOL_STRUCTS_V4.PoolStorage.lastGoodCWad9).toEqual([0, 27]);
  expect(POOL_STRUCTS_V4.Asset).toEqual(POOL_STRUCTS_V3.Asset);
  expect(POOL_STRUCTS_V4.Custody).toEqual(POOL_STRUCTS_V3.Custody);
});

// Layout v4 vectors shared with dex-evm test/unit/MarkWordLib.t.sol and core tests/storage.rs.
describe('the v4 marks word (MarkWordLib)', () => {
  test('offsets match dex abi/constants.json', () => {
    expect(MARK_WORD_V4).toEqual({
      OBS_SHIFT: 32,
      SIGMA_SHIFT: 64,
      CONF_SHIFT: 91,
      TTL_SHIFT: 107,
      MAX_DEV_SHIFT: 123,
      HALT_SHIFT: 134,
      REF_SHIFT: 135,
      REF_OBS_SHIFT: 167,
      REF_CONF_SHIFT: 199,
      REF_TTL_SHIFT: 215,
      REF_HALT_SHIFT: 231,
      INTERNAL_SHIFT: 232,
      UOA_SHIFT: 233,
      REF_BAND_SHIFT: 234,
      MAX_DEV_MAX: 2047,
    });
  });

  test('lane floats decode both shift directions', () => {
    expect(laneFloat(0)).toBe(0n);
    expect(laneFloat((1 << 24) | (16 << 25))).toBe(1n << 24n);
    expect(laneFloat(1 << 24)).toBe(1n << 8n);
    expect(laneFloat(((1 << 24) | (127 << 25)) >>> 0)).toBe(1n << 135n);
  });

  test('decode the three MarkWordLib vectors', () => {
    const v1 = decodeMarkWord('0x000192012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234');
    expect(v1.primary).toEqual({
      mark1e18: 1_000_099_971_145_400_320n,
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
    expect(v1.ref).toEqual({
      mark1e18: 1_000_199_992_343_789_568n,
      obs: 1_800_000_020,
      sigmaPbps: 0,
      confidenceBps: 1,
      ttlSecs: 600,
      maxDevBps: 0,
      halted: false,
      internal: false,
      uoa: false,
      refBandBps: 0,
    });
    const v2 = decodeMarkWord('0x03fffdfffffffffffffffffffffffffffffffffffdf5e100ffffffffefffffff');
    expect(v2.primary).toEqual({
      mark1e18: 340_282_356_779_733_661_637_539_395_458_142_568_448n,
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
    expect(v2.ref.mark1e18).toBe(87_112_283_335_611_817_379_210_085_237_284_497_522_688n);
    expect(v2.ref.halted).toBe(true);
    const r1 = decodeMarkWord('0x000000812c01f435a4e9003fb2e4b30000000000000000000000000000000000');
    expect(r1.primary.mark1e18).toBe(0n);
    expect(r1.ref).toEqual({
      mark1e18: 3_299_999_960_581_778_964_480n,
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
});

// Layout v3 parity vectors (frozen).
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

  // A v2 pool: `storageVersion()` answers 2, storage reads by slot.
  const providerFor = (words: Map<bigint, bigint>): Eip1193Provider => ({
    request: async ({ method, params }) => {
      if (method === 'eth_call') return `0x${'2'.padStart(64, '0')}`;
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

  // Layout v5: one eth_getCode at the pool's CREATE3 blob. Written by forge
  // (`NUQuarticLib.pack` of the BNB manifest's bell_100_inv, `SSTORE2.writeDeterministic` from pool
  // 0x…aa at salt 3); the same fixture pins core `tests/storage.rs`.
  const BLOB =
    '0x00000064138e0000000000000000000000000000000000001ead1c3513850fac05fffffffff7a546d500000003ed6755ec0000000d5dcceef7ffffffe8b789180000000000000000000000000000000000000000000000000000000000406338600000000003b01367000000005260da54000000056edb68d5fffffffa3ac5dc180000000000000000ffffffffffffffffffff1106a1533e07fffffffff2689b6ffffffffdb8ac136c000000003ca1e6da0000000d56999a6efffffffff21ace170000000000000000ffffffffffffffffffff05a947e5e42100000000dd3600b80000000006eb5211ffffffffe2c2975200000002f6f274080000000c1b3863830000000000000000ffffffffffffffffffff3c5dc12db4a4fffffffffdc44b1cffffffffb10d6f3bffffffff0378f1960000000973c3adae0000000ef99d0c0a0000000000000000ffffffffffffffffffff5dd4e2c164eb00000000268fcd77';
  const POINTER = '0x67203ddaCBdF2A9eF8289C271525271F4e0c0F0d';
  const v5 = (code: string): Eip1193Provider => ({
    request: async ({ method, params }) => {
      if (method === 'eth_call') return `0x${'5'.padStart(64, '0')}`;
      if (method === 'eth_getCode') {
        return (params as string[])[0].toLowerCase() === POINTER.toLowerCase() ? code : '0x';
      }
      throw new Error(`v5 reads no storage: ${method}`);
    },
  });

  test('v5: the blob at curvePointer decodes to the manifest row', async () => {
    const wQ = [
      -100000000000n,
      -85647928386n,
      -64270702607n,
      -27155504938n,
      27575155385n,
      58719227779n,
      81435312874n,
      92315558630n,
      100000000000n,
    ];
    expect(curvePointer(POOL, 3).toLowerCase()).toBe(POINTER.toLowerCase());
    expect(await readCurve(v5(BLOB), POOL, 3)).toEqual(
      buildCurve([4012, 4997, 7221, 7853], wQ, 100, 0),
    );
    expect(await readCurve(v5(BLOB), POOL, 4)).toBeNull();
  });
});

/** The layout-versioned readers, over a mock that answers `storageVersion()` and reads by slot. */
describe('versioned readers', () => {
  const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
  const word = (hex: string) => `0x${hex.padStart(64, '0')}` as `0x${string}`;
  const providerWith = (version: number, slots: Map<bigint, string>): Eip1193Provider =>
    ({
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method !== 'eth_call') return slots.get(BigInt(params[1] as string)) ?? word('0');
        // a D2b store reverts `classes()`
        if ((params[0] as { data: string }).data === '0x31e77853')
          throw Object.assign(new Error('execution reverted'), { code: 3 });
        return word(version.toString(16));
      },
    }) as unknown as Eip1193Provider;
  const rate = word((970n * 10n ** 15n).toString(16));

  test('lastGoodCWad: slot 14 on v2, 13 on v3, slot 0 tail at 1e-9 WAD on v4+', async () => {
    expect(await readSolvencyState(providerWith(2, new Map([[14n, rate]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    expect(await readSolvencyState(providerWith(3, new Map([[13n, rate]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    expect(await readSolvencyState(providerWith(3, new Map([[14n, rate]])), POOL)).toEqual({
      lastGoodCWad: 0n,
    });
    // slot 0 = lastGoodCWad9 (970_000_000) << 216 | an armed, initialized base
    const slot0 = word(((970_000_000n << 216n) | (1n << 208n) | (1n << 160n) | 0xbbn).toString(16));
    expect(await readSolvencyState(providerWith(4, new Map([[0n, slot0]])), POOL)).toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    expect(await readSolvencyState(providerWith(4, new Map([[13n, rate]])), POOL)).toEqual({
      lastGoodCWad: 0n,
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

  test('readMarks: one word at slot 13 on v4', async () => {
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const slots = new Map([
      [
        mappingBase(TOKEN, 13n),
        '0x000192012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234',
      ],
    ]);
    const m = await readMarks(providerWith(4, slots), POOL, TOKEN);
    expect(m?.primary.mark1e18).toBe(1_000_099_971_145_400_320n);
    expect(m?.primary.refBandBps).toBe(100);
    expect(m?.ref.mark1e18).toBe(1_000_199_992_343_789_568n);
  });

  test('readMarks: the lane word in the impl store on v5', async () => {
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const IMPL = `0x${'cc'.repeat(20)}`;
    // Asset slot 2: lane 9 | UOA, band 100.
    const slot2 = word(((100n << 240n) | (BigInt(0x80 | 9) << 232n)).toString(16));
    const slots = new Map([
      [mappingBase(TOKEN, POOL_STORAGE_V5.assets) + 2n, slot2],
      [0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn, word(IMPL.slice(2))],
      [MARK_STORE.MS + 9n, '0x000190012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234'],
    ]);
    const m = await readMarks(providerWith(5, slots), POOL, TOKEN);
    expect(m?.primary.mark1e18).toBe(1_000_099_971_145_400_320n);
    expect(m?.primary.sigmaPbps).toBe(400);
    expect(m?.primary.uoa).toBe(true);
    expect(m?.primary.refBandBps).toBe(100);
    expect(m?.ref.mark1e18).toBe(1_000_199_992_343_789_568n);
  });
});

describe('layout v5', () => {
  test('store base is keccak256("btr.markstore") - 1', () => {
    expect<bigint>(MARK_STORE.MS).toBe(
      BigInt('0x8fb4340288f7429bd33c13abd02aa3c2145e859f37a071b10e8e034e391167ea') - 1n,
    );
  });

  test('store word vectors match dex-evm MarkWordLib.t.sol and core', () => {
    const raw = '0x000190012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234';
    const leg = decodeStoreWord(raw, { internal: false, uoa: true, refBandBps: 100 });
    expect(leg.primary.sigmaPbps).toBe(400);
    expect(leg.primary.obs).toBe(1_800_000_030);
    expect(leg.ref.obs).toBe(1_800_000_020);
    expect(leg.primary.maxDevBps).toBe(50);
    expect([leg.primary.ttlSecs, leg.ref.ttlSecs]).toEqual([3600, 600]);
  });

  test('Asset slot 2 carries the leg oracle wiring', () => {
    const slot2 = `0x${((((4n << 12n) | 150n) << 240n) | (BigInt(0x40 | 7) << 232n)).toString(16).padStart(64, '0')}`;
    expect(decodeLegOracle(slot2 as `0x${string}`)).toEqual({
      lane: 7,
      internal: true,
      uoa: false,
      refBandBps: 150,
    });
  });
});

/** P8 words dumped from dex-evm `MarkStoreP8Migrate.t.sol` (`_populate` + `_migrate`) at
 *  1_790_005_070; `W` = `Pool.fallback`'s answer per lane. Same fixture as core `p8_fixture`. */
describe('P8 mark store', () => {
  const CLASSES = `0x${[
    '000000000000000000000000000000000000000000000000000000000a692249',
    '00000000050032e100000a0065c200002581909600007d03212c000050032e10',
    '0000000000000000000000000000000000000000000028019708000050032e10',
    'd2902ddffc7ba527eb1ed63e8bf88f092300c656f2f2fbbec7791fea29ab5061',
  ].join('')}` as `0x${string}`;
  const P = [
    '0x6ab14f4e1cf411a3bc223484f407a3bc2d931cf411a3bc22340cf7ffe3bc16d6',
    '0x6ab14f4e1cf411acffcb6afcf411afb1b967fcf411ad043c0af8f411b474bb55',
    '0x6ab14f4e0000000000000000000000000000fc03ffc00000001cf411af9131e6',
  ] as const;
  const R = [
    '0x6ab14f4e14f7ffe3bc16d614f7ffe3bc16d614f7ffe3bc16d614f7ffe3bc16d6',
    '0x6ab14f4e08f411acffcb6afcf411afb1b96708f411ad043c0a08f411b474bb55',
    '0x6ab14f4e0000000000000000000000000000fc03ffc000000014f7ffef9127a1',
  ] as const;
  const W = [
    '00000007080002b5589fa7b3de0b6b0190708000180003a06ab13f4f67bc16d6',
    '00000007080002b5589fa7b3de0b6b0190708000380003a06ab14f0867bc2234',
    '00000007080002b5589fa7b3de0b6b0190708001400003a06ab14f3067bc2d93',
    '00000007080002b5589fa7b3de0b6b0190708000380003a06ab14f0867bc2234',
    '000000012c00013558a78444ba5daac32012c000000003a06ab14f0800000000',
    '000000012c00013558a7843d821e05032012c000000003a06ab14f0800000000',
    '000000012c00003558a78400000000032012c000000003a06ab14f0800000000',
    '000000012c00013558a7843cffe5b5032012c000380003a06ab14f0879ffcb6a',
    '000000012c0002b5589fa7bfc893d0832012c000380003a06ab14f087f9131e6',
    '0000000708000035589fa7800000000190708000000000a06ab13f4f00000000',
  ];
  const cls = decodeP8Classes(CLASSES)!;

  test('store words = Pool.fallback + the class σ floor', () => {
    for (let l = 0; l < 10; l++) {
      const floor = p8ClassOf(cls, l)[2];
      const want = `0x${floor.toString(16).padStart(6, '0')}${W[l]!.slice(6)}`;
      expect<string>(p8StoreWord(P[l >> 2]!, R[l >> 2]!, l, cls)).toBe(want);
    }
  });

  test('codecs, class table, slots, store id', () => {
    let lo = 0n;
    let hi = 0n;
    P8_CONF_TABLE.forEach((v, i) => {
      if (i < 25) lo |= BigInt(v) << BigInt(10 * i);
      else hi |= BigInt(v) << BigInt(10 * (i - 25));
    });
    expect(lo).toBe(0x2307d1c264168501183e8e1320b42808c1f4701905a140470fc380c82d0a024n);
    expect(hi).toBe(0xfa352b4280n);
    expect([p8Conf(31), p8Conf(32), p8Conf(60), p8Conf(61)]).toEqual([31, 36, 1000, 0xffff]);
    expect([p8Sigma(0x20, 160), p8Sigma(0x20, 5000)]).toEqual([256, 5000]);
    expect(p8ClassOf(cls, 0)).toEqual([3600, 50, 160]);
    expect(p8ClassOf(cls, 7)).toEqual([600, 100, 300]);
    expect(p8ClassOf(cls, 10)).toEqual([0, 0, 0]);
    expect(p8TierSlot(2, 5)).toBe(MARK_STORE.MS + 17n);
    expect(decodeP8Classes(`0x${'00'.repeat(128)}`)).toBeNull();
  });

  test('readMarks: v5 pool on a P8 impl reads both tier words', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const slots = new Map<bigint, string>([
      [mappingBase(TOKEN, POOL_STORAGE_V5.assets) + 2n, pad((BigInt(7) << 232n).toString(16))],
      [0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn, pad('cc'.repeat(20))],
      [p8TierSlot(1, 7), P[1]],
      [p8TierSlot(2, 7), R[1]],
    ]);
    const provider = {
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method === 'eth_call') {
          const { data } = params[0] as { data: string };
          return data === '0x31e77853' ? CLASSES : pad('5');
        }
        return slots.get(BigInt(params[1] as string)) ?? pad('0');
      },
    } as unknown as Eip1193Provider;
    const m = await readMarks(provider, POOL, TOKEN);
    const want = decodeStoreWord(p8StoreWord(P[1], R[1], 7, cls), {
      internal: false,
      uoa: false,
      refBandBps: 0,
    });
    expect(m).toEqual(want);
    expect(m!.primary.mark1e18 > 0n && m!.ref.mark1e18 > 0n).toBe(true);
    expect(m!.primary.ttlSecs).toBe(600);
  });

  test('readMarks: classes() neither reverting nor P8 fails closed', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const at = (classes: () => unknown) =>
      ({
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method !== 'eth_call') return pad('0');
          return (params[0] as { data: string }).data === '0x31e77853' ? classes() : pad('5');
        },
      }) as unknown as Eip1193Provider;
    // right id, no lane classed: Pool's constructor rejects it, so no layout is known
    const unclassed = `0x${'00'.repeat(96)}${CLASSES.slice(2 + 192)}`;
    await expect(
      readMarks(
        at(() => unclassed),
        POOL,
        TOKEN,
      ),
    ).rejects.toThrow('not a P8 table');
    const rpc = Object.assign(new Error('relay: upstream revert-proxy timeout'), { code: -32603 });
    await expect(
      readMarks(
        at(() => {
          throw rpc;
        }),
        POOL,
        TOKEN,
      ),
    ).rejects.toBe(rpc);
  });
});
