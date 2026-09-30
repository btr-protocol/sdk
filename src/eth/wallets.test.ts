import { describe, expect, it } from 'bun:test';
import { WALLETS, browseLink, wcLinks } from './wallets';

const WC = 'wc:abc@2?relay-protocol=irn&symKey=k';
const enc = encodeURIComponent(WC);
const w = (id: string) => {
  const def = WALLETS.find((x) => x.id === id);
  if (!def) throw new Error(id);
  return def;
};

describe('wcLinks', () => {
  it('orders native scheme, universal link, bare uri', () => {
    expect(wcLinks(w('metamask'), WC)).toEqual([
      `metamask://wc?uri=${enc}`,
      `https://metamask.app.link/wc?uri=${enc}`,
      WC,
    ]);
  });
  it('skips what a wallet lacks', () => {
    expect(wcLinks(w('rabby'), WC)).toEqual([`rabby://wc?uri=${enc}`, WC]);
    expect(wcLinks(w('binance'), WC)).toEqual([WC]);
  });
});

describe('browseLink', () => {
  it('fills url and origin, encoded', () => {
    const page = 'https://btr.markets/swap?a=1';
    expect(browseLink(w('phantom'), page)).toBe(
      `https://phantom.app/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent('https://btr.markets')}`,
    );
    expect(browseLink(w('base'), page)).toBe(`cbwallet://miniapp?url=${encodeURIComponent(page)}`);
  });
  it('is undefined for a wallet that pairs over WalletConnect', () => {
    expect(browseLink(w('metamask'), 'https://btr.markets')).toBeUndefined();
  });
});

describe('catalog', () => {
  it('has a Play package on every launchable row and none without a launch path', () => {
    for (const d of WALLETS)
      if (d.scheme || d.universal || d.browse) expect(d.android).toBeTruthy();
  });
  it('gives every scheme/universal prefix a trailing uri= so the pairing appends verbatim', () => {
    for (const d of WALLETS)
      for (const p of [d.scheme, d.universal]) if (p) expect(p.endsWith('uri=')).toBe(true);
  });
});
