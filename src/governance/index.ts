/**
 * Governance timelock schedule
 * @module @btr-protocol/sdk/governance
 *
 * `AccessControl.GOV_DELAYS()` returns ONE `uint256` holding the whole fleet's delay schedule:
 * `Tier` count x uint32 seconds, least-significant tier first. Unpacking it is contract logic
 * so it lives here rather than in each caller.
 */

import { Tier } from '../abis/solidity.generated.js';
import type { Abi } from '../eth/abi.js';

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
 * The only supported shape for a throwaway chain, and never for a live one; surface it.
 */
export function hasZeroDelay(schedule: bigint): boolean {
  for (let i = 0; i < TIERS; i++) {
    if (((schedule >> (32n * BigInt(i))) & MASK_32) === 0n) return true;
  }
  return false;
}

/**
 * AccessControl generation on `chainId`. Arc (5042002) predates the `perms` word and answers
 * `isGuardian` / `isRiskSteward` / `isDepositor` / `isKeeper` (`ACCESS_CONTROL_LEGACY_ABI`); every
 * other chain answers `perms(address)`. By chain, never by probing: a missing selector reverts, and
 * a revert is not "no role".
 */
export const acGeneration = (chainId?: number): 'legacy' | 'perms' =>
  chainId === 5042002 ? 'legacy' : 'perms';

const who = { name: 'who', type: 'address', internalType: 'address' };
const legacyRead = (name: string) => ({
  type: 'function',
  name,
  stateMutability: 'view',
  inputs: [who],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
});
const legacyEvent = (name: string) => ({
  type: 'event',
  name,
  anonymous: false,
  inputs: [
    { ...who, indexed: true },
    { name: 'ok', type: 'bool', indexed: false, internalType: 'bool' },
  ],
});

/** Arc's role reads and events, retired by the `perms` word. Here, not in `abis/`, so a header
 *  hook can carry it without the ABI chunk. */
export const ACCESS_CONTROL_LEGACY_ABI = [
  ...['isGuardian', 'isRiskSteward', 'isDepositor'].map(legacyRead),
  ...['GuardianUpdated', 'RiskStewardUpdated', 'KeeperUpdated'].map(legacyEvent),
] as unknown as Abi;

/** Does a `perms` word hold `lane` (a `PERM_*` role or a leg gate bit such as `SWAP_GATED_BIT`)? */
export const holds = (perms: bigint, lane: number): boolean => (perms & BigInt(lane)) !== 0n;
