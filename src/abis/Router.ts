// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.
/**
 * Router
 * @module @btr-protocol/sdk/abis
 *
 * Executes an off-chain chosen path across BTR pools in one transaction. Route SELECTION stays
 * off-chain; this only executes. Floors are end-to-end per OUTPUT TOKEN, never per hop.
 * Source: dex-evm/abi/Router.json
 */

export const ROUTER_ABI = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'factory_',
        type: 'address',
        internalType: 'address',
      },
    ],
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
        internalType: 'contract IPoolFactory',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'swap',
    inputs: [
      {
        name: 'parts',
        type: 'tuple[]',
        internalType: 'struct Router.Part[]',
        components: [
          {
            name: 'tokenIn',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amountIn',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'hops',
            type: 'tuple[]',
            internalType: 'struct Router.Hop[]',
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
            ],
          },
        ],
      },
      {
        name: 'floors',
        type: 'tuple[]',
        internalType: 'struct Router.Floor[]',
        components: [
          {
            name: 'token',
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
        name: 'recipient',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'deadline',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'received',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'BelowFloor',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'received',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minOut',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'UnclaimedOutput',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'DuplicateFloor',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'BadRecipient',
    inputs: [],
  },
  {
    type: 'error',
    name: 'DeadlineExpired',
    inputs: [],
  },
  {
    type: 'error',
    name: 'EmptyPath',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NoParts',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Reentrancy',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnknownPool',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
] as const;
