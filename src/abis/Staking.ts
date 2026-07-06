/**
 * Staking Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Gov + LP staking singleton.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const STAKING_ABI = [
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
        internalType: 'contract AccessControl',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'delegate',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'to',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'delegateOf',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'govCooldownSeconds',
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
    name: 'govPaused',
    inputs: [],
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
    name: 'govStakeLockDuration',
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
    name: 'govStaked',
    inputs: [
      {
        name: 'user',
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
    name: 'govToken',
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
    name: 'govUnlockTime',
    inputs: [
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'isWhitelisted',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
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
    name: 'pauseGov',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pauseStakable',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setGovStakeConfig',
    inputs: [
      {
        name: 'lockDuration',
        type: 'uint48',
        internalType: 'uint48',
      },
      {
        name: 'cooldownSeconds_',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setGovToken',
    inputs: [
      {
        name: 'gov',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setStakableConfig',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'cfg',
        type: 'tuple',
        internalType: 'struct IStaking.StakableConfig',
        components: [
          {
            name: 'stakeLockDuration',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'cooldownSeconds',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'paused',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stakableConfig',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IStaking.StakableConfig',
        components: [
          {
            name: 'stakeLockDuration',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'cooldownSeconds',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'paused',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'stake',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'shares',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stakeGov',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stakeWeight',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'user',
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
    name: 'stakedAssetToken',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
    ],
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
    name: 'stakedBalance',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'user',
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
    name: 'stakedGovToken',
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
    name: 'totalGovStaked',
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
    name: 'totalStaked',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
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
    name: 'unlockTime',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
    ],
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
    name: 'unpauseGov',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unpauseStakable',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unstake',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'shares',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unstakeGov',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unwhitelistStakable',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'whitelistStakable',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        internalType: 'contract IStakable',
      },
      {
        name: 'cfg',
        type: 'tuple',
        internalType: 'struct IStaking.StakableConfig',
        components: [
          {
            name: 'stakeLockDuration',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'cooldownSeconds',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'paused',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'DelegateSet',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'user',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'oldDelegate',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'newDelegate',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'GovStaked',
    inputs: [
      {
        name: 'user',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'unlockTime',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'GovUnstaked',
    inputs: [
      {
        name: 'user',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StakableConfigUpdated',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'stakeLockDuration',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
      {
        name: 'cooldownSeconds',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StakablePaused',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StakableUnpaused',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StakableUnwhitelisted',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'StakableWhitelisted',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'sAsset',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'user',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'shares',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'unlockTime',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Unstaked',
    inputs: [
      {
        name: 'stakable',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'user',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'shares',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AlreadyConfigured',
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
    name: 'NotFound',
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
