/**
 * Pool Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Consolidated Pool ABI (post-Phase 42B.1.5 module merge: Liquidity + Exchange unified into Pool).
 * Source: dex/evm/src/Pool.sol (V-free post-V1 drop).
 */

export const POOL_ABI = [
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
        "name": "result",
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
        "name": "bridge",
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
    "name": "ZeroValue",
    "inputs": []
  }
] as const;

/**
 * @deprecated Phase 42B.1.5 stage D: ILiquidity merged into Pool. Alias of `POOL_ABI` for back-compat.
 * On-chain `ILiquidity` interface remains as a composite stub of `IPoolModule`; selectors stable.
 * Prefer `POOL_ABI` in new code.
 */
export const ILIQUIDITY_ABI = POOL_ABI;

/**
 * @deprecated Phase 42B.1.5 stage D: IExchange merged into Pool. Alias of `POOL_ABI` for back-compat.
 * On-chain `IExchange` interface remains as a composite stub of `IPoolModule`; selectors stable.
 * Prefer `POOL_ABI` in new code.
 */
export const IEXCHANGE_ABI = POOL_ABI;
