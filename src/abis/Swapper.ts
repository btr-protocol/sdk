/**
 * Swapper Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * ALM Swapper -Lifi/Settler routing for vault rebalance.
 * Source: alm/evm/src/Swapper.sol.
 */

export const SWAPPER_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "ac_",
        "type": "address",
        "internalType": "contract AccessControl"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "INTENT_GRACE",
    "inputs": [],
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
    "name": "MAX_INTENT_TTL",
    "inputs": [],
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
    "name": "MIN_INTENT_TTL",
    "inputs": [],
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
    "name": "ROUTER_TIMELOCK",
    "inputs": [],
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
    "name": "ac",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract AccessControl"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activeOut",
    "inputs": [
      {
        "name": "",
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
    "name": "bootstrapLifi",
    "inputs": [
      {
        "name": "r",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bootstrapSettler",
    "inputs": [
      {
        "name": "s",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimLateRefund",
    "inputs": [
      {
        "name": "tokenIn",
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
        "name": "paid",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "erc7683Settler",
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
    "name": "escrowed",
    "inputs": [
      {
        "name": "",
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
    "name": "executeLifi",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeSettler",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "forceRefund",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "intentNonce",
    "inputs": [],
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
    "name": "intents",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
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
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "minOut",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "outBaseline",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settler",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lateRefund",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
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
    "name": "lifiRouter",
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
    "name": "openIntent",
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
        "name": "minOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "orderData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ownerRescue",
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
    "name": "pendingLifi",
    "inputs": [],
    "outputs": [
      {
        "name": "addr",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "eta",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingSettler",
    "inputs": [],
    "outputs": [
      {
        "name": "addr",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "eta",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "queueLifi",
    "inputs": [
      {
        "name": "r",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "queueSettler",
    "inputs": [
      {
        "name": "s",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refundIntent",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "refundData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "refunded",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settleIntent",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
        "name": "minOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "routerData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "IntentOpened",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": false,
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
        "name": "minOut",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IntentRefunded",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "refunded",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "forced",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "IntentSettled",
    "inputs": [
      {
        "name": "intentId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "received",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LifiQueued",
    "inputs": [
      {
        "name": "router",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "eta",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LifiSet",
    "inputs": [
      {
        "name": "router",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlerQueued",
    "inputs": [
      {
        "name": "settler",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "eta",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SettlerSet",
    "inputs": [
      {
        "name": "settler",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SwapExecuted",
    "inputs": [
      {
        "name": "caller",
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
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "slipBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DustResidual",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IntentActive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IntentNotExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "IntentNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MinOutNotMet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPending",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotCode",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotElapsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotKeeper",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Reentrancy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RouterNotPinned",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SettlerNotPinned",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddr",
    "inputs": []
  }
] as const;
