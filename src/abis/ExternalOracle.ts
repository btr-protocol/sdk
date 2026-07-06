/**
 * ExternalOracle Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Push-based external oracle. pushFeed/batchPush carry (price, sigma, confidence); getEma = rate-clamped reference.
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
        name: 'oracle_',
        type: 'address',
        internalType: 'address',
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
    name: 'DEFAULT_TTL',
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
    name: 'MAX_VOLATILITY',
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
        name: 'tau',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'tauSigma',
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
    name: 'batchPush',
    inputs: [
      {
        name: '_feedIds',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: 'prices',
        type: 'uint64[]',
        internalType: 'uint64[]',
      },
      {
        name: 'sigmas',
        type: 'uint32[]',
        internalType: 'uint32[]',
      },
      {
        name: 'confidences',
        type: 'uint16[]',
        internalType: 'uint16[]',
      },
    ],
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
    name: 'getEma',
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
        type: 'uint64',
        internalType: 'uint64',
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
            name: 'emaPriceB64',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'sigmaEma',
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
            name: 'tau',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'tauSigma',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getFeedCount',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
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
    name: 'grantOracle',
    inputs: [
      {
        name: 'oracle',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'hasFeed',
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
    name: 'isOracle',
    inputs: [
      {
        name: 'account',
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
    name: 'oracles',
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
    name: 'pushFeed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'newPriceB64',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'sigmaSample',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'newConfidence',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeOracle',
    inputs: [
      {
        name: 'oracle',
        type: 'address',
        internalType: 'address',
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
    name: 'BatchPushed',
    inputs: [
      {
        name: 'count',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'pusher',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
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
        name: 'tau',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'tauSigma',
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
    name: 'OracleGranted',
    inputs: [
      {
        name: 'oracle',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OracleRevoked',
    inputs: [
      {
        name: 'oracle',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Pushed',
    inputs: [
      {
        name: 'feedId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'price',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'ema',
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
        name: 'sigmaEma',
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
        name: 'pusher',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
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
    name: 'InvalidDecimals',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidInput',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotAuth',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Overflow',
    inputs: [],
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
