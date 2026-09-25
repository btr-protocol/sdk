/**
 * Minimal Ethereum utilities
 * Depends on @noble/hashes for keccak256
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isAddress } from './types';
import type { Address } from './types';

// Re-export @noble/hashes utilities for convenience
export { bytesToHex, hexToBytes };

// Input type for @noble/hashes functions (string is UTF-8, not hex)
export type Input = string | Uint8Array;

// Types
export type {
  Address,
  Hex,
  Hash,
  Eip1193Provider,
  TransactionRequest,
  TransactionReceipt,
  Log,
  TypedDataDomain,
  TypedData,
} from './types';

export {
  isAddress,
  zeroAddress,
  isZeroAddress,
  NATIVE_TOKEN,
} from './types';

/**
 * EIP-55 checksum casing for addresses.
 * Input may be any-case; output is checksummed mixed-case.
 */
export function checksumAddress(address: string): Address {
  const lower = address.toLowerCase();
  if (!isAddress(lower)) throw new Error('Invalid address');
  const hex = lower.slice(2);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex)));
  let out = '0x';
  for (let i = 0; i < hex.length; i++) {
    out += Number.parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out as Address;
}

// Chains
export type { ChainInfo } from './chains';
export {
  CHAINS,
  getChain,
  chainIconSlug,
  getChainIcon,
  getChainMonoIcon,
  getAllRpcs,
  getExplorerUrl,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  getMulticall3,
} from './chains';

// Tokens
export type { TokenMetadata } from './tokens';
export {
  TOKENS,
  getTokenIcon,
  getTokenAddress,
  canonicalTokenSymbol,
  resolveTokenAlias,
  tokenMatchesSearch,
} from './tokens';

// Contracts (deployed addresses)
export type { SupportedChainId } from './contracts';
export {
  CONTRACTS,
  getContractAddress,
  getBtrPoolFactory,
  getBtrAdmin,
  getBtrAccessControl,
} from './contracts';

// ABI
export type { Abi, AbiFunction } from './abi';
export {
  getSelector,
  encode,
  decode,
  encodeFn,
  decodeFn,
  encodeAbiParameters,
  decodeAbiParameters,
  getEventSignature,
  getFunctionSignature,
} from './abi';

// Token Standards
export { ERC20_ABI } from './erc20';
export { ERC4626_ABI } from './erc4626';

// RPC
export {
  requestAccounts,
  getAccounts,
  getChainId,
  getGasPrice,
  getBlockNumber,
  getNonce,
  getCode,
  ethCall,
  estimateGas,
  sendTransaction,
  signMessage,
  signTypedData,
  switchChain,
  addChain,
  rpcErrorCode,
  rpcErrorData,
  isProviderDisconnected,
  waitForTransaction,
  onAccountsChanged,
  onChainChanged,
} from './rpc';

// Transport (resilient HTTP JSON-RPC: timeout/retry/failover/batch, typed errors)
export type { TransportOpts } from './transport';
export {
  httpTransport,
  RpcRevertError,
  RpcRateLimitError,
  RpcTimeoutError,
  RpcNetworkError,
} from './transport';

// Signature Verification
export { verifySignature } from './signature';

// Contract
export {
  Contract,
  ContractRevertError,
  readContract,
  writeContract,
} from './contract';

// Multicall
export type { Call } from './multicall';
export { MC3_ADDR, multicall, multicallStrict } from './multicall';

// Signing clients (bots / keepers)
export type { Client } from './client';
export {
  createHttpProvider,
  createPrivateKeyClient,
  createPublicClient,
  createWalletClient,
  privateKeyToAddress,
} from './client';

// Wallets
export type {
  WalletInfo,
  AccountClass,
  WalletChain,
} from './wallets';
export {
  WALLETS,
  slug,
  walletId,
  resolveWallet,
  accountClass,
  WC_ICONS,
  DISCOVER_MOBILE,
  DISCOVER_DESKTOP,
  isMobile,
  isKnownWallet,
  getDownloadUrl,
  getName,
  getTooltip,
  detectLegacy,
  eip6963Providers,
  mergeWallets,
} from './wallets';

// ─────────────────────────────────────────────────────────────
// Re-export formatting and encoding utilities from utils
// ─────────────────────────────────────────────────────────────

export {
  formatUnits,
  parseUnits,
} from '../utils/format.js';

export {
  toHex,
  concat,
  pad,
  numberToHex,
} from '../utils/encoding.js';

// ─────────────────────────────────────────────────────────────
// Keccak256 (using @noble/hashes)
// ─────────────────────────────────────────────────────────────

/**
 * Keccak-256 hash function (Ethereum's hash)
 * Accepts hex string or Uint8Array and returns hex string
 */
export function keccak256(data: `0x${string}` | Uint8Array): `0x${string}` {
  const bytes = typeof data === 'string' ? hexToBytes(data.slice(2)) : data;
  const hash = keccak_256(bytes);
  return `0x${bytesToHex(hash)}`;
}

/**
 * Keccak-256 for Input type (string or Uint8Array)
 * String input is treated as UTF-8, not hex
 */
export function keccak256Input(data: Input): `0x${string}` {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = keccak_256(bytes);
  return `0x${bytesToHex(hash)}`;
}
