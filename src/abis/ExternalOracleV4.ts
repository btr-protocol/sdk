/**
 * ExternalOracleV4 - the deployed READ surface (V4-safe reads only).
 *
 * The fleet runs V4 (cyclic clock, no EPOCH). Every entry here answers on a V4 address; the
 * V2-only extras (`EPOCH`, `feedConfig`) live in {@link EXTERNAL_ORACLE_V2_EXTRA_ABI} and REVERT
 * on V4. Push paths and events differ per generation and are decoded from raw calldata
 * (`oracle/wire.ts`), never through this ABI.
 * Bundled statically: the transparency page must read the chain with zero server trust, so it
 * cannot depend on the backend ABI service.
 *
 * ! V2/V3 clock reads need the lane map's `wire`: V2/V3 date a push as EPOCH + sourceTsDs
 * deciseconds, V4 dropped the epoch for a CYCLIC clock (`tsDs` = deciseconds since midnight UTC).
 * Reconstruct a v5 source time with `reconSecsFromDs` against the pushing block's timestamp.
 * ! `feedConfig` IS V2-ONLY: V4 moved the per-feed config into the packed cfg word and exposes
 * no struct getter for it.
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
  { name: 'maxDeviationBps', type: 'uint16', internalType: 'uint16' },
  { name: 'sourceTsMs', type: 'uint48', internalType: 'uint48' },
] as const;

/** Live push session (relay + expiry + maxSeq + nonce). V3 and V4 share the shape. */
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

/** V2-only extras: revert on V4. Pair with {@link EXTERNAL_ORACLE_V4_ABI} for a legacy address. */
export const EXTERNAL_ORACLE_V2_EXTRA_ABI = [
  {
    type: 'function',
    name: 'EPOCH',
    inputs: [],
    outputs: [{ name: '', type: 'uint32', internalType: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feedConfig',
    inputs: [{ name: 'feedId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IExternalOracleV2.FeedConfig',
        components: [
          { name: 'globalIndex', type: 'uint32', internalType: 'uint32' },
          { name: 'expBias', type: 'int8', internalType: 'int8' },
          { name: 'maxDeviationBps', type: 'uint16', internalType: 'uint16' },
          { name: 'ttlSecs', type: 'uint16', internalType: 'uint16' },
          { name: 'flags', type: 'uint16', internalType: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

/** @deprecated V3 and V4 share the session shape; prefer {@link EXTERNAL_ORACLE_V4_ABI}. */
export const EXTERNAL_ORACLE_V3_SESSION_ABI = [SESSION_FN] as const;

/**
 * @deprecated use {@link EXTERNAL_ORACLE_V4_ABI} (+ {@link EXTERNAL_ORACLE_V2_EXTRA_ABI} for a
 * legacy V2 address). Kept so existing V2 callers keep compiling; a V2 label on a V4 address is
 * exactly the confusion the rename removes.
 */
export const EXTERNAL_ORACLE_V2_ABI = [...EXTERNAL_ORACLE_V4_ABI, ...EXTERNAL_ORACLE_V2_EXTRA_ABI];
