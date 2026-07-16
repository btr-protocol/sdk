/**
 * Unit tests for PoolStorage slot packing (no RPC). Mirrors Solidity tight packing:
 * LSB-aligned fields within a 32-byte word.
 */
import { describe, expect, test } from 'bun:test';
import { POOL_STORAGE, addressAt, i8At, mappingBase, u16At, u32At, u8At } from './storage';

test('PoolStorage absolute slots match the compact predeploy layout', () => {
  expect(POOL_STORAGE).toEqual({
    baseToken: 0n,
    wnative: 1n,
    bridge: 2n,
    treasuryInitialized: 3n,
    assets: 4n,
    oracleConfigs: 5n,
    riskConfigs: 6n,
    profiles: 7n,
    lpBalances: 8n,
    protocolFees: 9n,
    feeParams: 10n,
    flowCooldownSeconds: 11n,
    lastDepositTime: 12n,
    lastLPStakeTime: 13n,
    factory: 14n,
    assetHooks: 15n,
    invested: 16n,
  });
});

describe('storage word packing (LSB-aligned)', () => {
  // Word with uint16=0x1234 at offset 0, uint16=0xABCD at offset 2, uint32=0xDEADBEEF at offset 6
  // Built from the right: ... | DEADBEEF | ABCD | 1234
  const word =
    ('0x' +
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
});
