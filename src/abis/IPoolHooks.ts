// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.
/**
 * IPoolHooks
 * @module @btr-protocol/sdk/abis
 *
 * Per-asset yield-hook callback surface (preOutflow liquidate; investing is keeper-only). Pool→hook direction. Flag: HOOK_PRE_OUTFLOW.
 * Source: backend ABI service
 */

export const POOL_HOOKS_ABI = [
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
