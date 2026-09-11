import { describe, expect, test } from 'bun:test';
import { Tier } from '../abis/solidity.generated.js';
import { delayOf, govDelays, hasZeroDelay } from './index.js';

const DAY = 86_400n;
const HOUR = 3_600n;
/** `SC.PROD_DELAYS`, the three-tier word packed here the way a deploy script packs it. */
const PROD = (7n * DAY) | (DAY << 32n) | (HOUR << 64n);

describe('packed GOV_DELAYS schedule', () => {
  test('each tier reads back the seconds it was packed with', () => {
    expect(govDelays(PROD)).toEqual({
      GOVERNANCE: 604_800,
      LISTING: 86_400,
      TUNING: 3_600,
    });
  });

  test('a tier reads its OWN 32 bits, not a neighbour spilling into them', () => {
    // GOVERNANCE sits in the bottom word and TUNING in the top: nothing to borrow.
    expect(delayOf(PROD, Tier.TUNING)).toBe(3_600);
    expect(delayOf(1n << 32n, Tier.GOVERNANCE)).toBe(0);
    expect(delayOf(1n << 32n, Tier.LISTING)).toBe(1);
  });

  test('hasZeroDelay flags any zero tier', () => {
    expect(hasZeroDelay(PROD)).toBe(false);
    expect(hasZeroDelay(0n)).toBe(true);
    // LISTING cleared: a schedule that looks production-grade until a listing moves.
    expect(hasZeroDelay(PROD & ~(0xffff_ffffn << 32n))).toBe(true);
  });
});
