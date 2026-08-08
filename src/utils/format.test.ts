// bun test — numeric display formatting.
import { expect, test, describe } from 'bun:test';
import { formatNumber, formatPercentSig, formatPrice } from './format';

// A bare /\.?0+$/ strip on a toFixed(0) string has no decimal point to anchor on,
// so it eats integer zeros: 19.8% rendered as "2%" on price impact and LP fee.
describe('trailing-zero strip never eats integer digits', () => {
  test.each([
    [10, '10%'],
    [10.4, '10%'],
    [19.8, '20%'],
    [20, '20%'],
    [50, '50%'],
    [100, '100%'],
    [110, '110%'],
    [300, '300%'],
    [-19.8, '-20%'],
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
test('sub-unit percents keep significant figures', () => {
  expect(formatPercentSig(0.024)).toBe('0.024%');
  expect(formatPercentSig(1.23)).toBe('1.2%');
  expect(formatPercentSig(5.5)).toBe('5.5%');
  expect(formatPercentSig(0)).toBe('0%');
});

test('formatNumber keeps grouping and trims only fractional zeros', () => {
  expect(formatNumber(1500.7, 0)).toBe('1,501');
  expect(formatNumber(1.5)).toBe('1.5');
  expect(formatNumber(2.0)).toBe('2');
  expect(formatNumber(0)).toBe('0');
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
