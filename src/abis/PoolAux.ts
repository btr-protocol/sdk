/**
 * PoolAux Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Cold-path dispatcher (Pool fallback → DELEGATECALL). Hook surface (getAssetHook/hookDeploy/hookRecall) + pool-scoped admin. Call against the POOL address, not PoolAux.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const POOL_AUX_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'ac_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'admin_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'flash_',
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
    name: 'admin',
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
    name: 'adminClearAssetHook',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminCollectProtocolFees',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'recipient',
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
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminFreezeAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminInitAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'oracleCfg',
        type: 'tuple',
        internalType: 'struct IPool.OracleConfig',
        components: [
          {
            name: 'feedId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'refFeedId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'primary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'refBandBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'mode',
            type: 'uint8',
            internalType: 'uint8',
          },
        ],
      },
      {
        name: 'riskCfg',
        type: 'tuple',
        internalType: 'struct IPool.RiskConfig',
        components: [
          {
            name: 'decayStartRatioBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'coverageMin',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'coverageMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'decaySlope',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'depthAmplifier',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'flags',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'kappaCovBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
      {
        name: 'profile',
        type: 'tuple',
        internalType: 'struct IPool.LiquidityProfile',
        components: [
          {
            name: 'weights',
            type: 'uint8[16]',
            internalType: 'uint8[16]',
          },
          {
            name: 'knots',
            type: 'int8[17]',
            internalType: 'int8[17]',
          },
        ],
      },
      {
        name: 'minFeeBps',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'decimals',
        type: 'uint8',
        internalType: 'uint8',
      },
      {
        name: 'minDispersion',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'maxDispersion',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'gamma',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'vega',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminPauseAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetAnchor',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'anchor',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetAssetHook',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'hook',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'flags',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetAssetParams',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'minLiquidity',
        type: 'uint128',
        internalType: 'uint128',
      },
      {
        name: 'minFeeBps',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'maxFeeBps',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'gamma',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'vega',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'haircutSuppressor',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'reservationPrice',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'reservationPriceMax',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetBaseToken',
    inputs: [
      {
        name: 'newBase',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetBridge',
    inputs: [
      {
        name: 'newBridge',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetFeeParams',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct IPool.FeeParams',
        components: [
          {
            name: 'protoShare',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'flashFeeBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetFlowCooldown',
    inputs: [
      {
        name: 'cooldownSeconds',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetOracleConfig',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'cfg',
        type: 'tuple',
        internalType: 'struct IPool.OracleConfig',
        components: [
          {
            name: 'feedId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'refFeedId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'primary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'refBandBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'mode',
            type: 'uint8',
            internalType: 'uint8',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetProfile',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'profile',
        type: 'tuple',
        internalType: 'struct IPool.LiquidityProfile',
        components: [
          {
            name: 'weights',
            type: 'uint8[16]',
            internalType: 'uint8[16]',
          },
          {
            name: 'knots',
            type: 'int8[17]',
            internalType: 'int8[17]',
          },
        ],
      },
      {
        name: 'minDispersion',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'maxDispersion',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetRiskConfig',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'cfg',
        type: 'tuple',
        internalType: 'struct IPool.RiskConfig',
        components: [
          {
            name: 'decayStartRatioBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'coverageMin',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'coverageMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'decaySlope',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'depthAmplifier',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'flags',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'kappaCovBps',
            type: 'uint16',
            internalType: 'uint16',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetTreasury',
    inputs: [
      {
        name: 'newTreasury',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminUnfreezeAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminUnpauseAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'flash',
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
    name: 'flashAccount',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'fee',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'protoFee',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'flashPrepare',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'initiator',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'flashSend',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
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
    name: 'getAssetHook',
    inputs: [
      {
        name: 'tk',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPool.HookSlot',
        components: [
          {
            name: 'target',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'flags',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBuffer',
    inputs: [
      {
        name: 'tk',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'reserves',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'invested',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minLiquidity',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getInvested',
    inputs: [
      {
        name: 'tk',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint128',
        internalType: 'uint128',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLiquidReserves',
    inputs: [
      {
        name: 'tk',
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
    name: 'hookCreditYield',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'hookDeploy',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'hookRecall',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'hookWriteDown',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
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
    type: 'error',
    name: 'BadConfig',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExcessiveAmount',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'limit',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'FeatureDisabled',
    inputs: [
      {
        name: 'resource',
        type: 'uint8',
        internalType: 'enum Err.Resource',
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
    name: 'InvalidState',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotCode',
    inputs: [],
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
    name: 'NotOwner',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Reentrancy',
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
