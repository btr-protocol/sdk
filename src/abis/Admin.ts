/**
 * Admin Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Singleton admin entrypoints. Pool address is first arg of pool-scoped fns.
 * Source: dex/evm/src/Admin.sol.
 */

export const ADMIN_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "ac_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "AC",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addAsset",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "oracleCfg",
        "type": "tuple",
        "internalType": "struct IPool.OracleConfig",
        "components": [
          {
            "name": "primary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "secondary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modeFlags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "accDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "_pad",
            "type": "uint8[13]",
            "internalType": "uint8[13]"
          }
        ]
      },
      {
        "name": "riskCfg",
        "type": "tuple",
        "internalType": "struct IPool.RiskConfig",
        "components": [
          {
            "name": "decayStartRatioBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMin",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMax",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "decaySlope",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "depthAmplifier",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "_pad",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          }
        ]
      },
      {
        "name": "profile",
        "type": "tuple",
        "internalType": "struct IPool.LiquidityProfile",
        "components": [
          {
            "name": "weights",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          },
          {
            "name": "knots",
            "type": "int8[17]",
            "internalType": "int8[17]"
          }
        ]
      },
      {
        "name": "minFeeBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "initialPrice",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "initialFastVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "initialSlowVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "minDispersion",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "maxDispersion",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "gamma",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "vega",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "lambda",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelOracleUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelTimelock",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "opType",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "collectProtocolFees",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeAddAsset",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeBaseMigration",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeBridgeUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeOracleUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeTreasuryUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeUpdateFeeParams",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeUpdateRiskConfig",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "freezeAsset",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestAddAsset",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "oracleCfg",
        "type": "tuple",
        "internalType": "struct IPool.OracleConfig",
        "components": [
          {
            "name": "primary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "secondary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modeFlags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "accDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "_pad",
            "type": "uint8[13]",
            "internalType": "uint8[13]"
          }
        ]
      },
      {
        "name": "riskCfg",
        "type": "tuple",
        "internalType": "struct IPool.RiskConfig",
        "components": [
          {
            "name": "decayStartRatioBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMin",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMax",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "decaySlope",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "depthAmplifier",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "_pad",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          }
        ]
      },
      {
        "name": "profile",
        "type": "tuple",
        "internalType": "struct IPool.LiquidityProfile",
        "components": [
          {
            "name": "weights",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          },
          {
            "name": "knots",
            "type": "int8[17]",
            "internalType": "int8[17]"
          }
        ]
      },
      {
        "name": "minFeeBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "initialPrice",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "initialFastVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "initialSlowVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestBaseMigration",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newBase",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestBridgeUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newBridge",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestOracleUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct IPool.OracleConfig",
        "components": [
          {
            "name": "primary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "secondary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feedId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "modeFlags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "accDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "_pad",
            "type": "uint8[13]",
            "internalType": "uint8[13]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestTreasuryUpdate",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newTreasury",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestUpdateFeeParams",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IPool.FeeParams",
        "components": [
          {
            "name": "protoShare",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "flashFeeBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "_pad",
            "type": "uint8[29]",
            "internalType": "uint8[29]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requestUpdateRiskConfig",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct IPool.RiskConfig",
        "components": [
          {
            "name": "decayStartRatioBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMin",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "coverageMax",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "decaySlope",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "depthAmplifier",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "flags",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "_pad",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAnchor",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "anchor",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAssetParams",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minLiquidity",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "minFeeBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxFeeBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "gamma",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "vega",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "lambda",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "haircutSuppressor",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "reservationPrice",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFlowCooldown",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "cooldownSeconds",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "unfreezeAsset",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AnchorUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "anchor",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "depth",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetAdded",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "minLiquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetParamsUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "minLiquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "reservationPrice",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BaseTokenMigrated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldBase",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newBase",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BridgeUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldBridge",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newBridge",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EmergencyFreeze",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EmergencyUnfreeze",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeParamsUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "protoShare",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "flashFeeBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FlowCooldownUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldCooldown",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "newCooldown",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OracleUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProtocolFeesCollected",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RiskConfigUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "minLiquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "flags",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TimelockCancelled",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "opType",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TimelockRequested",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "opType",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "executableAt",
        "type": "uint48",
        "indexed": false,
        "internalType": "uint48"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryUpdated",
    "inputs": [
      {
        "name": "pool",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "oldTreasury",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newTreasury",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotReady",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddr",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroValue",
    "inputs": []
  }
] as const;
