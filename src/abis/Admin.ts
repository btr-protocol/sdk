/**
 * Admin Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Singleton admin entrypoints. Pool address is first arg of pool-scoped fns.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const ADMIN_ABI = [
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
    name: 'addAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'batchRiskOp',
    inputs: [
      {
        name: 'pools',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'tokens',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'op',
        type: 'uint8',
        internalType: 'enum IAdmin.BatchOp',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'bootstrapSealed',
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
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cancelAddAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'cancelOracleUpdate',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'cancelSetAssetHook',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'cancelSetCurve',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'presetId',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelTimelock',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'opType',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelUpdateProfile',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'cancelUpdateRiskConfig',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'clearAssetHook',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'collectProtocolFees',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeAddAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'executeBaseMigration',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeOracleUpdate',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'executeSetAssetHook',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'executeSetCurve',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'presetId',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeTreasuryUpdate',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeUpdateFeeParams',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeUpdateProfile',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'executeUpdateRiskConfig',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'freezeAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'pauseAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestAddAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestBaseMigration',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestOracleUpdate',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestSetAssetHook',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestSetCurve',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestTreasuryUpdate',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestUpdateFeeParams',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestUpdateProfile',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'requestUpdateRiskConfig',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'riskFences',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'minFeeHardMin',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'minFeeHardMax',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'maxFeeHardMax',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'gammaHardMin',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'gammaHardMax',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'vegaHardMin',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'vegaHardMax',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'haircutHardMax',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'maxDeltaBps',
        type: 'uint16',
        internalType: 'uint16',
      },
      {
        name: 'reservationHardLoMin',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'reservationHardHiMax',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'sealBootstrap',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setAnchor',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'setAssetParams',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'setAssetParamsBounded',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'setCurve',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'setFlowCooldown',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'setRiskFences',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'f',
        type: 'tuple',
        internalType: 'struct IAdmin.RiskFences',
        components: [
          {
            name: 'minFeeHardMin',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'minFeeHardMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'maxFeeHardMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'gammaHardMin',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'gammaHardMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'vegaHardMin',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'vegaHardMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'haircutHardMax',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'maxDeltaBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'reservationHardLoMin',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'reservationHardHiMax',
            type: 'uint64',
            internalType: 'uint64',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unfreezeAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'unpauseAsset',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
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
    type: 'event',
    name: 'AnchorUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'asset',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'anchor',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AssetAdded',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'decimals',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'minLiquidity',
        type: 'uint128',
        indexed: false,
        internalType: 'uint128',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AssetHookUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'hook',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'flags',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AssetParamsBoundedSet',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'minFeePbps',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'gamma',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
      {
        name: 'tighten',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AssetParamsUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'minLiquidity',
        type: 'uint128',
        indexed: false,
        internalType: 'uint128',
      },
      {
        name: 'reservationPrice',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BaseTokenMigrated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'oldBase',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newBase',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BatchLegSkipped',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BatchRiskOp',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'op',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BootstrapSealed',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CurveUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'presetId',
        type: 'uint16',
        indexed: true,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EmergencyFreeze',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EmergencyUnfreeze',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeeParamsUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'protoShare',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'flashFeePbps',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FlowCooldownUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newCooldown',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OracleUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ProfileUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ProtocolFeesCollected',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'recipient',
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
    name: 'ProtocolPause',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ProtocolUnpause',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RiskConfigUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'minLiquidity',
        type: 'uint128',
        indexed: false,
        internalType: 'uint128',
      },
      {
        name: 'flags',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RiskFencesSet',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'maxDeltaBps',
        type: 'uint16',
        indexed: false,
        internalType: 'uint16',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TimelockCancelled',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'id',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'opType',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TimelockRequested',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'id',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'opType',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'executableAt',
        type: 'uint48',
        indexed: false,
        internalType: 'uint48',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TreasuryUpdated',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'oldTreasury',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newTreasury',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'Expired',
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
    name: 'NotCode',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotReady',
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
