import { describe, expect, test } from 'bun:test';
import { SEPOLIA_ORACLE_FEEDS, sepoliaFeedByName, sepoliaFeedId } from '../src/venues/sepolia';

/**
 * The oracle feed table is a money-path identity map: a wrong entry relays one
 * asset's mark under another's name. It shipped 29 entries against the chain's
 * 30 (the USDC-USD depeg reference was missing), which silently made every
 * position after idx 23 disagree with `feedIds[]`.
 */
describe('sepolia oracle feed table', () => {
  test('feedIds are unique — a duplicate would alias two assets to one mark', () => {
    const ids = SEPOLIA_ORACLE_FEEDS.map((f) => f.feedId.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('on-chain names are unique — `name` is the only safe feed-level key', () => {
    const names = SEPOLIA_ORACLE_FEEDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('carries the USDC-USD base-depeg reference', () => {
    // Pricing._denominate divides every usdQuoted asset by this feed, so its
    // absence is not cosmetic. Value = `feed_USDC-USD` in
    // dex/evm/deployments/11155111.deploy.json (SoT; re-check with
    // bun run scripts/verify-sepolia-venue.ts after every redeploy).
    const ref = sepoliaFeedByName('USDC-USD');
    expect(ref).not.toBeNull();
    expect(ref!.feedId).toBe('0xf097408cec312d10691ef8ff946389a6eab389bed1a574aa68222fdf45f1f1f2');
    expect(ref!.name).not.toBe('USDC-USDC');
  });

  test('token-symbol lookup still resolves USDC to its own feed, not the reference', () => {
    expect(sepoliaFeedId('USDC')).toBe(sepoliaFeedByName('USDC-USDC')!.feedId);
  });
});
