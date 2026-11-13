import { describe, expect, test } from 'bun:test';
import { GAS_LIMIT_CAP, gasWithBuffer } from './gas.js';

describe('gasWithBuffer', () => {
  test('a 1.25 buffer over the estimate, rounded up', () => {
    expect(gasWithBuffer(780_023n)).toBe(975_029n); // 975,028.75 -> 975,029
    expect(gasWithBuffer(800_000n)).toBe(1_000_000n);
    expect(gasWithBuffer(1n)).toBe(2n); // 1.25 -> 2
  });

  test('zero stays zero', () => {
    expect(gasWithBuffer(0n)).toBe(0n);
  });

  test('the buffer is clamped to the cap, never the estimate', () => {
    expect(gasWithBuffer(13_421_000n)).toBe(16_776_250n); // buffer under the cap, not clipped
    expect(gasWithBuffer(13_422_000n)).toBe(GAS_LIMIT_CAP); // 16,777,500 -> clipped to the cap
    expect(gasWithBuffer(GAS_LIMIT_CAP)).toBe(GAS_LIMIT_CAP); // estimate == cap: limit == cap, not below
  });

  test('an estimate above the cap throws, it is never clamped below the estimate', () => {
    expect(() => gasWithBuffer(GAS_LIMIT_CAP + 1n)).toThrow(RangeError);
    expect(() => gasWithBuffer(20_000_000n)).toThrow(/exceeds the cap/);
  });

  test('a factor that is not finite or below 1 throws', () => {
    expect(() => gasWithBuffer(100n, 0.9)).toThrow(RangeError);
    expect(() => gasWithBuffer(100n, Number.NaN)).toThrow(RangeError);
    expect(() => gasWithBuffer(100n, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(gasWithBuffer(100n, 1)).toBe(100n);
  });

  test('factor and cap are overridable', () => {
    expect(gasWithBuffer(100n, 1.5)).toBe(150n);
    expect(gasWithBuffer(100n, 2, 150n)).toBe(150n);
  });
});
