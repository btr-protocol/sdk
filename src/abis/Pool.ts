/**
 * Pool Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Per-pool clone (EIP-1167). Flat surface — singleton helpers (Admin/Staking/Distributor/Flash) wrap pool-scoped operations.
 * Source: dex/evm/src/Pool.sol.
 */

export const POOL_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "ac_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "admin_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "staking_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "flash_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
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
    "name": "DEFAULT_TTL",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FAST_VOL_ALPHA",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "FAST_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_VOLATILITY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SLOW_VOL_ALPHA",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SLOW_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "admin",
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
    "name": "adminCollectProtocolFees",
    "inputs": [
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
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "adminFreezeAsset",
    "inputs": [
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
    "name": "adminInitAsset",
    "inputs": [
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
    "name": "adminSetAnchor",
    "inputs": [
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
    "name": "adminSetAssetParams",
    "inputs": [
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
    "name": "adminSetBaseToken",
    "inputs": [
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
    "name": "adminSetBridge",
    "inputs": [
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
    "name": "adminSetFeeParams",
    "inputs": [
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
    "name": "adminSetFlowCooldown",
    "inputs": [
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
    "name": "adminSetOracleConfig",
    "inputs": [
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
    "name": "adminSetRiskConfig",
    "inputs": [
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
    "name": "adminSetTreasury",
    "inputs": [
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
    "name": "adminUnfreezeAsset",
    "inputs": [
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
    "name": "baseToken",
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
    "name": "batchSwap",
    "inputs": [
      {
        "name": "inputs",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "outputs",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amountsOut",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPool.DepositResult",
        "components": [
          {
            "name": "lpAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "actualDeposit",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "donate",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "flash",
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
    "name": "flashAccount",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "fee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "protoFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "flashSend",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAsset",
    "inputs": [
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPool.Asset",
        "components": [
          {
            "name": "reserves",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "liabilities",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "minLiquidity",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "liquidityIndex",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "lastUpdate",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "minDispersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "anchor",
            "type": "address",
            "internalType": "address"
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
            "name": "maxDispersion",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "anchorDepth",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "_pad1",
            "type": "uint8[2]",
            "internalType": "uint8[2]"
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
          },
          {
            "name": "_pad2",
            "type": "uint8[16]",
            "internalType": "uint8[16]"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAuthorizedBridge",
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
    "name": "getFastTWAP",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getFeeParams",
    "inputs": [],
    "outputs": [
      {
        "name": "",
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
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getFeed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "data",
        "type": "tuple",
        "internalType": "struct IOracle.FeedData",
        "components": [
          {
            "name": "lastPriceB64",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "fastOffset",
            "type": "int32",
            "internalType": "int32"
          },
          {
            "name": "slowOffset",
            "type": "int32",
            "internalType": "int32"
          },
          {
            "name": "fastVolEMA",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "slowVolEMA",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "updatedAt",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "ttl",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "confidence",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHookForFlag",
    "inputs": [
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "flag",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
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
    "name": "getLPBalance",
    "inputs": [
      {
        "name": "u",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getMidPrice",
    "inputs": [
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getProtocolFees",
    "inputs": [
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRiskFlags",
    "inputs": [
      {
        "name": "tk",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getSwapQuote",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPoolModule.SwapQuote",
        "components": [
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spreadBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "protoFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lpFee",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "skewIn",
            "type": "int8",
            "internalType": "int8"
          },
          {
            "name": "skewOut",
            "type": "int8",
            "internalType": "int8"
          },
          {
            "name": "routeHops",
            "type": "address[]",
            "internalType": "address[]"
          },
          {
            "name": "hopAmounts",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "hopPrices",
            "type": "uint64[]",
            "internalType": "uint64[]"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "initialize",
    "inputs": [
      {
        "name": "baseToken_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "wnative_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "feeParams",
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
    "name": "isFeedFresh",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isFeedFresh",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "maxAge",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
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
    "name": "pushFeed",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "staking",
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
    "name": "stakingAdjustLpBalance",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "delta",
        "type": "int256",
        "internalType": "int256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swap",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "out",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "swapLiability",
    "inputs": [
      {
        "name": "tokenIn",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lpAmountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minLpAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "lpAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
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
    "name": "updateFeed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "initialPrice",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "accDecimals",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "fastVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "slowVolEMA",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPool.WithdrawResult",
        "components": [
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lpBurned",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawTo",
    "inputs": [
      {
        "name": "tokenFrom",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenTo",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IPool.WithdrawResult",
        "components": [
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lpBurned",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "wnative",
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
    "type": "event",
    "name": "BatchSwapped",
    "inputs": [
      {
        "name": "sender",
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
        "name": "inputCount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "outputCount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalBaseValue",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      {
        "name": "sender",
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
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Donated",
    "inputs": [
      {
        "name": "sender",
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
    "name": "LiabilitySwapped",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "lpAmountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lpAmountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "haircut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OracleUpdated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "price",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "fastVolEMA",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "slowVolEMA",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolInitialized",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "baseToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "wnative",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Swapped",
    "inputs": [
      {
        "name": "sender",
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
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "spreadBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "protoFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lpFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "sender",
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
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "lpAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyConfigured",
    "inputs": [
      {
        "name": "resource",
        "type": "uint8",
        "internalType": "enum Err.Resource"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AssetNotInTree",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "CooldownActive",
    "inputs": [
      {
        "name": "remainingSeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "CycleDetected",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DepthExceeded",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "depth",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExcessiveAmount",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "limit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FeatureDisabled",
    "inputs": [
      {
        "name": "resource",
        "type": "uint8",
        "internalType": "enum Err.Resource"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientAmount",
    "inputs": [
      {
        "name": "available",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAnchor",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "anchor",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDecimals",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPath",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotConfigured",
    "inputs": [
      {
        "name": "resource",
        "type": "uint8",
        "internalType": "enum Err.Resource"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotFound",
    "inputs": [
      {
        "name": "resource",
        "type": "uint8",
        "internalType": "enum Err.Resource"
      },
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Overflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PriceBelowReservation",
    "inputs": [
      {
        "name": "price",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "reservationPrice",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "Reentrancy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StaleData",
    "inputs": [
      {
        "name": "age",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "maxAge",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ThresholdViolation",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "threshold",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
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
