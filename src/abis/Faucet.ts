/**
 * Faucet
 * @module @btr-protocol/sdk/abis
 *
 * Testnet mock-ERC20 faucet: whitelist + per-token daily caps. User-facing subset of
 * `dex-evm script/testnet/TestnetFaucet.sol` (owner setters omitted). Not served by the backend
 * ABI service: a testnet script contract, so this static copy is the only one.
 */

export const FAUCET_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'whitelisted',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'dailyCap',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'remaining',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
