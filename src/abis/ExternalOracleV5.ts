// GENERATED from dex-evm/abi/ExternalOracleV5.json by `bun scripts/gen-constants.ts`. Do not edit.
/**
 * ExternalOracleV5 - the deployed feed read + admin surface (beacon generation).
 *
 * V4 is the Arc fleet and lives in `ExternalOracleV4.ts`; pick by the deployment record's
 * oracle version, never by assuming one. Push paths are decoded from raw calldata
 * (`oracle/wire.ts`), never through this ABI.
 */
import type { Abi } from '../eth/abi.js';

export const EXTERNAL_ORACLE_V5_ABI: Abi = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'ac_',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [],
    name: 'AC',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'LANES_PER_SLOT',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_DEV_THRESHOLD_BPS',
    outputs: [
      {
        internalType: 'uint16',
        name: '',
        type: 'uint16',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_SIGNERS',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MAX_SOURCE_AGE_SECS',
    outputs: [
      {
        internalType: 'uint32',
        name: '',
        type: 'uint32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'SIGNER_GOV_GRACE_SECS',
    outputs: [
      {
        internalType: 'uint48',
        name: '',
        type: 'uint48',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'SOURCE_TS_FUTURE_SKEW_SECS',
    outputs: [
      {
        internalType: 'uint32',
        name: '',
        type: 'uint32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'cancelFeedWiden',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'cancelSignerGrantBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'cancelSignerThresholdDecrease',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      {
        internalType: 'bytes1',
        name: 'fields',
        type: 'bytes1',
      },
      {
        internalType: 'string',
        name: 'name',
        type: 'string',
      },
      {
        internalType: 'string',
        name: 'version',
        type: 'string',
      },
      {
        internalType: 'uint256',
        name: 'chainId',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: 'verifyingContract',
        type: 'address',
      },
      {
        internalType: 'bytes32',
        name: 'salt',
        type: 'bytes32',
      },
      {
        internalType: 'uint256[]',
        name: 'extensions',
        type: 'uint256[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'executeFeedWiden',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'executeSignerGrantBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'executeSignerThresholdDecrease',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feedCount',
    outputs: [
      {
        internalType: 'uint16',
        name: '',
        type: 'uint16',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'globalIndex',
        type: 'uint256',
      },
    ],
    name: 'feedIdAt',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'getFeed',
    outputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'mark1e18',
            type: 'uint256',
          },
          {
            internalType: 'uint32',
            name: 'sigmaPbps',
            type: 'uint32',
          },
          {
            internalType: 'uint32',
            name: 'updatedAtSecs',
            type: 'uint32',
          },
          {
            internalType: 'uint16',
            name: 'ttlSecs',
            type: 'uint16',
          },
          {
            internalType: 'uint16',
            name: 'confidenceBps',
            type: 'uint16',
          },
          {
            internalType: 'uint16',
            name: 'flags',
            type: 'uint16',
          },
          {
            internalType: 'uint16',
            name: 'maxDevBps',
            type: 'uint16',
          },
          {
            internalType: 'uint48',
            name: 'sourceTsMs',
            type: 'uint48',
          },
        ],
        internalType: 'struct IOracle.FeedData',
        name: 'data',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'haltFeed',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: 'initialSigners_',
        type: 'address[]',
      },
      {
        internalType: 'uint8',
        name: 'signerThreshold_',
        type: 'uint8',
      },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'isFeedFresh',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'pendingFeedWiden',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'blob',
        type: 'bytes',
      },
      {
        internalType: 'bytes',
        name: 'sigs',
        type: 'bytes',
      },
    ],
    name: 'push',
    outputs: [
      {
        internalType: 'uint256',
        name: 'acceptedMask',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'feedId',
            type: 'bytes32',
          },
          {
            internalType: 'uint32',
            name: 'globalIndex',
            type: 'uint32',
          },
          {
            internalType: 'uint16',
            name: 'maxDevBps',
            type: 'uint16',
          },
          {
            internalType: 'uint16',
            name: 'ttlSecs',
            type: 'uint16',
          },
          {
            internalType: 'uint32',
            name: 'minSigmaPbps',
            type: 'uint32',
          },
        ],
        internalType: 'struct IExternalOracleV5.RegisterParams',
        name: 'p',
        type: 'tuple',
      },
    ],
    name: 'registerFeed',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'bytes32',
            name: 'feedId',
            type: 'bytes32',
          },
          {
            internalType: 'uint32',
            name: 'globalIndex',
            type: 'uint32',
          },
          {
            internalType: 'uint16',
            name: 'maxDevBps',
            type: 'uint16',
          },
          {
            internalType: 'uint16',
            name: 'ttlSecs',
            type: 'uint16',
          },
          {
            internalType: 'uint32',
            name: 'minSigmaPbps',
            type: 'uint32',
          },
        ],
        internalType: 'struct IExternalOracleV5.RegisterParams[]',
        name: 'ps',
        type: 'tuple[]',
      },
    ],
    name: 'registerFeedBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        internalType: 'uint16',
        name: 'newMaxDevBps',
        type: 'uint16',
      },
      {
        internalType: 'uint16',
        name: 'newTtlSecs',
        type: 'uint16',
      },
      {
        internalType: 'uint32',
        name: 'newMinSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'requestFeedWiden',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: 'batch',
        type: 'address[]',
      },
    ],
    name: 'requestSignerGrantBatch',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 't',
        type: 'uint8',
      },
    ],
    name: 'requestSignerThresholdDecrease',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    name: 'revokeSigner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 't',
        type: 'uint8',
      },
    ],
    name: 'setSignerThreshold',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'signerCount',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'signerThreshold',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    name: 'signers',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'storageVersion',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'unhaltFeed',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'updateFeed',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'FeedHalted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'globalIndex',
        type: 'uint32',
      },
    ],
    name: 'FeedRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'FeedUnhalted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'FeedUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
    ],
    name: 'FeedWidenCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'oldMaxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'newMaxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'oldTtlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'newTtlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'oldMinSigmaPbps',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'newMinSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'FeedWidenExecuted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint48',
        name: 'eta',
        type: 'uint48',
      },
    ],
    name: 'FeedWidenRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'heldMark',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'refusedMark',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'devBps',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'allowed',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'dt',
        type: 'uint256',
      },
    ],
    name: 'LaneQuarantined',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    name: 'SignerGrantCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint48',
        name: 'eta',
        type: 'uint48',
      },
    ],
    name: 'SignerGrantRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    name: 'SignerGranted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'signer',
        type: 'address',
      },
    ],
    name: 'SignerRevoked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint8',
        name: 'threshold',
        type: 'uint8',
      },
    ],
    name: 'SignerThresholdDecreaseCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint8',
        name: 'threshold',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'uint48',
        name: 'eta',
        type: 'uint48',
      },
    ],
    name: 'SignerThresholdDecreaseRequested',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint8',
        name: 'threshold',
        type: 'uint8',
      },
    ],
    name: 'SignerThresholdUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint32',
        name: 'slotId',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint8',
        name: 'acceptedLaneMask',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'uint8',
        name: 'skippedLaneMask',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'srcSecs',
        type: 'uint32',
      },
    ],
    name: 'SlotApplied',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint32',
        name: 'seq',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'srcSecs',
        type: 'uint32',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'acceptedMask',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'blobHash',
        type: 'bytes32',
      },
    ],
    name: 'SlotsPushed',
    type: 'event',
  },
  {
    inputs: [],
    name: 'AlreadyPending',
    type: 'error',
  },
  {
    inputs: [],
    name: 'Expired',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'FeedAlreadyExists',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'feedId',
        type: 'bytes32',
      },
    ],
    name: 'FeedNotFound',
    type: 'error',
  },
  {
    inputs: [],
    name: 'FutureTimestamp',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidBlobHeader',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidInput',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidState',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NoPending',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotAuthorized',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotContract',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotOwner',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotReady',
    type: 'error',
  },
  {
    inputs: [],
    name: 'StaleTimestamp',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ZeroAddress',
    type: 'error',
  },
];
