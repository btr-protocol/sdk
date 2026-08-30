// bun test: numeric display formatting.
import { describe, expect, test } from 'bun:test';
import {
  formatNumber,
  formatPercentSig,
  formatPrice,
  formatYield,
  subscriptZeros,
  toInputValue,
} from './format';

// App-wide percent law: THREE significant digits at every magnitude, trailing zeros trimmed.
// Exactly zero renders unsigned "0.00%"; a bare "0%" is never emitted.
describe('formatPercentSig keeps three significant figures at every magnitude', () => {
  test.each([
    [10, '10%'],
    [10.4, '10.4%'],
    [19.8, '19.8%'],
    [20, '20%'],
    [50, '50%'],
    [100, '100%'],
    [110, '110%'],
    [300, '300%'],
    [281, '281%'],
    [14.8, '14.8%'],
    [-19.8, '-19.8%'],
  ])('formatPercentSig(%p) = %p', (input, want) => {
    expect(formatPercentSig(input)).toBe(want);
  });

  test.each([
    [20.3, '20'],
    [19.8, '20'],
    [-30.4, '-30'],
    [100.2, '100'],
  ])('formatNumber(%p, 0) = %p', (input, want) => {
    expect(formatNumber(input, 0)).toBe(want);
  });
});

// Small values are the reason the strip exists: they must keep their precision.
test('sub-unit percents fold long leading-zero runs into the subscript form', () => {
  expect(formatPercentSig(0.000000002)).toBe('0.0₈2%');
  expect(formatPercentSig(-0.000000002)).toBe('-0.0₈2%');
  expect(formatPercentSig(0.0001)).toBe('0.0₃1%');
  expect(formatPercentSig(0.0000123)).toBe('0.0₄123%');
  // Two zeros stay plain: the run is short enough to read.
  expect(formatPercentSig(0.024)).toBe('0.024%');
});

test('sub-unit percents keep three significant figures', () => {
  expect(formatPercentSig(0.42)).toBe('0.42%');
  expect(formatPercentSig(0.0412)).toBe('0.0412%');
  expect(formatPercentSig(1.23)).toBe('1.23%');
  expect(formatPercentSig(5.5)).toBe('5.5%');
  // Exactly zero: unsigned 0.00%, never a fabricated value for missing input upstream.
  expect(formatPercentSig(0)).toBe('0.00%');
});

test('formatNumber keeps grouping and at least two fraction digits', () => {
  expect(formatNumber(1500.7, 0)).toBe('1,501');
  expect(formatNumber(1.5)).toBe('1.50');
  expect(formatNumber(2.0)).toBe('2.00');
  expect(formatNumber(10)).toBe('10.00');
  expect(formatNumber(2000)).toBe('2,000.00');
  expect(formatNumber(0)).toBe('0.00');
});

// A 1e-5 ladder printed at the default 4 decimals collapsed eight consecutive ask rows
// onto the same string: the book has to render at its own tick, not a fixed one.
describe('formatPrice honours the ladder step', () => {
  test('step 1e-5 resolves rows the default 4-decimal path collapses', () => {
    const rows = [1.00001, 1.00002, 1.00003];
    expect(new Set(rows.map((r) => formatPrice(r))).size).toBe(1);
    expect(new Set(rows.map((r) => formatPrice(r, 1e-5))).size).toBe(3);
    expect(formatPrice(1.00002, 1e-5)).toBe('1.00002');
  });
  test('coarse step trims decimals; grouping survives', () => {
    expect(formatPrice(1.23456, 0.01)).toBe('1.23');
    expect(formatPrice(64321.5, 1)).toBe('64,322');
    expect(formatPrice(1.5, 0)).toBe('1.5000'); // step<=0 → default path
  });
});

// The subscript threshold. Sub-1e-4 prices used to run out to a wall of zeros and then, below
// 1e-8, switch notation entirely mid-column.
describe('formatPrice collapses long zero runs', () => {
  test('threshold: two zeros stay plain, three collapse', () => {
    expect(formatPrice(0.01)).toBe('0.01');
    expect(formatPrice(0.001)).toBe('0.001');
    expect(formatPrice(0.00123)).toBe('0.00123');
    expect(formatPrice(0.0001)).toBe('0.0₃1');
    expect(formatPrice(0.000999)).toBe('0.0₃999'); // 3 zeros, so it collapses like any other
  });

  // "0.0" is a literal prefix and the subscript is the FULL zero count, so the string reads back
  // as 0. + n zeros + the digits. A decade down adds exactly one to the count.
  test.each([
    [1e-4, '0.0₃1'],
    [1e-5, '0.0₄1'],
    [1e-6, '0.0₅1'],
    [1e-7, '0.0₆1'],
    [1e-8, '0.0₇1'],
    [1e-9, '0.0₈1'],
    [1e-10, '0.0₉1'],
    [1e-11, '0.0₁₀1'], // two-digit counts subscript both digits
  ])('formatPrice(%p) = %p', (input, want) => {
    expect(formatPrice(input)).toBe(want);
  });

  test('five significant digits survive the collapse, sign included', () => {
    expect(formatPrice(0.000012345)).toBe('0.0₄12345');
    expect(formatPrice(-0.0000123)).toBe('-0.0₄123');
    expect(formatPrice(9.87e-6)).toBe('0.0₅987');
  });

  // Every decade below 1e-8 used to change notation: "0.000000012" then "9.90e-9".
  test('no exponential escape in the traded range', () => {
    for (const n of [1e-5, 1e-8, 1e-9, 1e-12, 1.234e-21]) {
      expect(formatPrice(n)).not.toContain('e');
    }
  });

  test('zero and the step path are untouched', () => {
    expect(formatPrice(0)).toBe('0.00');
    expect(subscriptZeros('0.0000')).toBe('0.0000'); // no significant digit to prefix
    expect(formatPrice(0.00001234, 1e-8)).toBe('0.00001234'); // step path stays ASCII
  });
});

// Display only. An amount field strips everything outside [0-9.], so a subscript that reached one
// would silently divide the value by a power of ten.
test('toInputValue stays plain ASCII and parses back', () => {
  for (const n of [111.73, 1234.5, 1e-4, 1e-7, 0.000012345]) {
    const s = toInputValue(n);
    expect(s).not.toMatch(/[^0-9.-]/);
    expect(parseFloat(s)).toBeCloseTo(n, 15);
  }
  expect(toInputValue(null)).toBe('');
});

// Yields: three significant figures at EVERY magnitude (the owner's app-wide percent law).
// A yield off a finite fee sample still rounds to three figures - 2222 → "2220%", never four
// digits of false accuracy - but small rates keep their digits instead of collapsing to "0%":
// that step down to 2sf below 1% is what once printed a real hook rate as a bare zero.
describe('formatYield rounds to significant figures', () => {
  test.each([
    [2222, '2220%'],
    [17.456, '17.5%'],
    [0.0987, '0.0987%'],
    [3.68, '3.68%'],
    [12, '12%'],
    [100, '100%'],
    [0.5, '0.5%'],
    [0.00012, '0.0₃12%'], // ≥3 leading zeros fold, same as prices
    [-4.55, '-4.55%'],
    [0, '0.00%'],
  ])('formatYield(%p) = %p', (input, want) => {
    expect(formatYield(input)).toBe(want);
  });

  test('three significant digits survive at every magnitude', () => {
    expect(formatYield(1.234)).toBe('1.23%');
    expect(formatYield(0.1234)).toBe('0.123%');
    expect(formatYield(0.01234)).toBe('0.0123%');
  });

  test('null and non-finite never invent a zero', () => {
    expect(formatYield(null)).toBe('—');
    expect(formatYield(undefined)).toBe('—');
    expect(formatYield(NaN)).toBe('—');
  });
});
