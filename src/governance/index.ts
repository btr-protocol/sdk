/**
 * Governance timelock schedule
 * @module @btr-protocol/sdk/governance
 *
 * `AccessControl.GOV_DELAYS()` returns ONE `uint256` holding the whole fleet's delay schedule:
 * `Tier` count x uint32 seconds, least-significant tier first. Unpacking it is contract logic
 * so it lives here rather than in each caller.
 */

import { Tier } from '../abis/solidity.generated.js';

const TIERS = Object.keys(Tier).length;
const MASK_32 = 0xffff_ffffn;

/** Seconds of delay `tier` carries in a packed schedule word. */
export function delayOf(schedule: bigint, tier: Tier): number {
  return Number((schedule >> (32n * BigInt(tier))) & MASK_32);
}

/** The whole schedule, keyed by tier name. */
export function govDelays(schedule: bigint): Record<keyof typeof Tier, number> {
  return Object.fromEntries(
    Object.entries(Tier).map(([name, t]) => [name, delayOf(schedule, t)]),
  ) as Record<keyof typeof Tier, number>;
}

/**
 * True when ANY tier is zero, i.e. the deployment is not production-grade: timelocks are still
 * enforced but mature immediately, so a queued op is executable in the same block it was queued.
 * The only supported shape for a throwaway chain, and never for a live one — surface it.
 */
export function hasZeroDelay(schedule: bigint): boolean {
  for (let i = 0; i < TIERS; i++) {
    if (((schedule >> (32n * BigInt(i))) & MASK_32) === 0n) return true;
  }
  return false;
}
