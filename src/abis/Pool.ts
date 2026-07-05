/**
 * Pool Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Flat pool surface (swap/deposit/withdraw/view). Admin ops live on Admin singleton.
 * Source: dex/evm @ 8c13bc0 — regen via `bun scratchpad/regen-dex-abis.ts`.
 */

export const POOL_ABI = [
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
      {
        name: 'poolAux_',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'fallback',
    stateMutability: 'payable',
  },
  {
    type: 'receive',
    stateMutability: 'payable',
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
    name: 'baseToken',
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
    name: 'batchSwap',
    inputs: [
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
    name: 'deposit',
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
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPool.DepositResult',
        components: [
          {
            name: 'lpAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'actualDeposit',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'donate',
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
    stateMutability: 'payable',
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
    name: 'getAsset',
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
        internalType: 'struct IPool.Asset',
        components: [
          {
            name: 'reserves',
            type: 'uint128',
            internalType: 'uint128',
          },
          {
            name: 'liabilities',
            type: 'uint128',
            internalType: 'uint128',
          },
          {
            name: 'minLiquidity',
            type: 'uint128',
            internalType: 'uint128',
          },
          {
            name: 'liquidityIndex',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'lastUpdate',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'minDispersion',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'anchor',
            type: 'address',
            internalType: 'address',
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
            name: 'maxDispersion',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'anchorDepth',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'decimals',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: '_pad1',
            type: 'uint8[2]',
            internalType: 'uint8[2]',
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
          {
            name: 'pegB64',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: '_pad2',
            type: 'uint8[2]',
            internalType: 'uint8[2]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAuthorizedBridge',
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
    name: 'getCoverageRatio',
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
    name: 'getFeeParams',
    inputs: [],
    outputs: [
      {
        name: '',
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
          {
            name: '_pad',
            type: 'uint8[29]',
            internalType: 'uint8[29]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getHookForFlag',
    inputs: [
      {
        name: 'tk',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'flag',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    outputs: [
      {
        name: 'h',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLPBalance',
    inputs: [
      {
        name: 'u',
        type: 'address',
        internalType: 'address',
      },
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
    name: 'getProtocolFees',
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
    name: 'getRiskFlags',
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
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSwapQuote',
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
        name: 'baseToken_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'wnative_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'feeParams',
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
          {
            name: '_pad',
            type: 'uint8[29]',
            internalType: 'uint8[29]',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'owner',
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
    name: 'poolAux',
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
    name: 'previewWithdraw',
    inputs: [
      {
        name: 'tk',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'lp',
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
    name: 'swap',
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
        name: 'out',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'swapLiability',
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
        name: 'lpAmountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minLpAmountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'lpAmountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'treasury',
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
    name: 'withdraw',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'lpAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minAmountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPool.WithdrawResult',
        components: [
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'lpBurned',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawTo',
    inputs: [
      {
        name: 'tokenFrom',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'tokenTo',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'lpAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minAmountOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPool.WithdrawResult',
        components: [
          {
            name: 'amountOut',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'lpBurned',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'wnative',
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
    type: 'event',
    name: 'PoolInitialized',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'baseToken',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'wnative',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AssetNotInTree',
    inputs: [
      {
        name: 'asset',
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
    name: 'InvalidDecimals',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidInput',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidPath',
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
