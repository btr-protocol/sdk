import { describe, expect, test } from 'bun:test';
import { decodeCovBits, decodeKneeBits, kappaBps } from './cov';

describe('cov codec mirrors CovLib.sol / core cov.rs', () => {
  test('kappaBps: exact below 4, then 4 steps per octave up to 20480', () => {
    expect([0, 1, 2, 3].map(kappaBps)).toEqual([0, 1, 2, 3]);
    expect([4, 5, 6, 7].map(kappaBps)).toEqual([4, 5, 6, 7]);
    expect([8, 9, 10, 11].map(kappaBps)).toEqual([8, 10, 12, 14]);
    expect(kappaBps(33)).toBe(640);
    expect(kappaBps(38)).toBe(1536);
    expect(kappaBps(53)).toBe(20_480);
  });

  test('covBits lanes: c_min 0..5 | t 6..11 | flat 12..14 | c_max 15..19 | κ⁻ 20..25 | κ⁺ 26..31', () => {
    const bits = 40 | (10 << 6) | (1 << 12) | (3 << 15) | (38 << 20) | (33 << 26);
    expect(decodeCovBits(bits)).toEqual({
      cMinBps: 8000,
      targetBps: 10_050,
      flatBps: 500,
      cMaxBps: 12_000,
      kappaNegBps: 1536,
      kappaPosBps: 640,
    });
    // the top lane is unsigned: a set bit 31 is κ⁺ code ≥ 32, not a sign
    expect(decodeCovBits(53 << 26).kappaPosBps).toBe(20_480);
    expect(decodeCovBits(0)).toEqual({
      cMinBps: 0,
      targetBps: 10_000,
      flatBps: 0,
      cMaxBps: 10_500,
      kappaNegBps: 0,
      kappaPosBps: 0,
    });
  });

  test('kneeBits: c_k 0..5 | κ₂ 6..11; 0 = no knee', () => {
    expect(decodeKneeBits(42 | (33 << 6))).toEqual({ kneeCovBps: 8400, kappaKneeBps: 640 });
    expect(decodeKneeBits(0)).toEqual({ kneeCovBps: 0, kappaKneeBps: 0 });
  });
});
