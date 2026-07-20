/**
 * ExternalOracle Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Signed external oracle. batchPushSigned carries NXR-signed (price, sigma, confidence, sourceTs); guardian fast-freeze via pauseFeed/revokeSigner/narrowMaxDeviation.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const EXTERNAL_ORACLE_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'ac_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'maxRelayLagSecs_',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'initialSigners_',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'signerThreshold_',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'AC',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_DEV_THRESHOLD',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_SIGNERS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SIGNER_GOV_GRACE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint48',
        internalType: 'uint48',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SIGNER_GOV_TIMELOCK',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint48',
        internalType: 'uint48',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SOURCE_TS_FUTURE_SKEW_S',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'addFeed',
    inputs: [
      {
        name: 'base',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'quote',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'price',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sigmaSample',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'confidence',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'maxDeviation',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'ttl',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'batchPushSigned',
    inputs: [
      {
        name: 'blob',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'sigs',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelSignerGrant',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelSignerThresholdDecrease',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      {
        name: 'fields',
        type: 'bytes1',
        internalType: 'bytes1',
      },
      {
        name: 'name',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'version',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'chainId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'verifyingContract',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'salt',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'extensions',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executeSignerGrant',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeSignerThresholdDecrease',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'feedIds',
    inputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'data',
        type: 'tuple',
        internalType: 'struct IOracle.FeedData',
        components: [
          {
            name: 'lastPriceB64',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'sigma',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'updatedAt',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'ttl',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'confidence',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'flags',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'maxDeviation',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'sourceTs',
            type: 'uint48',
            internalType: 'uint48',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeedIds',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedFresh',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFeedFresh',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'maxAge',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'maxRelayLagSecs',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'narrowMaxDeviation',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'newMaxDeviation',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pauseFeed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pendingSigner',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingSignerGrantOp',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint96',
        internalType: 'uint96',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingSignerThreshold',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingSignerThresholdOp',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint96',
        internalType: 'uint96',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'requestSignerGrant',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestSignerThresholdDecrease',
    inputs: [
      {
        name: 't',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeSigner',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setSignerThreshold',
    inputs: [
      {
        name: 't',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'signerCount',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'signerThreshold',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'signers',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'unpauseFeed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateFeed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'maxDeviation',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'ttl',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'FeedAdded',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'base',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'quote',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'price',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'sigmaSample',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
      {
        name: 'confidence',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'maxDeviation',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeedPaused',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeedUnpaused',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeedUpdated',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'maxDeviation',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'ttl',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MaxDeviationNarrowed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'newMaxDeviation',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerGrantCancelled',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerGrantRequested',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'eta',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerGranted',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerRevoked',
    inputs: [
      {
        name: 'signer',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerThresholdDecreaseCancelled',
    inputs: [
      {
        name: 'threshold',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerThresholdDecreaseRequested',
    inputs: [
      {
        name: 'threshold',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'eta',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SignerThresholdSet',
    inputs: [
      {
        name: 'threshold',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'CooldownActive',
    inputs: [
      {
        name: 'remainingSeconds',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
  },
  {
    type: 'error',
    name: 'Expired',
    inputs: [],
  },
  {
    type: 'error',
    name: 'FeedAlreadyExists',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'FeedNotFound',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'FeedStale',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidInput',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidState',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotAuth',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotCode',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotOwner',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotReady',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Overflow',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PendingTimelock',
    inputs: [
      {
        name: 'executeAt',
        type: 'uint48',
        internalType: 'uint48',
      },
    ],
  },
  {
    type: 'error',
    name: 'ThresholdViolation',
    inputs: [
      {
        name: 'value',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'threshold',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ZeroValue',
    inputs: [],
  },
];
