/**
 * ExternalOracleV4 - the deployed READ surface.
 *
 * Named for the generation the fleet actually runs. The reads are the ones every packed-slot
 * oracle exposes (`IOracle.getFeed`, `feedConfig`, `feedIdAt`, and the NxrSignerSet roster
 * getters), so the same ABI also serves a V2 or V3 address; only the push paths and events
 * differ, and those are decoded from raw calldata (`oracle/wire.ts`), never through this ABI.
 * Bundled statically: the transparency page must read the chain with zero server trust, so it
 * cannot depend on the backend ABI service.
 *
 * ! `EPOCH` IS NOT UNIVERSAL. V2/V3 date a push as EPOCH + sourceTsDs deciseconds; V4 dropped the
 * epoch entirely for a CYCLIC clock (`tsDs` = deciseconds since midnight UTC) and exposes
 * `DAY_DS`/`nowDs`/`MAX_RECON_AGE` instead, so calling `EPOCH` on a V4 address REVERTS. Gate the
 * call on the lane map's `wire` and reconstruct a v5 source time with `reconSecsFromDs` against
 * the pushing block's timestamp. Everything else here is safe on all three.
 *
 * ! `feedConfig` IS V2/V3-ONLY for the same reason and REVERTS on V4, which moved the per-feed
 * config into the packed cfg word and exposes no struct getter for it. The consumer reads
 * (`getFeed`, `isFeedFresh`, `feedIdAt`, `session`, and the roster getters) are the portable set.
 *
 * Source: dex-evm src/oracles/ExternalOracleV{2,3,4}.sol + NxrSignerSet.sol.
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

export const EXTERNAL_ORACLE_V4_ABI = [
  {
    type: 'function',
    name: 'EPOCH',
    inputs: [],
    outputs: [{ name: '', type: 'uint32', internalType: 'uint32' }],
    stateMutability: 'view',
  },
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
  {
    type: 'function',
    name: 'feedIdAt',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
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

/** V3-only extra read: the live push session (relay + expiry + maxSeq + nonce). */
export const EXTERNAL_ORACLE_V3_SESSION_ABI = [
  {
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
  },
] as const;

/**
 * @deprecated use {@link EXTERNAL_ORACLE_V4_ABI}. Same bytes, honest name: the fleet runs V4, and
 * a V2 label on a V4 address is exactly the confusion the rename removes.
 */
export const EXTERNAL_ORACLE_V2_ABI = EXTERNAL_ORACLE_V4_ABI;
