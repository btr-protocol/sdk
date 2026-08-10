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
    name: 'adminHaltAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'src',
        type: 'uint16',
        internalType: 'uint16',
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
          {
            name: 'usdQuoted',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'refPrimary',
            type: 'address',
            internalType: 'address',
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
        name: 'presetId',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'minFeePbps',
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
        name: 'minFeePbps',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'maxFeePbps',
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
      {
        name: 'spokes',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetCurve',
    inputs: [
      {
        name: 'presetId',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'interior',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
      {
        name: 'wQ',
        type: 'int256[]',
        internalType: 'int256[]',
      },
      {
        name: 'dispRef',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'flags',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'adminSetDeadSeedPow10',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'pow10',
        type: 'uint8',
        internalType: 'uint8',
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
            name: 'flashFeePbps',
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
          {
            name: 'usdQuoted',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'refPrimary',
            type: 'address',
            internalType: 'address',
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
        name: 'presetId',
        type: 'uint16',
        internalType: 'uint16',
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
    name: 'adminUnhaltAsset',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'src',
        type: 'uint16',
        internalType: 'uint16',
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
    type: 'event',
    name: 'DeadSharesSeeded',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'value',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'lpAmount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'IndexUpdated',
    inputs: [
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'index',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'reserves',
        type: 'uint128',
        indexed: false,
        internalType: 'uint128',
      },
      {
        name: 'liabilities',
        type: 'uint128',
        indexed: false,
        internalType: 'uint128',
      },
      {
        name: 'reason',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
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
    name: 'Overflow',
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
    name: 'BaseDepegged',
    inputs: [
      {
        name: 'basePriceWad',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'deviationBps',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'CooldownActive',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExceedsMaxSupply',
    inputs: [],
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
    name: 'FeedPaused',
    inputs: [],
  },
  {
    type: 'error',
    name: 'FeedStale',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidAnchor',
    inputs: [
      {
        name: 'asset',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'anchor',
        type: 'address',
        internalType: 'address',
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
    name: 'InvalidPath',
    inputs: [],
  },
  {
    type: 'error',
    name: 'KillCapExhausted',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NoPending',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotAdapter',
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
    name: 'NotElapsed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotFactory',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotReady',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OperationFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PendingTimelock',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PriceOutsideReservation',
    inputs: [
      {
        name: 'price',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'bound',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'StaleData',
    inputs: [
      {
        name: 'age',
        type: 'uint32',
        internalType: 'uint32',
      },
      {
        name: 'maxAge',
        type: 'uint32',
        internalType: 'uint32',
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
];
