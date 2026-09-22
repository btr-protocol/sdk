/**
 * ExternalOracleV4 - the deployed READ surface.
 *
 * The fleet runs V4 (cyclic clock, no EPOCH). Push paths and events differ per generation and are
 * decoded from raw calldata (`oracle/wire.ts`), never through this ABI.
 * Bundled statically: the transparency page must read the chain with zero server trust, so it
 * cannot depend on the backend ABI service.
 *
 * ! V4 dates a push with a CYCLIC clock (`tsDs` = deciseconds since midnight UTC, no epoch).
 * Reconstruct a v5 source time with `reconSecsFromDs` against the pushing block's timestamp.
 *
 * Source: dex-evm src/oracles/ExternalOracleV4.sol + NxrSignerSet.sol.
 */

const FEED_DATA_COMPONENTS = [
  { name: 'mark1e18', type: 'uint256', internalType: 'uint256' },
  { name: 'sigmaPbps', type: 'uint32', internalType: 'uint32' },
  { name: 'updatedAtSecs', type: 'uint32', internalType: 'uint32' },
  { name: 'ttlSecs', type: 'uint16', internalType: 'uint16' },
  { name: 'confidenceBps', type: 'uint16', internalType: 'uint16' },
  { name: 'flags', type: 'uint16', internalType: 'uint16' },
  { name: 'maxDevBps', type: 'uint16', internalType: 'uint16' },
  { name: 'sourceTsMs', type: 'uint48', internalType: 'uint48' },
] as const;

/** Live push session (relay + expiry + maxSeq + nonce). */
const SESSION_FN = {
  type: 'function',
  name: 'session',
  inputs: [],
  outputs: [
    { name: 'relay', type: 'address', internalType: 'address' },
    { name: 'expiresAt', type: 'uint48', internalType: 'uint48' },
    { name: 'maxSeq', type: 'uint32', internalType: 'uint32' },
    { name: 'nonce', type: 'uint16', internalType: 'uint16' },
  ],
  stateMutability: 'view',
} as const;

export const EXTERNAL_ORACLE_V4_ABI = [
  {
    type: 'function',
    name: 'getFeed',
    inputs: [{ name: 'feedId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: 'data',
        type: 'tuple',
        internalType: 'struct IOracle.FeedData',
        components: FEED_DATA_COMPONENTS,
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedFresh',
    inputs: [{ name: 'feedId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedFresh',
    inputs: [
      { name: 'feedId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'maxAge', type: 'uint32', internalType: 'uint32' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feedIdAt',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  SESSION_FN,
  {
    type: 'function',
    name: 'nowDs',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'DAY_DS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_RECON_AGE',
    inputs: [],
    outputs: [{ name: '', type: 'uint32', internalType: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'expHeadroom',
    inputs: [{ name: 'feedId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      { name: 'stepsUp', type: 'uint8', internalType: 'uint8' },
      { name: 'stepsDown', type: 'uint8', internalType: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'signers',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'signerThreshold',
    inputs: [],
    outputs: [{ name: '', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'signerCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
] as const;
