// bun test — numeric display formatting.
import { expect, test, describe } from 'bun:test';
import { formatNumber, formatPercentSig } from './format';

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
