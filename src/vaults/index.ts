/**
 * Vaults registry
 * @module @btr-protocol/sdk/vaults
 *
 * Canonical typed registry of live BTR vaults across chains. Single source for
 * front/back/keepers — do NOT hardcode vault addresses or counts elsewhere; new
 * vaults (e.g. BTC-SO-T) appear here and consumers pick them up automatically.
 */

import type { Address } from '../eth/types.js';

/** Strategy family backing a vault. */
export type VaultStrategy = 'prime-directional' | 'alm' | 'dex-pool';

/** Market direction for directional strategies. */
export type VaultDirection = 'long' | 'short';

/** Registry entry for one deployed vault. */
export interface VaultRegistryEntry {
  /** Vault contract address (ERC-4626-style). */
  address: Address;
  /** Human-readable vault name. */
  name: string;
  /** Vault share token symbol. */
  symbol: string;
  /** Underlying asset (denomination) token address. */
  asset: Address;
  /** Decimals of the underlying asset token. */
  assetDecimals: number;
  /** Strategy family. */
  strategy: VaultStrategy;
  /** Direction (long/short) — meaningful for directional strategies. */
  direction: VaultDirection;
  /** EVM chain id the vault is deployed on. */
  chainId: number;
}

/** USDC on Base (8453), 6 decimals. */
export const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** LevVault implementation on Base. */
export const LEV_VAULT_IMPL_BASE: Address = '0xFF4dCC8C224fD40a850B452afad4CE018AA368A8';

/** LevFactory on Base. */
export const LEV_FACTORY_BASE: Address = '0x05705Ac3915A094b345629B02D5aa8d52Bb99DDB';

/** Live vault registry. Append-only; order = display order. */
export const VAULTS: readonly VaultRegistryEntry[] = [
  {
    address: '0x0b9CCa59CeFDE03Ad8e41DA272D946861fA7717f',
    name: 'BTC Long Trend',
    symbol: 'BTC-LO-T',
    asset: BASE_USDC,
    assetDecimals: 6,
    strategy: 'prime-directional',
    direction: 'long',
    chainId: 8453,
  },
  {
    address: '0x38FAc67731b3F893d8a26eFE62D33Dd062FBec8D',
    name: 'ETH Long Trend',
    symbol: 'ETH-LO-T',
    asset: BASE_USDC,
    assetDecimals: 6,
    strategy: 'prime-directional',
    direction: 'long',
    chainId: 8453,
  },
] as const;

/** Vaults filtered by chain (all chains when omitted). */
export function getVaultsForChain(chainId?: number): VaultRegistryEntry[] {
  if (chainId === undefined) return [...VAULTS];
  return VAULTS.filter((v) => v.chainId === chainId);
}

/** Lookup by vault address (case-insensitive). */
export function getVault(address?: string): VaultRegistryEntry | undefined {
  if (!address) return undefined;
  const needle = address.toLowerCase();
  return VAULTS.find((v) => v.address.toLowerCase() === needle);
}

/** Lookup by share symbol (exact). */
export function getVaultBySymbol(symbol: string): VaultRegistryEntry | undefined {
  return VAULTS.find((v) => v.symbol === symbol);
}
