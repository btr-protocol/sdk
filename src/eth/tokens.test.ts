import { describe, expect, test } from 'bun:test';
import {
  TOKENS,
  canonicalTokenSymbol,
  getTokenAddress,
  resolveTokenAlias,
  tokenMatchesSearch,
} from './tokens';

describe('resolveTokenAlias', () => {
  test.each([
    ['WETH', 'ETH'],
    ['weth', 'ETH'],
    ['ETH', 'ETH'],
    ['WBTC', 'BTC'],
    ['CBBTC', 'BTC'],
    ['cbBTC', 'BTC'],
    ['BTC', 'BTC'],
    ['USDC', 'USDC'],
    // Faucet mocks carry `.b` in their ERC-20 name()/symbol() and nowhere else.
    ['USDT.b', 'USDT'],
    ['WETH.b', 'ETH'],
    ['usdc.b', 'USDC'],
  ])('%s resolves to %s', (input, expected) => {
    expect(resolveTokenAlias(input)).toBe(expected);
  });

  // Every wrapper must unwrap, whatever its registry key's casing. 18 of the 58 keys are mixed
  // case (stETH, wstETH, cbETH, rETH, ezETH, crvUSD, …); the old `TOKENS[symbol.toUpperCase()]`
  // lookup missed all of them, so no LST ever unwrapped and the `|| symbolUpper` fallback
  // reported each miss as a canonical answer.
  test('every wrapper resolves to the asset it wraps, at any casing', () => {
    const wrappers = Object.entries(TOKENS).filter(([, t]) => t.wrapperOf);
    expect(wrappers.length).toBeGreaterThan(0);
    const mixedCase = wrappers.filter(([s]) => s !== s.toUpperCase());
    expect(mixedCase.length).toBeGreaterThan(0); // the regression this test exists for
    for (const [symbol, token] of wrappers) {
      expect(resolveTokenAlias(symbol), symbol).toBe(token.wrapperOf as string);
      expect(resolveTokenAlias(symbol.toUpperCase()), symbol).toBe(token.wrapperOf as string);
      expect(resolveTokenAlias(`${symbol}.b`), symbol).toBe(token.wrapperOf as string);
    }
  });

  // The whole point of dropping `|| symbolUpper`: a miss must be a miss. `USDT.b` used to come
  // back as `USDT.B`, indistinguishable from a canonical answer, and a `.` in a key is a Foundry
  // JSONPath separator: `parseJsonAddress(sot, ".USDT.b")` reads `{"USDT":{"b":…}}` as absent.
  test('an unregistered symbol resolves to null, never to a plausible guess', () => {
    for (const unknown of ['NOTATOKEN', 'usdt.c', 'ETH.b.b', '']) {
      expect(resolveTokenAlias(unknown), unknown).toBeNull();
    }
  });

  // Blanket punctuation-stripping would fold `USDT.b` onto `USDTB`: Ethena USDtb, a DIFFERENT
  // asset listed beside USDT on the same stable core. Only the trailing faucet suffix may drop.
  test('the .b suffix never collides two distinct tokens', () => {
    expect(canonicalTokenSymbol('USDT.b')).toBe('USDT');
    expect(canonicalTokenSymbol('USDTB.b')).toBe('USDTB');
    expect(canonicalTokenSymbol('USDT.b')).not.toBe(canonicalTokenSymbol('USDTB.b'));
  });

  test('address lookup follows the same normalisation', () => {
    const weth = getTokenAddress('WETH', 1);
    expect(weth).toBeDefined();
    expect(getTokenAddress('weth', 1)).toBe(weth as string);
    expect(getTokenAddress('WETH.b', 1)).toBe(weth as string);
  });

  // On BNB Chain the gas token has no ERC-20 address: 0xbb4C..095c is WBNB, and 0x2170..33F8 is
  // Binance-peg ETH, not the chain's wrapped native. Neither may resolve as BNB or WETH there.
  test('chain 56 resolves no address for native BNB or WETH', () => {
    expect(getTokenAddress('BNB', 56)).toBeUndefined();
    expect(getTokenAddress('WETH', 56)).toBeUndefined();
    expect(getTokenAddress('WBNB', 56)).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
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
