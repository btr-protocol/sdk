/**
 * Router Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * On-chain swap executor with min-out guards.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const ROUTER_ABI = [
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
    name: 'MAX_HOPS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cancelUpgrade',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeBatchSwap',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'inputs',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'outputs',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'recipient',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'amountsOut',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'executeSwap',
    inputs: [
      {
        name: 'route',
        type: 'tuple',
        internalType: 'struct IRouter.Route',
        components: [
          {
            name: 'steps',
            type: 'tuple[]',
            internalType: 'struct IRouter.RouteStep[]',
            components: [
              {
                name: 'pool',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenIn',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenOut',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'minOut',
                type: 'uint256',
                internalType: 'uint256',
              },
            ],
          },
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'gasEstimate',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minAmountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'recipient',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'amountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'executeUpgrade',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'factory',
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
    name: 'getBestBatchPool',
    inputs: [
      {
        name: 'inputs',
        type: 'tuple[]',
        internalType: 'struct IRouter.BatchInput[]',
        components: [
          {
            name: 'pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'tokenIn',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 'outputs',
        type: 'tuple[]',
        internalType: 'struct IRouter.BatchOutput[]',
        components: [
          {
            name: 'pool',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'tokenOut',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'weight',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'minAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    outputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'totalBaseValue',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBestDirectQuote',
    inputs: [
      {
        name: 'tokenIn',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenOut',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'quote',
        type: 'tuple',
        internalType: 'struct IPool.SwapQuote',
        components: [
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'amountIn',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'spreadBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'protoFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'lpFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'skewIn',
            type: 'int8',
            internalType: 'int8',
          },
          {
            name: 'skewOut',
            type: 'int8',
            internalType: 'int8',
          },
          {
            name: 'routeHops',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'hopAmounts',
            type: 'uint256[]',
            internalType: 'uint256[]',
          },
          {
            name: 'hopPrices',
            type: 'uint64[]',
            internalType: 'uint64[]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBestRoute',
    inputs: [
      {
        name: 'tokenIn',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenOut',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'route',
        type: 'tuple',
        internalType: 'struct IRouter.Route',
        components: [
          {
            name: 'steps',
            type: 'tuple[]',
            internalType: 'struct IRouter.RouteStep[]',
            components: [
              {
                name: 'pool',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenIn',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenOut',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'minOut',
                type: 'uint256',
                internalType: 'uint256',
              },
            ],
          },
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'gasEstimate',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 'amountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBestTwoHopRoute',
    inputs: [
      {
        name: 'tokenIn',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenOut',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'route',
        type: 'tuple',
        internalType: 'struct IRouter.Route',
        components: [
          {
            name: 'steps',
            type: 'tuple[]',
            internalType: 'struct IRouter.RouteStep[]',
            components: [
              {
                name: 'pool',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenIn',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'tokenOut',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'minOut',
                type: 'uint256',
                internalType: 'uint256',
              },
            ],
          },
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'gasEstimate',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 'amountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSwapQuote',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenIn',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenOut',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPool.SwapQuote',
        components: [
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'amountIn',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'spreadBps',
            type: 'uint16',
            internalType: 'uint16',
          },
          {
            name: 'protoFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'lpFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'skewIn',
            type: 'int8',
            internalType: 'int8',
          },
          {
            name: 'skewOut',
            type: 'int8',
            internalType: 'int8',
          },
          {
            name: 'routeHops',
            type: 'address[]',
            internalType: 'address[]',
          },
          {
            name: 'hopAmounts',
            type: 'uint256[]',
            internalType: 'uint256[]',
          },
          {
            name: 'hopPrices',
            type: 'uint64[]',
            internalType: 'uint64[]',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      {
        name: 'factory_',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pendingImplementation',
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
    name: 'pendingUpgradeId',
    inputs: [],
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
    name: 'pendingUpgradeOp',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint96',
        internalType: 'uint96',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proxiableUUID',
    inputs: [],
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
    name: 'requestUpgrade',
    inputs: [
      {
        name: 'implementation',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'upgradeToAndCall',
    inputs: [
      {
        name: 'newImplementation',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'data',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    name: 'BatchSwapExecuted',
    inputs: [
      {
        name: 'sender',
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
        name: 'pool',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'inputCount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'outputCount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SwapExecuted',
    inputs: [
      {
        name: 'sender',
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
        name: 'amountIn',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'amountOut',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'hopCount',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'UpgradeRequested',
    inputs: [
      {
        name: 'implementation',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'executeAt',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Upgraded',
    inputs: [
      {
        name: 'implementation',
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
    name: 'NotReady',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PendingTimelock',
    inputs: [
      {
        name: 'executeAt',
        type: 'uint48',
        internalType: 'uint48',
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
    name: 'SlippageExceeded',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Unauthorized',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnauthorizedCallContext',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UpgradeFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WrongEthAmount',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ZeroValue',
    inputs: [],
  },
];
