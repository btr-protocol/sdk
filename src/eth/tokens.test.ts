import { describe, expect, test } from 'bun:test';
import { TOKENS, resolveTokenAlias, tokenMatchesSearch } from './tokens';

describe('resolveTokenAlias', () => {
  test.each([
    ['WETH', 'ETH'],
    ['weth', 'ETH'],
    ['ETH', 'ETH'],
    ['WBTC', 'BTC'],
    ['CBBTC', 'BTC'],
    ['BTC', 'BTC'],
    ['USDC', 'USDC'],
  ])('%s resolves to %s', (input, expected) => {
    expect(resolveTokenAlias(input)).toBe(expected);
  });

  // Lookup is `TOKENS[symbol.toUpperCase()]`, so only wrappers whose registry key
  // is already uppercase can resolve. 18 of 58 keys are mixed case (stETH, wstETH,
  // cbETH, rETH, ezETH, …) and every one of them fails to unwrap.
  test('uppercase-keyed wrappers resolve to the asset they wrap', () => {
    const wrappers = Object.entries(TOKENS).filter(
      ([symbol, t]) => t.wrapperOf && symbol === symbol.toUpperCase(),
    );
    expect(wrappers.length).toBeGreaterThan(0);
    for (const [symbol, token] of wrappers) {
      expect(resolveTokenAlias(symbol)).toBe(token.wrapperOf as string);
    }
  });
});

describe('tokenMatchesSearch', () => {
  // A wrapper's ticker must surface the underlying: a user typing stETH wants ETH.
  test.each([
    ['ETH', 'eth', true],
    ['ETH', 'weth', true],
    ['ETH', 'steth', true],
    ['BTC', 'btc', true],
    ['BTC', 'wbtc', true],
    ['BTC', 'cbbtc', true],
    ['BTC', 'tbtc', true],
    ['USDC', 'usdc', true],
    ['USDC', 'weth', false],
    ['ETH', 'btc', false],
  ])('%s matches %s -> %s', (symbol, search, expected) => {
    expect(tokenMatchesSearch(symbol, search)).toBe(expected);
  });
});
