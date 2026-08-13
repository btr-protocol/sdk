import { describe, expect, test } from 'bun:test';
import { Tier } from '../abis/solidity.generated.js';
import { delayOf, govDelays, hasZeroDelay } from './index.js';

const DAY = 86_400n;
/** `SC.PROD_DELAYS` (shared/evm/src/Constants.sol), packed here the way a deploy script packs it. */
const PROD =
  (7n * DAY) |
  ((3n * DAY) << 32n) |
  ((2n * DAY) << 64n) |
  (DAY << 96n) |
  ((7n * DAY) << 128n) |
  ((7n * DAY) << 160n) |
  ((14n * DAY) << 192n);

describe('packed GOV_DELAYS schedule', () => {
  test('each tier reads back the seconds it was packed with', () => {
    expect(govDelays(PROD)).toEqual({
      CRITICAL: 604_800,
      HIGH: 259_200,
      BASE: 172_800,
      LOW: 86_400,
      UPGRADE: 604_800,
      ROTATION: 604_800,
      FACTORY: 1_209_600,
    });
  });

  test('a tier reads its OWN 32 bits, not a neighbour spilling into them', () => {
    // FACTORY sits in the top word and CRITICAL in the bottom: nothing above or below to borrow.
    expect(delayOf(PROD, Tier.FACTORY)).toBe(1_209_600);
    expect(delayOf(1n << 32n, Tier.CRITICAL)).toBe(0);
    expect(delayOf(1n << 32n, Tier.HIGH)).toBe(1);
  });

  test('hasZeroDelay flags any zero tier, including the unused high ones', () => {
    expect(hasZeroDelay(PROD)).toBe(false);
    expect(hasZeroDelay(0n)).toBe(true);
    // Every tier but ROTATION set: a schedule that looks production-grade until a role rotates.
    expect(hasZeroDelay(PROD & ~(0xffff_ffffn << 160n))).toBe(true);
  });
});
