/**
 * Vaults registry
 * @module @btr-protocol/sdk/vaults
 *
 * Canonical typed registry of live BTR vaults across chains. Single source for
 * front/back/keepers — do NOT hardcode vault addresses or counts elsewhere; new
 * vaults (e.g. BTC-SO-T) appear here and consumers pick them up automatically.
 */

import type { Address } from '../eth/types.js';

/** Strategy family backing a vault.
 *
 * `'prime-directional'` is retained as a dormant union member only — BTR is
 * ALM-only and no live vault uses it. Kept so downstream `Record<VaultStrategy>`
 * maps stay valid without churn; no registry row references it. */
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

/** Live vault registry. Append-only; order = display order.
 *
 * Empty: the leveraged-directional (`prime-directional`) vaults were removed
 * when BTR became ALM-only. ALM/DEX vaults appear here once deployed. */
export const VAULTS: readonly VaultRegistryEntry[] = [] as const;

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
