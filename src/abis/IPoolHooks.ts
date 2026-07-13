/**
 * IPoolHooks Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * Per-asset yield-hook callback surface (preOutflow recall + postInflow deploy). Pool→hook direction. Flags: HOOK_PRE_OUTFLOW / HOOK_POST_INFLOW.
 * Source: dex/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const POOL_HOOKS_ABI = [
  {
    type: 'function',
    name: 'postInflow',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountIn',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'lpMinted',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'preOutflow',
    inputs: [
      {
        name: 'pool',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amountNeeded',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];
