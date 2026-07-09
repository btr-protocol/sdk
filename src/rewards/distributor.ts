/**
 * Reward distribution generator for Distributor campaigns (cumulative Merkle model)
 * Combines earning power calculation with Merkle tree generation.
 * Each root update carries CUMULATIVE totalEarned per account — the contract pays
 * totalEarned - alreadyClaimed. Accounts with prior earnings MUST stay in every
 * subsequent tree or their unclaimed remainder becomes unclaimable.
 */

import type { Address, Hex } from '../eth/index.js';
import { type UserStake, computeDistribution } from './earning-power.js';
import { type MerkleLeaf, buildDistribution } from './merkle.js';

/**
 * Campaign root update configuration
 */
export type CampaignConfig = {
  pool: Address; // campaign pool key (leaf domain separation)
  campaignId: bigint;
  rewardToken: Address;
  epochRewards: bigint; // NEW tokens distributed by this update (delta, not cumulative)
  startTime: number; // epoch start, unix
  endTime: number; // epoch end, unix
};

/**
 * Complete distribution for a campaign root update
 */
export type CampaignDistribution = {
  config: CampaignConfig;
  merkleRoot: Hex;
  totalClaimable: bigint; // Σ totalEarned — pass as proposeCampaignRoot totalClaimable
  claims: {
    account: Address;
    index: number;
    totalEarned: bigint; // cumulative — pass as claimCampaign totalEarned
    proof: Hex[];
  }[];
};

/**
 * Generate the next cumulative root for a campaign.
 * Allocates epochRewards pro-rata to earning power, on top of previousEarned
 * (cumulative totalEarned per account from the prior root — empty for the first root).
 */
export function generateCampaignDistribution(
  config: CampaignConfig,
  users: UserStake[],
  poolWeights: Map<Address, number>,
  previousEarned: Map<Address, bigint> = new Map(),
): CampaignDistribution {
  // Carry forward all prior cumulative earnings (lowercased keys)
  const earned = new Map<Address, bigint>();
  for (const [account, total] of previousEarned.entries()) {
    if (total > 0n) earned.set(account.toLowerCase() as Address, total);
  }

  // Allocate this epoch's rewards pro-rata: delta = (power / totalPower) * epochRewards
  const earningPowers = computeDistribution(users, poolWeights);
  const totalPower = Array.from(earningPowers.values()).reduce((sum, power) => sum + power, 0n);
  if (totalPower > 0n) {
    for (const [user, power] of earningPowers.entries()) {
      const delta = (power * config.epochRewards) / totalPower;
      if (delta === 0n) continue;
      const key = user.toLowerCase() as Address;
      earned.set(key, (earned.get(key) ?? 0n) + delta);
    }
  }

  if (earned.size === 0) {
    return { config, merkleRoot: '0x' as Hex, totalClaimable: 0n, claims: [] };
  }

  // Deterministic index assignment: sort by account
  const entries: MerkleLeaf[] = Array.from(earned.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([account, totalEarned], index) => ({
      pool: config.pool,
      campaignId: config.campaignId,
      index,
      account,
      totalEarned,
    }));

  const distribution = buildDistribution(entries);
  const claims = distribution.entries.map((entry) => ({
    account: entry.account as Address,
    index: entry.index,
    totalEarned: entry.totalEarned,
    proof: entry.proof,
  }));

  return {
    config,
    merkleRoot: distribution.root,
    totalClaimable: distribution.totalClaimable,
    claims,
  };
}

/**
 * Export distribution in JSON format for indexer/frontend
 */
export type ExportedDistribution = {
  pool: string;
  campaignId: string;
  rewardToken: string;
  merkleRoot: string;
  totalClaimable: string;
  epochRewards: string;
  startTime: number;
  endTime: number;
  claims: {
    account: string;
    index: number;
    totalEarned: string;
    proof: string[];
  }[];
};

export function exportDistribution(dist: CampaignDistribution): ExportedDistribution {
  return {
    pool: dist.config.pool,
    campaignId: dist.config.campaignId.toString(),
    rewardToken: dist.config.rewardToken,
    merkleRoot: dist.merkleRoot,
    totalClaimable: dist.totalClaimable.toString(),
    epochRewards: dist.config.epochRewards.toString(),
    startTime: dist.config.startTime,
    endTime: dist.config.endTime,
    claims: dist.claims.map((c) => ({
      account: c.account,
      index: c.index,
      totalEarned: c.totalEarned.toString(),
      proof: c.proof,
    })),
  };
}

/**
 * Find user's claim in a distribution
 */
export function findUserClaim(
  dist: CampaignDistribution,
  account: Address,
): (typeof dist.claims)[0] | undefined {
  return dist.claims.find((c) => c.account.toLowerCase() === account.toLowerCase());
}
