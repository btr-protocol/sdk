/**
 * Merkle tree builder for Distributor campaign roots (shared/evm/src/Distributor.sol)
 * Leaf: keccak256(abi.encodePacked(address pool, uint256 campaignId, uint256 index, address account, uint256 totalEarned))
 * Cumulative model: totalEarned = lifetime earned, contract pays totalEarned - claimed.
 * Pair hashing: sorted (commutative), matching solady MerkleProofLib.verify.
 */

import { type Hex, concat, keccak256, pad, toHex } from '../eth/index.js';

export type MerkleTree = {
  root: Hex;
  layers: Hex[][];
};

export type MerkleLeaf = {
  pool: string; // campaign pool (leaf domain separation)
  campaignId: bigint;
  index: number;
  account: string;
  totalEarned: bigint; // CUMULATIVE lifetime earned, not per-epoch amount
};

/**
 * Build Merkle tree from leaves
 * Sorted pair hashing (canonical); odd node paired with itself
 */
export function buildMerkleTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) {
    return { root: '0x' as Hex, layers: [] };
  }

  let layer = leaves.slice();
  const layers: Hex[][] = [layer];

  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      next.push(hashPair(left, right));
    }
    layer = next;
    layers.push(layer);
  }

  return { root: layer[0], layers };
}

/**
 * Hash two nodes together (sorted for canonical ordering — solady/OZ convention)
 */
function hashPair(a: Hex, b: Hex): Hex {
  const [first, second] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([first, second]));
}

/**
 * Get Merkle proof for a leaf at given index
 * Returns array of sibling hashes from leaf to root
 */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): Hex[] {
  const proof: Hex[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const pairIndex = index ^ 1; // Toggle last bit to get sibling
    // Odd tail node is paired with itself in buildMerkleTree — its own hash is the sibling
    proof.push(pairIndex < layer.length ? layer[pairIndex] : layer[index]);
    index = index >> 1; // Move to parent index
  }

  return proof;
}

function toAddressBytes(addr: string): Hex {
  const a = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) throw new Error(`invalid address: ${addr}`);
  return a as Hex;
}

/**
 * Create leaf hash matching Distributor._verifyAndGetClaimable:
 * keccak256(abi.encodePacked(address pool, uint256 campaignId, uint256 index, address account, uint256 totalEarned))
 * = 20 + 32 + 32 + 20 + 32 bytes
 */
export function makeLeaf(entry: MerkleLeaf): Hex {
  return keccak256(
    concat([
      toAddressBytes(entry.pool),
      pad(toHex(entry.campaignId), 32),
      pad(toHex(BigInt(entry.index)), 32),
      toAddressBytes(entry.account),
      pad(toHex(entry.totalEarned), 32),
    ]),
  );
}

/**
 * Verify a Merkle proof (useful for testing)
 */
export function verifyProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  let computedHash = leaf;
  for (const sibling of proof) {
    computedHash = hashPair(computedHash, sibling);
  }
  return computedHash.toLowerCase() === root.toLowerCase();
}

/**
 * Build complete distribution from user entries
 * Returns tree + proofs for each user; totalClaimable = Σ totalEarned
 * (the exact `totalClaimable` arg for Distributor.proposeCampaignRoot)
 */
export type DistributionData = {
  root: Hex;
  entries: (MerkleLeaf & { proof: Hex[] })[];
  totalClaimable: bigint;
};

export function buildDistribution(entries: MerkleLeaf[]): DistributionData {
  // Sort by index to ensure deterministic ordering
  const sorted = entries.slice().sort((a, b) => a.index - b.index);

  // Build leaves
  const leaves = sorted.map(makeLeaf);

  // Build tree
  const tree = buildMerkleTree(leaves);

  // Generate proofs for each entry
  const withProofs = sorted.map((entry, idx) => ({
    ...entry,
    proof: getMerkleProof(tree, idx),
  }));

  // Cumulative liability = Σ totalEarned
  const totalClaimable = sorted.reduce((sum, e) => sum + e.totalEarned, 0n);

  return {
    root: tree.root,
    entries: withProofs,
    totalClaimable,
  };
}
