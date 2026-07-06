/**
 * Distributor Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Rewards distributor singleton.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const DISTRIBUTOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'ac_',
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
    name: 'claimCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'index',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'totalEarned',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'merkleProof',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createTokenCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'rewardToken',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'manager',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'finalizeCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IDistributor.Campaign',
        components: [
          {
            name: 'id',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum IDistributor.CampaignStatus',
          },
          {
            name: 'rewardToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'manager',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'merkleRoot',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'lastUpdate',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'totalAllocated',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCampaignClaimable',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'index',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'totalEarned',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'merkleProof',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
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
    name: 'getCampaignClaimed',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'getTotalClaimed',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
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
    name: 'nextCampaignId',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'pauseCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resumeCampaign',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateCampaignRoot',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'merkleRoot',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'updatedAt',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'totalClaimable',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'CampaignClaimed',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'claimable',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'totalEarned',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CampaignCreated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'rewardToken',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'manager',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CampaignRootUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'merkleRoot',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'updatedAt',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
      {
        name: 'totalClaimable',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CampaignStatusUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'campaignId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'newStatus',
        type: 'uint8',
        indexed: false,
        internalType: 'enum IDistributor.CampaignStatus',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'InsufficientAmount',
    inputs: [
      {
        name: 'available',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'required',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
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
    name: 'NotConfigured',
    inputs: [
      {
        name: 'resource',
        type: 'uint8',
        internalType: 'enum Err.Resource',
      },
      {
        name: 'target',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'Reentrancy',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroAddr',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroValue',
    inputs: [],
  },
];
