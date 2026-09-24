import { describe, expect, test } from 'bun:test';
import { encodeRoster, tierVerifier } from './eip712.js';
import { observedAtSecs } from './feed.js';

describe('observedAtSecs: the clock the contract gates on', () => {
  test('unsigned feed falls back to updatedAtSecs', () => {
    expect(observedAtSecs({ sourceTsMs: 0, updatedAtSecs: 1_000 })).toBe(1_000);
  });

  // The relay stamps updatedAtSecs=now on an older signed quote. Taking the min is what stops a
  // withheld blob from reading fresh; using updatedAtSecs alone under-states age by the relay lag.
  test('signed feed takes the min, so relay lag counts against freshness', () => {
    expect(observedAtSecs({ sourceTsMs: 900_000, updatedAtSecs: 1_000 })).toBe(900);
    expect(observedAtSecs({ sourceTsMs: 1_500_000, updatedAtSecs: 1_000 })).toBe(1_000);
  });
});

describe('MarkStore tiers', () => {
  test('tier verifiers: the factory, then keccak(factory ++ uint8(2))', () => {
    const f = '0x1111111111111111111111111111111111111111';
    expect(tierVerifier(f, 1).toLowerCase()).toBe(f);
    expect(tierVerifier(f, 2).toLowerCase()).toBe('0x25515d4d8b0c15f5ef3bcae82d546a20654e7942');
  });

  test('roster tail packs addresses at 20 bytes', () => {
    const s = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ] as const;
    const r = encodeRoster([...s], 2, ['0x00000000000000000000000000000000000000ff']);
    const z19 = '00'.repeat(19);
    // nSigners | signers | k | nRelayers | relayers
    expect<string>(r).toBe(`0x02${z19}01${z19}020201${z19}ff`);
  });
});
