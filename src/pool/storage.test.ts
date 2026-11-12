/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { buildCurve } from '../amm/aimm';
import { keccak256 } from '../eth/index';
import type { Eip1193Provider } from '../eth/types';
import {
  MARK_STORE_V5,
  MARK_STORE_V10,
  MARK_WORD_V4,
  MARK_WORD_WIRE2,
  P8_CONF_TABLE,
  POOL_AREA_V10,
  POOL_STORAGE_V5,
  POOL_STORAGE_V10,
  POOL_STRUCTS,
  addressAt,
  curvePointer,
  curveSlot,
  decodeClassHead,
  decodeCustody,
  decodeLegOracle,
  decodeMarkWord,
  decodeP8Classes,
  decodeStoreWord,
  i8At,
  laneFloat,
  layoutOf,
  mappingBase,
  markStoreOf,
  p8ClassOf,
  p8Conf,
  p8Sigma,
  p8StoreWord,
  p8TierSlot,
  poolStorageOf,
  readClassHead,
  readCurve,
  readCustody,
  readLegCov,
  readMarks,
  readOracleConfig,
  readSolvencyState,
  recordSlot,
  swapGateAdmits,
  u8At,
  u16At,
  u32At,
  wireOf,
} from './storage';

// POOL_STRUCTS is generated from solc's storageLayout, so a test that re-reads that same artifact
// proves nothing. These expectations are written out by hand on purpose: the offline tripwire that
// catches a regeneration against the wrong build. Only the live structs remain (v2..v4 are retired).
test('live Asset and HookSlot packing match the Solidity struct packing', () => {
  expect(POOL_STRUCTS).toEqual({
    Asset: {
      reserves: [0, 0],
      liabilities: [0, 16],
      anchor: [1, 0],
      minLiquidity: [1, 20],
      liquidityIndexWad: [2, 0],
      minDispersionPbps: [2, 9],
      curveId: [2, 13],
      minFeePbps: [2, 15],
      vegaBps: [2, 17],
      depositCapCode: [2, 19],
      decimals: [2, 21],
      deadSeedPow10: [2, 22],
      flags: [2, 23],
      maxLiabWeightBps: [2, 25],
      oracleBits: [2, 27],
      covBits: [2, 28],
      kneeBits: [3, 0],
    },
    AssetV5: {
      reserves: [0, 0],
      liabilities: [0, 16],
      anchor: [1, 0],
      minLiquidity: [1, 20],
      liquidityIndexWad: [2, 0],
      minDispersionPbps: [2, 9],
      curveId: [2, 13],
      minFeePbps: [2, 15],
      vegaBps: [2, 17],
      depositCapCode: [2, 19],
      decimals: [2, 21],
      deadSeedPow10: [2, 22],
      flags: [2, 23],
      kappaCovBps: [2, 25],
      maxLiabWeightBps: [2, 27],
      oracleBits: [2, 29],
      refBandBps: [2, 30],
    },
    HookSlot: {
      target: [0, 0],
      flags: [0, 20],
      lastCreditAt: [0, 24],
      creditBookCode: [0, 28],
    },
  });
});

// Layout v4 vectors shared with dex-evm test/unit/MarkWordLib.t.sol and core tests/storage.rs.
describe('the v4 marks word (MarkWordLib)', () => {
  test('offsets: wire 3 = MarkWordLib 1bfe04ed (one tier, depeg code), wire 2 keeps the R tier', () => {
    expect(MARK_WORD_V4).toEqual({
      OBS_SHIFT: 32,
      SIGMA_SHIFT: 64,
      CONF_SHIFT: 91,
      TTL_SHIFT: 107,
      MAX_DEV_SHIFT: 123,
      HALT_SHIFT: 134,
      INTERNAL_SHIFT: 232,
      MIN_SIGMA_SHIFT: 232,
      UOA_SHIFT: 233,
      DEPEG_SHIFT: 234,
      MAX_DEV_MAX: 2047,
    });
    expect(MARK_WORD_WIRE2).toEqual({
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

  test('decode the three wire-2 MarkWordLib vectors', () => {
    const v1 = decodeMarkWord(
      '0x000192012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234',
      2,
    );
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
    const v2 = decodeMarkWord(
      '0x03fffdfffffffffffffffffffffffffffffffffffdf5e100ffffffffefffffff',
      2,
    );
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
    expect(v2.ref!.mark1e18).toBe(87_112_283_335_611_817_379_210_085_237_284_497_522_688n);
    expect(v2.ref!.halted).toBe(true);
    const r1 = decodeMarkWord(
      '0x000000812c01f435a4e9003fb2e4b30000000000000000000000000000000000',
      2,
    );
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

describe('custody word', () => {
  test('custody splits into treasuryShares (low) and invested (high)', () => {
    const w = `0x${((5_000_000n << 128n) | 123_000_000n).toString(16).padStart(64, '0')}` as const;
    expect(decodeCustody(w)).toEqual({ treasuryShares: 123_000_000n, invested: 5_000_000n });
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
});

describe('readCurve (NUQuarticLib.Curve storage decode)', () => {
  const POOL = '0x00000000000000000000000000000000000000AA' as const;
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

  test('an uninstalled curve (no code at its pointer) is null', async () => {
    expect(await readCurve(v5('0x'), POOL, 3)).toBeNull();
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
        return word(version.toString(16));
      },
    }) as unknown as Eip1193Provider;

  test('lastGoodCWad: slot 0 uint40 at 1e-9 WAD, bit 216 on v5 and bit 192 on v10; never observed reads 0', async () => {
    // v5 slot 0 = lastGoodCWad9 (970_000_000) << 216 | solvencyArmed << 208 | initialized | base
    const v5 = word(((970_000_000n << 216n) | (1n << 208n) | (1n << 160n) | 0xbbn).toString(16));
    // v10 slot 0 = lastGoodCWad9 << 192 | flowCooldownSecs (60) << 176 | protoSharePct | initialized | base
    const v10 = word(
      ((970_000_000n << 192n) | (60n << 176n) | (10n << 168n) | (1n << 160n) | 0xbbn).toString(16),
    );
    for (const [v, slot0] of [
      [5, v5],
      [12, v10],
    ] as const) {
      expect(await readSolvencyState(providerWith(v, new Map([[0n, slot0]])), POOL)).toEqual({
        lastGoodCWad: 970n * 10n ** 15n,
      });
      expect(await readSolvencyState(providerWith(v, new Map()), POOL)).toEqual({
        lastGoodCWad: 0n,
      });
    }
    // the other layout's offset mis-reads: v10 shift on the v5 word sees the armed bit, not the rate
    expect(await readSolvencyState(providerWith(12, new Map([[0n, v5]])), POOL)).not.toEqual({
      lastGoodCWad: 970n * 10n ** 15n,
    });
    await expect(readSolvencyState(providerWith(4, new Map([[0n, v5]])), POOL)).rejects.toThrow(
      'unsupported storageVersion',
    );
  });

  test('storageVersion is re-read after 30s, so an impl upgrade at the same address is seen', async () => {
    const pool = `0x${'77'.repeat(20)}` as const;
    let version = 5;
    let calls = 0;
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method !== 'eth_call') return word('0');
        calls++;
        return word(version.toString(16));
      },
    } as unknown as Eip1193Provider;
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    try {
      await readSolvencyState(provider, pool);
      await readSolvencyState(provider, pool);
      expect(calls).toBe(1);
      version = 12;
      clock.mockReturnValue(now + 29_000);
      await readSolvencyState(provider, pool);
      expect(calls).toBe(1);
      clock.mockReturnValue(now + 30_000);
      await readSolvencyState(provider, pool);
      expect(calls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  test('readOracleConfig: off Asset slot 2 on v5; retired versions throw', async () => {
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    // oracleBits = lane 5 | INTERNAL | UOA at byte 29; refBandBps 150 | depeg code 3 at byte 30.
    const slot2 = word(((0xc5n << 232n) | ((150n | (3n << 12n)) << 240n)).toString(16));
    const v5 = new Map([[mappingBase(TOKEN, 4n) + 2n, slot2]]);
    expect(await readOracleConfig(providerWith(5, v5), POOL, TOKEN)).toEqual({
      lane: 5,
      mode: 1,
      quoteUnit: 1,
    });
    expect(decodeLegOracle(slot2, 5).refBandBps).toBe(150);
    await expect(readOracleConfig(providerWith(2, v5), POOL, TOKEN)).rejects.toThrow(
      'unsupported storageVersion',
    );
  });
});

describe('layout v5', () => {
  test('slots match the solc layout of dex-evm Pool (skipped without a forge build)', () => {
    const art = new URL('../../../dex-evm/out/Pool.sol/Pool.json', import.meta.url);
    if (!existsSync(art)) return;
    const { storageLayout } = JSON.parse(readFileSync(art, 'utf8'));
    const ps = Object.values<{ members?: { label: string; slot: string }[] }>(
      storageLayout.types,
    ).find((t) => t.members?.some((m) => m.label === 'lpSyms'));
    for (const m of ps?.members ?? []) {
      if (m.label.startsWith('__') || m.label in POOL_STORAGE_V5 === false) continue;
      expect<bigint>(POOL_STORAGE_V5[m.label as keyof typeof POOL_STORAGE_V5]).toBe(BigInt(m.slot));
    }
    expect(POOL_STORAGE_V5.lpTag).toBe(14n);
    expect(POOL_STORAGE_V5.lpSyms).toBe(15n);
    expect([POOL_STORAGE_V5.classHead, POOL_STORAGE_V5.classRisk]).toEqual([16n, 17n]);
  });

  test('store base is the page-aligned keccak256("btr.markstore.p8.v4") - 1', () => {
    const id = BigInt(keccak256(new TextEncoder().encode('btr.markstore.p8.v4')));
    expect<bigint>(MARK_STORE_V10.MS).toBe((id - 1n) & ~127n);
    expect<bigint>(MARK_STORE_V10.MS & 127n).toBe(0n);
    expect([MARK_STORE_V10.AUTH, MARK_STORE_V10.META]).toEqual([0x20n, 0x21n]);
  });

  test('store word vectors match dex-evm MarkWordLib.t.sol and core', () => {
    // wire 2 (R tier at 135)
    const raw2 = '0x000190012c0000b5a4e90a33de16c98190708000100001406b49d21e67bc2234';
    const leg2 = decodeStoreWord(raw2, { internal: false, uoa: true, refBandBps: 100 }, 2);
    expect(leg2.primary.sigmaPbps).toBe(400);
    expect(leg2.primary.obs).toBe(1_800_000_030);
    expect(leg2.ref!.obs).toBe(1_800_000_020);
    expect(leg2.primary.maxDevBps).toBe(50);
    expect([leg2.primary.ttlSecs, leg2.ref!.ttlSecs]).toEqual([3600, 600]);
    // wire 3: core tests/storage.rs `store_word_decodes_the_marks_word_lib_vectors`
    const raw3 = '0x0001900000000000000000000000000190708000100001406b49d21e67bc2234';
    const leg3 = decodeStoreWord(raw3, { internal: false, uoa: true, refBandBps: 750 });
    expect(leg3.ref).toBeNull();
    expect(leg3.primary).toEqual({
      mark1e18: 1_000_099_971_145_400_320n,
      obs: 1_800_000_030,
      sigmaPbps: 400,
      confidenceBps: 2,
      ttlSecs: 3600,
      maxDevBps: 50,
      halted: false,
      internal: false,
      uoa: true,
      refBandBps: 750,
    });
    // a composed leg word carries the depeg code at 234 (3 codes = 750 bps), INTERNAL at 232
    const legWord = `0x${((3n << 234n) | (1n << 232n) | (BigInt(raw3) & ((1n << 232n) - 1n))).toString(16).padStart(64, '0')}`;
    expect(decodeMarkWord(legWord as `0x${string}`).primary).toMatchObject({
      internal: true,
      uoa: false,
      refBandBps: 750,
    });
  });

  test('Asset slot 2 carries the leg oracle wiring: v5 at byte 29 + refBandBps, v10 at byte 27 + flags code', () => {
    const v5 = `0x${((((4n << 12n) | 150n) << 240n) | (BigInt(0x40 | 7) << 232n)).toString(16).padStart(64, '0')}`;
    expect(decodeLegOracle(v5 as `0x${string}`, 5)).toEqual({
      lane: 7,
      internal: true,
      uoa: false,
      refBandBps: 150,
    });
    // v10: oracleBits at byte 27, the depeg code in flags 12..15 (byte 23), covBits above.
    const v10 = `0x${((0xdeadbeefn << 224n) | (BigInt(0x80 | 7) << 216n) | (BigInt((3 << 12) | 0xb0) << 184n)).toString(16).padStart(64, '0')}`;
    expect(decodeLegOracle(v10 as `0x${string}`, 10)).toEqual({
      lane: 7,
      internal: false,
      uoa: true,
      refBandBps: 750,
    });
    // the same word through the v5 struct reads covBits' low byte as the lane: the launch bug
    expect(decodeLegOracle(v10 as `0x${string}`, 5).lane).not.toBe(7);
  });
});

/** P8 words dumped from dex-evm `MarkStoreP8Migrate.t.sol` (`_populate`) at NOW; `W` =
 *  `Pool.fallback`'s answer per lane (one tier). Same fixture as core tests/storage.rs
 *  `p8_fixture` at bbff805cd (store id `btr.markstore.p8.v4`). */
describe('P8 mark store, wire 3 (storageVersion 12)', () => {
  const NOW = 1_790_609_870;
  const CLASSES = `0x${[
    '000000000000000000000000000000000000000000000000000000000a692249',
    '000000000500323fc0000a00647f80002581909600007d03212c0000500323fc',
    '00000000000000000000000000000000000000000000280191fe0000500323fc',
    'b340a27964fe4fd09a521888b3a074561a8e117aec49ff9afef7628d2931572a',
  ].join('')}` as `0x${string}`;
  const P = [
    '0xaaea26c01c002823bc223484000023bc2d931c002823bc22340c03ffe3bc16d6',
    '0xaaea26c01c00282cffcb6afc00282fb1b967fc00282d043c0af800283474bb55',
    '0xaaea26200003ffc00000000003ffc0000000fc03ffc00000001c00002f9131e6',
  ] as const;
  const W = [
    '00000000000000000000000000000001901fe000180000a06aba85b067bc16d6',
    '00000000000000000000000000000001901fe000380000a06aba898867bc2234',
    '00000000000000000000000000000001901fe001400000a06aba89b067bc2d93',
    '00000000000000000000000000000001901fe000380000a06aba898867bc2234',
    '000000000000000000000000000000432012c000000001f46aba898800000000',
    '000000000000000000000000000000032012c000000001f46aba898800000000',
    '000000000000000000000000000000032012c000000001f46aba898800000000',
    '000000000000000000000000000000032012c0003800012c6aba898879ffcb6a',
    '000000000000000000000000000000032012c000380001f46aba89887f9131e6',
    '00000000000000000000000000000001901fe000000000a06aba858800000000',
  ];
  const cls = decodeP8Classes(CLASSES, 3)!;

  test('store words = Pool.fallback + the class σ floor (core p8_store_words_match_the_pool_fallback)', () => {
    for (let l = 0; l < 10; l++) {
      const floor = p8ClassOf(cls, l)[2];
      const want = `0x${floor.toString(16).padStart(6, '0')}${W[l]!.slice(6)}`;
      expect<string>(p8StoreWord(P[l >> 2]!, null, l, cls, NOW)).toBe(want);
    }
    // gates: lane 0 stale past ttl, lane 4 halted, lane 5 markless with its obs, lane 2 conf 40
    const at = (l: number) =>
      decodeStoreWord(p8StoreWord(P[l >> 2]!, null, l, cls, NOW), {
        internal: false,
        uoa: false,
        refBandBps: 0,
      }).primary;
    const m0 = at(0);
    expect(m0.obs + m0.ttlSecs < NOW && m0.mark1e18 > 0n).toBe(true);
    expect(at(4).halted).toBe(true);
    expect([at(5).mark1e18, at(5).confidenceBps]).toEqual([0n, 0]);
    expect(at(2).confidenceBps).toBe(40);
    expect(at(9).mark1e18).toBe(0n);
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
    expect(p8ClassOf(cls, 0)).toEqual([1020, 50, 160]);
    expect(p8ClassOf(cls, 7)).toEqual([600, 100, 300]);
    expect(p8ClassOf(cls, 10)).toEqual([0, 0, 0]);
    expect(p8TierSlot(1, 5)).toBe(MARK_STORE_V10.MS + 1n);
    expect(() => p8TierSlot(2, 5)).toThrow('no R tier');
    expect(decodeP8Classes(`0x${'00'.repeat(128)}`)).toBeNull();
  });

  test('readMarks: v12 pool end-to-end: slot-2 lane -> impl -> classes() -> the one lane word', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const slots = new Map<bigint, string>([
      // v12 packing: oracleBits (lane 7 | UOA) at byte 27, depeg code 2 in flags 12..15 (byte 23)
      [
        mappingBase(TOKEN, POOL_STORAGE_V10.unlisted) + 2n,
        pad(((BigInt(0x80 | 7) << 216n) | (2n << 196n)).toString(16)),
      ],
      [0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn, pad('cc'.repeat(20))],
      [MARK_STORE_V10.MS + 1n, P[1]],
    ]);
    const provider = {
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method === 'eth_call') {
          const { data } = params[0] as { data: string };
          return data === '0x31e77853' ? CLASSES : pad('c');
        }
        return slots.get(BigInt(params[1] as string)) ?? pad('0');
      },
    } as unknown as Eip1193Provider;
    const m = await readMarks(provider, POOL, TOKEN, NOW);
    const want = decodeStoreWord(p8StoreWord(P[1], null, 7, cls, NOW), {
      internal: false,
      uoa: true,
      refBandBps: 500,
    });
    expect(m).toEqual(want);
    expect(m.ref).toBeNull();
    expect(m.primary).toMatchObject({ uoa: true, internal: false, refBandBps: 500, ttlSecs: 600 });
    expect(m.primary.mark1e18 > 0n).toBe(true);
    // the exact W[7] word, floored: lane 7 of P[1]
    expect(p8StoreWord(P[1], null, 7, cls, NOW).slice(8)).toBe(W[7]!.slice(6));
  });

  test('readMarks: classes() reverted or not P8 fails closed', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const at = (classes: () => unknown) =>
      ({
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method !== 'eth_call') return pad('0');
          return (params[0] as { data: string }).data === '0x31e77853' ? classes() : pad('c');
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
    // a revert is not a D2b store (none exist): no one-word-per-lane read of the packed P8 words
    const reverted = Object.assign(new Error('execution reverted'), { code: 3 });
    await expect(
      readMarks(
        at(() => {
          throw reverted;
        }),
        POOL,
        TOKEN,
      ),
    ).rejects.toBe(reverted);
  });
});

/** P8 words dumped from dex-evm `MarkStoreP8Migrate.t.sol` (`_populate` + `_migrate`) at
 *  1_790_005_070; `W` = `Pool.fallback`'s answer per lane. Same fixture as core `p8_fixture`. */
describe('P8 mark store, wire 2 (storageVersion 5..9)', () => {
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
  const cls = decodeP8Classes(CLASSES, 2)!;

  test('store words = Pool.fallback + the class σ floor', () => {
    for (let l = 0; l < 10; l++) {
      const floor = p8ClassOf(cls, l)[2];
      const want = `0x${floor.toString(16).padStart(6, '0')}${W[l]!.slice(6)}`;
      expect<string>(p8StoreWord(P[l >> 2]!, R[l >> 2]!, l, cls, 0, 2)).toBe(want);
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
    expect(p8TierSlot(2, 5, 2)).toBe(MARK_STORE_V5.MS + 17n);
    expect(decodeP8Classes(`0x${'00'.repeat(128)}`, 2)).toBeNull();
  });

  test('readMarks: v5 pool on a P8 impl reads both tier words', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const slots = new Map<bigint, string>([
      [mappingBase(TOKEN, POOL_STORAGE_V5.assets) + 2n, pad((BigInt(7) << 232n).toString(16))],
      [0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn, pad('cc'.repeat(20))],
      [p8TierSlot(1, 7, 2), P[1]],
      [p8TierSlot(2, 7, 2), R[1]],
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
    const want = decodeStoreWord(
      p8StoreWord(P[1], R[1], 7, cls, 0, 2),
      { internal: false, uoa: false, refBandBps: 0 },
      2,
    );
    expect(m).toEqual(want);
    expect(m.primary.mark1e18 > 0n && m.ref!.mark1e18 > 0n).toBe(true);
    expect(m!.primary.ttlSecs).toBe(600);
  });

  test('readMarks: classes() reverted or not P8 fails closed', async () => {
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
    // a revert is not a D2b store (none exist): no one-word-per-lane read of the packed P8 words
    const reverted = Object.assign(new Error('execution reverted'), { code: 3 });
    await expect(
      readMarks(
        at(() => {
          throw reverted;
        }),
        POOL,
        TOKEN,
      ),
    ).rejects.toBe(reverted);
  });

  test('store base is keccak256("btr.markstore") - 1, id is the unversioned one', () => {
    expect<bigint>(MARK_STORE_V5.MS).toBe(
      BigInt('0x8fb4340288f7429bd33c13abd02aa3c2145e859f37a071b10e8e034e391167ea') - 1n,
    );
    expect([MARK_STORE_V5.AUTH, MARK_STORE_V5.META]).toEqual([0x40n, 0x44n]);
    expect(decodeP8Classes(CLASSES, 3)).toBeNull();
  });

  test('wire 3 table under a v5..9 pool, and wire 2 table under v12, are refused', async () => {
    const POOL = `0x${'aa'.repeat(20)}` as `0x${string}`;
    const TOKEN = `0x${'bb'.repeat(20)}` as `0x${string}`;
    const pad = (h: string) => `0x${h.padStart(64, '0')}`;
    const at = (version: string, table: string) =>
      ({
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method !== 'eth_call') return pad('0');
          return (params[0] as { data: string }).data === '0x31e77853' ? table : pad(version);
        },
      }) as unknown as Eip1193Provider;
    const v3Table = `0x${[
      '000000000000000000000000000000000000000000000000000000000a692249',
      '00000000050032e100000a0065c200002581909600007d03212c000050032e10',
      '0000000000000000000000000000000000000000000028019708000050032e10',
      keccak256(new TextEncoder().encode('btr.markstore.p8.v4')).slice(2),
    ].join('')}` as `0x${string}`;
    for (const v of ['5', '9'])
      await expect(readMarks(at(v, v3Table), POOL, TOKEN)).rejects.toThrow('not a P8 table');
    await expect(readMarks(at('c', CLASSES), POOL, TOKEN)).rejects.toThrow('not a P8 table');
    // the retired p8.v3 id (release/pool-v2-rc2) is no wire at all
    const rc2 = `0x${v3Table.slice(2, 2 + 192)}${keccak256(new TextEncoder().encode('btr.markstore.p8.v3')).slice(2)}`;
    await expect(readMarks(at('c', rc2), POOL, TOKEN)).rejects.toThrow('not a P8 table');
  });
});

/**
 * Layout v10 against dex-evm release/pool-v2-rc2 83773c0: the words of core
 * `tests/fixtures/tree_vectors_v10.txt` phase A (`CoreTreeVectorsV10` probe, the 450-swap scene),
 * where the chain's own `recordOf` / `curveAt` (`script/lib/AssetLib.sol`) put the 7 legs at
 * 139..169 and curve 1 at 128. The curve is the same `DEFAULT_CURVE` the v5 recording carried as
 * SSTORE2 code, so the v10 words must decode to that blob exactly.
 */
describe('wire dispatch', () => {
  test('5..9 = wire 2, 12 = wire 3, everything else refused (10 and 11 included)', () => {
    for (const v of [5, 6, 7, 8, 9]) {
      expect(wireOf(v)).toBe(2);
      expect(markStoreOf(v)).toBe(MARK_STORE_V5);
    }
    expect(wireOf(12)).toBe(3);
    expect(markStoreOf(12)).toBe(MARK_STORE_V10);
    for (const v of [0, 1, 2, 3, 4, 10, 11, 13]) expect(() => wireOf(v)).toThrow();
  });
});

describe('layout v10', () => {
  const POOL = '0xF983b09E07bF24f78107b1D71d4bC9B0d8B5699d' as const;
  const LEGS = [
    ['0xA4AD4f68d0b91CFD19687c881e50f3A00242828c', 139n],
    ['0x03A6a84cD762D9707A21605b548aaaB891562aAb', 144n],
    ['0xD6BbDE9174b1CdAa358d2Cf4D57D1a9F7178FBfF', 149n],
    ['0x15cF58144EF33af1e14b5208015d11F9143E27b9', 154n],
    ['0x212224D2F2d262cd093eE13240ca4873fcCBbA3C', 159n],
    ['0x2a07706473244BC757E10F2a9E86fB532828afe3', 164n],
    ['0x3D7Ebc40AF7092E3F1C81F2e996cbA5Cae2090d7', 169n],
  ] as const;
  /** `Asset` slot 2 in the v12 packing (byte offsets of `POOL_STRUCTS.Asset`): index 1e18,
   *  minDisp 1000, curve 1, minFee 1000, vega 701, cap 0xffff, 6 decimals, flags `0xb0 | KNEE_BIT |
   *  depeg code 3`, maxLiabWeight 100, oracleBits lane 1, covBits (c_min 80%, t 1.005, flat 5%,
   *  c_max 1.20, κ⁻ 1536, κ⁺ 640). */
  const at8 = (v: bigint, byte: number) => v << BigInt(8 * byte);
  const USDT_COV = 40n | (10n << 6n) | (1n << 12n) | (3n << 15n) | (38n << 20n) | (33n << 26n);
  const USDT_FLAGS = 0xb0n | 2n | (3n << 12n);
  const USDT_SLOT2 = `0x${(
    at8(10n ** 18n, 0) |
    at8(1000n, 9) |
    at8(1n, 13) |
    at8(1000n, 15) |
    at8(701n, 17) |
    at8(0xffffn, 19) |
    at8(6n, 21) |
    at8(USDT_FLAGS, 23) |
    at8(100n, 25) |
    at8(1n, 27) |
    at8(USDT_COV, 28)
  )
    .toString(16)
    .padStart(64, '0')}`;
  /** `kneeBits`: c_k 84% | κ₂ 640 (code 33). */
  const USDT_KNEE = 42n | (33n << 6n);
  const SLOTS = new Map<bigint, string>([
    [86n, '0x0000000000000000000000a42a07706473244bc757e10f2a9e86fb532828afe3'],
    [94n, '0x00000000000000000000009003a6a84cd762d9707a21605b548aaab891562aab'],
    [95n, '0x00000000000000000000008ba4ad4f68d0b91cfd19687c881e50f3a00242828c'],
    [106n, '0x0000000000000000000000a93d7ebc40af7092e3f1c81f2e996cba5cae2090d7'],
    [108n, '0x00000000000000000000009a15cf58144ef33af1e14b5208015d11f9143e27b9'],
    [111n, '0x00000000000000000000009f212224d2f2d262cd093ee13240ca4873fccbba3c'],
    [114n, '0x000000000000000000000095d6bbde9174b1cdaa358d2cf4d57d1a9f7178fbff'],
    [115n, '0x0000000000000000000000000000000000000000000000000080000100000000'],
    [128n, '0x0003e813880000000000000000000000000000000000001f4017700fa007d005'],
    [129n, '0x0000003081a26359ffffffa8b0421a00000000746a528800ffffff8b95ad7800'],
    [130n, '0x000000000000000000000000000000000000000000000000fffffff4ae8d4f36'],
    [131n, '0x000000033bd7a037fffffff64c791f560000002a09f322e3ffffffcde071cc8f'],
    [132n, '0x0000000000000000fffffffffffffffffffda2eef260ee34ffffffff98850bfa'],
    [133n, '0x000000019debd01cfffffffd931e47d60000001eb880721cfffffff10b3abaf9'],
    [134n, '0x0000000000000000fffffffffffffffffffcabfaf5a339730000000000000000'],
    [135n, '0x000000019debd01d000000026ce1b82a0000001eb880721c0000000ef4c54507'],
    [136n, '0x0000000000000000fffffffffffffffffffcabfaf5a3397300000000677af407'],
    [137n, '0x000000033bd7a03f00000009b386e0aa0000002a09f322e3000000321f8e3371'],
    [138n, '0x0000000000000000fffffffffffffffffffda2eef260ee770000000b5172b0c3'],
    // USDT0's record: Asset 0..3 (3 = kneeBits), Custody (+4), ClassHead (+5: USD, famRow)
    [144n, '0x000000000000000000000274a48a7800000000000000000000000246139ca800'],
    [145n, '0x000000000000000000000000a4ad4f68d0b91cfd19687c881e50f3a00242828c'],
    [146n, USDT_SLOT2],
    [147n, `0x${USDT_KNEE.toString(16).padStart(64, '0')}`],
    [148n, '0x0000000000000000000000000000000000000000000000000000000000000001'],
    [149n, '0x00000000000000000000000000000000000000fa050014000000000000000001'],
  ]);
  const V5_BLOB =
    '0x000003e813880000000000000000000000000000000000001f4017700fa007d0050000003081a26359ffffffa8b0421a00000000746a528800ffffff8b95ad7800000000000000000000000000000000000000000000000000fffffff4ae8d4f36000000033bd7a037fffffff64c791f560000002a09f322e3ffffffcde071cc8f0000000000000000fffffffffffffffffffda2eef260ee34ffffffff98850bfa000000019debd01cfffffffd931e47d60000001eb880721cfffffff10b3abaf90000000000000000fffffffffffffffffffcabfaf5a339730000000000000000000000019debd01d000000026ce1b82a0000001eb880721c0000000ef4c545070000000000000000fffffffffffffffffffcabfaf5a3397300000000677af407000000033bd7a03f00000009b386e0aa0000002a09f322e3000000321f8e33710000000000000000fffffffffffffffffffda2eef260ee770000000b5172b0c3';
  const ZERO = `0x${'0'.repeat(64)}`;
  const at = (version: number, slots = SLOTS): Eip1193Provider =>
    ({
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method === 'eth_call') return `0x${version.toString(16).padStart(64, '0')}`;
        if (method === 'eth_getCode') return V5_BLOB;
        return slots.get(BigInt(params[1] as string)) ?? ZERO;
      },
    }) as unknown as Eip1193Provider;
  const words = (from: bigint, n: number) =>
    Array.from({ length: n }, (_, i) => BigInt(SLOTS.get(from + BigInt(i)) ?? ZERO));

  test('dispatch is exact: 5..9 = v5, 12 = v10; 10, 11 and everything else throw', async () => {
    for (const v of [5, 6, 7, 8, 9]) expect(layoutOf(v)).toBe(5);
    expect(layoutOf(12)).toBe(10);
    expect(poolStorageOf(12)).toBe(POOL_STORAGE_V10);
    for (const v of [0, 1, 2, 3, 4, 10, 11, 13])
      expect(() => layoutOf(v)).toThrow('unsupported storageVersion');
    const pool = `0x${'cc'.repeat(20)}` as `0x${string}`;
    await expect(readCurve(at(10), pool, 1)).rejects.toThrow('unsupported storageVersion');
    await expect(readMarks(at(11), pool, LEGS[0][0])).rejects.toThrow('unsupported storageVersion');
  });

  test('a v2 pool (storageVersion 12) decodes its records through layoutOf', async () => {
    const usdt = LEGS[1][0];
    expect(layoutOf(12)).toBe(10);
    expect(await readCustody(at(12), POOL, usdt)).toEqual({ treasuryShares: 1n, invested: 0n });
    expect(await readOracleConfig(at(12), POOL, usdt)).toEqual({ lane: 1, mode: 0, quoteUnit: 0 });
  });

  test('a v12 asset end-to-end: oracle, cov and knee bits off their v12 lanes', async () => {
    const usdt = LEGS[1][0];
    expect(decodeLegOracle(USDT_SLOT2 as `0x${string}`, 10)).toEqual({
      lane: 1,
      internal: false,
      uoa: false,
      refBandBps: 750,
    });
    expect(await readLegCov(at(12), POOL, usdt)).toEqual({
      cMinBps: 8000,
      targetBps: 10_050,
      flatBps: 500,
      cMaxBps: 12_000,
      kappaNegBps: 1536,
      kappaPosBps: 640,
      kneeCovBps: 8400,
      kappaKneeBps: 640,
      flags: Number(USDT_FLAGS),
    });
    // KNEE_BIT off: the knee word is not read
    const noKnee = new Map(SLOTS);
    noKnee.set(146n, `0x${(BigInt(USDT_SLOT2) & ~at8(2n, 23)).toString(16).padStart(64, '0')}`);
    expect(await readLegCov(at(12, noKnee), POOL, usdt)).toMatchObject({
      kneeCovBps: 0,
      kappaKneeBps: 0,
      flags: Number(USDT_FLAGS) & ~2,
    });
    // the v5 struct has no law terms
    await expect(readLegCov(at(5), POOL, usdt)).rejects.toThrow('no covBits');
    // the pre-fix reader (v5 packing, byte 29) would have read a covBits byte as the lane
    expect(decodeLegOracle(USDT_SLOT2 as `0x${string}`, 5).lane).toBe(
      Number((USDT_COV >> 8n) & 63n),
    );
  });

  test('slots match dex-evm Pool storageLayout and PoolConstantsLib (pinned by hand)', () => {
    expect([POOL_STORAGE_V10.unlisted, POOL_STORAGE_V10.classRisk]).toEqual([4n, 17n]);
    expect([POOL_STORAGE_V10.swapGate, POOL_STORAGE_V10.areaTop]).toEqual([18n, 82n]);
    expect([POOL_STORAGE_V10.legIndex, POOL_STORAGE_V10.curveIndex]).toEqual([83n, 115n]);
    expect(POOL_AREA_V10.AREA_BASE).toBe(128n);
    expect(POOL_AREA_V10.IMPL_COPY).toBe(127n);
    expect([POOL_AREA_V10.RECORD_CUSTODY, POOL_AREA_V10.RECORD_CLASS_HEAD]).toEqual([4n, 5n]);
    expect(POOL_AREA_V10.RECORD_SLOTS).toBe(6n);
    expect(POOL_AREA_V10.RECORD_KNEE).toBe(3n);
    expect('flashFeePbps' in POOL_STORAGE_V10 || 'solvencyArmed' in POOL_STORAGE_V10).toBe(false);
    expect([POOL_AREA_V10.LEG_MAX, POOL_AREA_V10.CURVE_MAX]).toEqual([24, 48]);
    expect(POOL_STORAGE_V10.legIndex + BigInt(POOL_AREA_V10.LEG_INDEX_SLOTS)).toBe(
      POOL_STORAGE_V10.curveIndex,
    );
    expect(POOL_STORAGE_V10.swapGate + BigInt(POOL_AREA_V10.SWAP_GATE_SLOTS)).toBe(82n);
    expect('assets' in POOL_STORAGE_V10 || 'custody' in POOL_STORAGE_V10).toBe(false);
  });

  test('slots match the solc layout of a sibling dex-evm v10 build (skipped without one)', () => {
    const art = new URL('../../../dex-evm/out/Pool.sol/Pool.json', import.meta.url);
    if (!existsSync(art)) return;
    const { storageLayout } = JSON.parse(readFileSync(art, 'utf8'));
    const ps = Object.values<{ members?: { label: string; slot: string; offset: number }[] }>(
      storageLayout.types,
    ).find((t) => t.members?.some((m) => m.label === 'lpSyms'));
    if (!ps?.members?.some((m) => m.label === 'legIndex')) return; // a pre-v10 build
    const live = ps.members.filter((m) => !m.label.startsWith('__'));
    expect(Object.fromEntries(live.map((m) => [m.label, BigInt(m.slot)]))).toEqual({
      ...POOL_STORAGE_V10,
    });
    const meta = Object.fromEntries(
      live.filter((m) => m.slot === '82').map((m) => [m.label, m.offset]),
    );
    expect(meta).toEqual(POOL_AREA_V10.META_OFFSETS);
  });

  test('recordSlot / curveSlot resolve the chain fixture as recordOf / curveAt did', () => {
    const legIndex = words(83n, 32);
    for (const [t, r] of LEGS) expect(recordSlot(legIndex, t)).toBe(r);
    expect(recordSlot(legIndex, `0x${'11'.repeat(20)}`)).toBeNull();
    const curveIndex = words(115n, 8);
    expect(curveSlot(curveIndex, 1)).toBe(128n);
    expect(curveSlot(curveIndex, 2)).toBeNull();
    expect(curveSlot(curveIndex, 65)).toBeNull(); // lane 1 holds curve 1, lane 2 empty
  });

  test('probes wrap and stop at an empty entry', () => {
    const e = (low: number, k: number, r: bigint) =>
      (r << 160n) | (BigInt(k) << 152n) | BigInt(low);
    const ix = Array<bigint>(32).fill(0n);
    ix[31] = e(31, 1, 128n);
    ix[0] = e(31, 2, 133n);
    const tok = (k: number) => `0x${k.toString(16).padStart(2, '0')}${'00'.repeat(18)}1f` as const;
    expect(recordSlot(ix, tok(1))).toBe(128n);
    expect(recordSlot(ix, tok(2))).toBe(133n);
    expect(recordSlot(ix, tok(3))).toBeNull();
    const lanes = Array<bigint>(8).fill(0n);
    lanes[7] |= (63n | (200n << 16n)) << 224n; // lane 63: curve 63
    lanes[0] |= 127n | (300n << 16n); // curve 127 = 63 mod 64: wraps to lane 0
    expect(curveSlot(lanes, 63)).toBe(200n);
    expect(curveSlot(lanes, 127)).toBe(300n);
    expect(curveSlot(lanes, 191)).toBeNull();
  });

  test('readCurve: the area words decode to the v5 blob of the same curve, no eth_getCode', async () => {
    const v10 = await readCurve(
      {
        request: async ({ method, params }: { method: string; params: unknown[] }) => {
          if (method === 'eth_getCode') throw new Error('v10 reads no code');
          return at(12).request({ method, params } as never);
        },
      } as unknown as Eip1193Provider,
      POOL,
      1,
    );
    expect(v10).not.toBeNull();
    expect(v10).toEqual(await readCurve(at(5), `0x${'dd'.repeat(20)}`, 1));
    expect(await readCurve(at(12), POOL, 2)).toBeNull();
  });

  test('records: Asset slot 2, Custody +4, ClassHead +5 with famRow', async () => {
    const usdt = LEGS[1][0];
    expect(await readOracleConfig(at(12), POOL, usdt)).toEqual({ lane: 1, mode: 0, quoteUnit: 0 });
    expect(await readCustody(at(12), POOL, usdt)).toEqual({ treasuryShares: 1n, invested: 0n });
    const head = await readClassHead(at(12), POOL, usdt);
    expect(head).toEqual({ family: 1, row: 0n, famRow: 20n | (20n << 14n) | (500n << 23n) });
    expect(decodeClassHead(BigInt(SLOTS.get(149n)!))).toEqual(head);
    // an unlisted token falls back to `unlisted` at keccak(t, 4), its ClassHead at +5
    const t = `0x${'11'.repeat(20)}` as const;
    const u = mappingBase(t, 4n);
    const slots = new Map(SLOTS);
    slots.set(u + 5n, `0x${(3n | (7n << 8n)).toString(16).padStart(64, '0')}`);
    expect(await readClassHead(at(12, slots), POOL, t)).toEqual({ family: 3, row: 7n, famRow: 0n });
  });
});

describe('swapGate membership (v10 Pool.swapGate, not AccessControl perms)', () => {
  const A = `0x${'00'.repeat(19)}05` as `0x${string}`; // home index 5
  const B = `0x${'00'.repeat(19)}45` as `0x${string}`; // 0x45 % 64 = 5: collides with A
  const ZERO = `0x${'00'.repeat(20)}` as `0x${string}`;
  const table = (m: Record<number, `0x${string}`>) => async (i: number) => m[i] ?? ZERO;
  test('home hit, collision probe, miss at the first empty slot', async () => {
    expect(await swapGateAdmits(table({ 5: A, 6: B }), A)).toBe(true);
    expect(await swapGateAdmits(table({ 5: A, 6: B }), B)).toBe(true);
    expect(await swapGateAdmits(table({ 5: A }), B)).toBe(false);
    expect(await swapGateAdmits(table({}), A)).toBe(false);
  });
  test('probe wraps past the last slot', async () => {
    const C = `0x${'00'.repeat(19)}3f` as `0x${string}`; // 63
    const D = `0x${'00'.repeat(19)}7f` as `0x${string}`; // 127 % 64 = 63
    expect(await swapGateAdmits(table({ 63: C, 0: D }), D)).toBe(true);
  });
});
