import type { Abi } from './abi.js';

/** WETH9 wrap/unwrap. The pool NEVER sees the gas token: the user's own account wraps and unwraps
 *  inside the same batch, so no pool-side native path is used. */
export const WNATIVE_ABI: Abi = [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
];
