/**
 * Golden-vector tests for Distributor Merkle helpers.
 * Vectors computed in Solidity mirroring Distributor._verifyAndGetClaimable
 * (leaf = keccak256(abi.encodePacked(pool, campaignId, index, account, totalEarned)),
 * sorted-pair hashing) and verified with solady MerkleProofLib.verify — the
 * exact verifier the contract uses. Byte-equality here ⇒ on-chain verifiable.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildDistribution,
  buildMerkleTree,
  getMerkleProof,
  makeLeaf,
  verifyProof,
} from './merkle.js';

const POOL = '0x1111111111111111111111111111111111111111';
const CAMPAIGN_ID = 1n;

const ENTRIES = [
  {
    pool: POOL,
    campaignId: CAMPAIGN_ID,
    index: 0,
    account: '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
    totalEarned: 10n ** 18n,
  },
  {
    pool: POOL,
    campaignId: CAMPAIGN_ID,
    index: 1,
    account: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    totalEarned: 2_500_000_000_000_000_000n,
  },
  {
    pool: POOL,
    campaignId: CAMPAIGN_ID,
    index: 2,
    account: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    totalEarned: 3n,
  },
];

// forge test TempMerkleVectors output (solady MerkleProofLib.verify PASS on all proofs)
const LEAVES = [
  '0x55917eb808aa77451bd6ac01bd7b605783498f91ca39a03e8251d4aa18b1d81c',
  '0xd9d92e18b98f5ff342e7b59fd0459460f71ef9de9e9e05a02f623be944a3851a',
  '0xf674522705a0edbabc472fb211b06a20c007fd72d4fbcc649e2e4533b1139a50',
];
const N0 = '0x22380c2a71cf1b6136a4c63f6429866fcd220f181cf910bf8969992922102582'; // hashPair(l0, l1)
const N1 = '0x296f3346ddd4daada0b32cd3832e04b8ea6a00585167aa0fdd1f3837e30b7758'; // hashPair(l2, l2)
const ROOT = '0x8b3dcd5ea7c7c024ba4f5d6c6e64b290b906be6a43a53106105b3c302e428c35';

describe('makeLeaf', () => {
  it('byte-equals keccak256(abi.encodePacked(pool, campaignId, index, account, totalEarned))', () => {
    for (let i = 0; i < ENTRIES.length; i++) {
      expect(makeLeaf(ENTRIES[i])).toBe(LEAVES[i] as `0x${string}`);
    }
  });

  it('rejects malformed addresses', () => {
    expect(() => makeLeaf({ ...ENTRIES[0], account: '0xdead' })).toThrow('invalid address');
    expect(() => makeLeaf({ ...ENTRIES[0], pool: 'not-an-address' })).toThrow('invalid address');
  });
});

describe('buildMerkleTree', () => {
  it('reproduces the Solidity-computed root (odd leaf self-paired, sorted pairs)', () => {
    const tree = buildMerkleTree(ENTRIES.map(makeLeaf));
    expect(tree.layers[1][0]).toBe(N0 as `0x${string}`);
    expect(tree.layers[1][1]).toBe(N1 as `0x${string}`);
    expect(tree.root).toBe(ROOT as `0x${string}`);
  });

  it('single-leaf tree: root == leaf, empty proof verifies (MerkleProofLib convention)', () => {
    const leaf = makeLeaf(ENTRIES[0]);
    const tree = buildMerkleTree([leaf]);
    expect(tree.root).toBe(leaf);
    expect(getMerkleProof(tree, 0)).toEqual([]);
    expect(verifyProof([], tree.root, leaf)).toBe(true);
  });
});

describe('getMerkleProof', () => {
  it('emits the exact sibling sets MerkleProofLib.verify accepted in forge', () => {
    const tree = buildMerkleTree(ENTRIES.map(makeLeaf));
    expect(getMerkleProof(tree, 0)).toEqual([LEAVES[1], N1] as `0x${string}`[]);
    expect(getMerkleProof(tree, 1)).toEqual([LEAVES[0], N1] as `0x${string}`[]);
    // Odd tail node: its own hash is the sibling (self-paired)
    expect(getMerkleProof(tree, 2)).toEqual([LEAVES[2], N0] as `0x${string}`[]);
  });

  it('every proof verifies against the root', () => {
    const leaves = ENTRIES.map(makeLeaf);
    const tree = buildMerkleTree(leaves);
    for (let i = 0; i < leaves.length; i++) {
      expect(verifyProof(getMerkleProof(tree, i), tree.root, leaves[i])).toBe(true);
    }
    // Wrong leaf fails
    expect(verifyProof(getMerkleProof(tree, 0), tree.root, leaves[1])).toBe(false);
  });
});

describe('buildDistribution', () => {
  it('cumulative: totalClaimable = Σ totalEarned, root matches golden vector', () => {
    const dist = buildDistribution(ENTRIES);
    expect(dist.root).toBe(ROOT as `0x${string}`);
    expect(dist.totalClaimable).toBe(10n ** 18n + 2_500_000_000_000_000_000n + 3n);
    for (const entry of dist.entries) {
      expect(verifyProof(entry.proof, dist.root, makeLeaf(entry))).toBe(true);
    }
  });
});
