/**
 * Deployed Contract Addresses
 *
 * This is the canonical source for all deployed contract addresses.
 * Frontend and other consumers should import from here.
 *
 * Addresses are deterministic via CREATE3 across all chains (Anvil, testnet, mainnet).
 */

import type { Address } from './types';
import { zeroAddress } from './types';

/**
 * @deprecated use `zeroAddress` (viem-style) from `@btr-protocol/sdk/eth`. Kept as alias.
 */
export const ZERO_ADDRESS: Address = zeroAddress;

/**
 * Canonical LiFi Diamond address — same on all supported EVM chains (LiFi deployment doctrine).
 * Single source of truth for the keeper calldata `to` allowlist.
 * @see https://docs.li.fi/smart-contracts/deployments
 */
export const LIFI_DIAMOND: Address = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE';

// ─────────────────────────────────────────────────────────────
// Contract Addresses by Chain
// ─────────────────────────────────────────────────────────────

export const CONTRACTS = {
  // Localhost (Anvil) - Deterministic CREATE3 addresses
  31337: {
    BTR: ZERO_ADDRESS,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: '0xb7127AE785907441BFBC6C7bDAcC339CD7e2b712' as Address,
    POOL_STABLE: '0xb712dCA09c4327daC7789EA34574783dC554b712' as Address,
    // TODO: real deployment addresses
    POOL_FACTORY: ZERO_ADDRESS,
    ADMIN: ZERO_ADDRESS,
    ACCESS_CONTROL: ZERO_ADDRESS,
    ORACLE: ZERO_ADDRESS,
    FAUCET: ZERO_ADDRESS,
  },

  // Ethereum Mainnet - Deterministic CREATE3 addresses (to be deployed)
  1: {
    BTR: ZERO_ADDRESS,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: ZERO_ADDRESS,
    POOL_STABLE: ZERO_ADDRESS,
    // TODO: real deployment addresses
    POOL_FACTORY: ZERO_ADDRESS,
    ADMIN: ZERO_ADDRESS,
    ACCESS_CONTROL: ZERO_ADDRESS,
    ORACLE: ZERO_ADDRESS,
    FAUCET: ZERO_ADDRESS,
  },

  // BNB Chain - Deterministic CREATE3 addresses (to be deployed)
  56: {
    BTR: ZERO_ADDRESS,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: ZERO_ADDRESS,
    POOL_STABLE: ZERO_ADDRESS,
    // TODO: real deployment addresses
    POOL_FACTORY: ZERO_ADDRESS,
    ADMIN: ZERO_ADDRESS,
    ACCESS_CONTROL: ZERO_ADDRESS,
    ORACLE: ZERO_ADDRESS,
    FAUCET: ZERO_ADDRESS,
  },

  // Base - Deterministic CREATE3 addresses (to be deployed)
  8453: {
    BTR: ZERO_ADDRESS,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: ZERO_ADDRESS,
    POOL_STABLE: ZERO_ADDRESS,
    // TODO: real deployment addresses
    POOL_FACTORY: ZERO_ADDRESS,
    ADMIN: ZERO_ADDRESS,
    ACCESS_CONTROL: ZERO_ADDRESS,
    ORACLE: ZERO_ADDRESS,
    FAUCET: ZERO_ADDRESS,
  },

  // Arbitrum - Deterministic CREATE3 addresses (to be deployed)
  42161: {
    BTR: ZERO_ADDRESS,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: ZERO_ADDRESS,
    POOL_STABLE: ZERO_ADDRESS,
    // TODO: real deployment addresses
    POOL_FACTORY: ZERO_ADDRESS,
    ADMIN: ZERO_ADDRESS,
    ACCESS_CONTROL: ZERO_ADDRESS,
    ORACLE: ZERO_ADDRESS,
    FAUCET: ZERO_ADDRESS,
  },

  // BNB Chain Testnet (Chapel, id 97) — from dex/evm/deployments/97.deploy.json
  97: {
    BTR: ZERO_ADDRESS,
    TREASURY: ZERO_ADDRESS,
    BRIDGE: ZERO_ADDRESS,
    POOL_ZERO: '0x684b1b1B997F28C0724f1225d510bEB5F17C9288' as Address, // volatilePool
    POOL_STABLE: '0x8DB94FE6b4d8808A3069A1F571c10485Eb6fb827' as Address,
    POOL_FACTORY: '0xA459d89201D4482e4467eca8EBD47DE055B33B53' as Address,
    ADMIN: '0x6BF816A11dFA6f83d18Bd3885E3F9eceB2a9d190' as Address,
    ACCESS_CONTROL: '0x626eb915d4a4136F7c00352A54378d3A322488da' as Address,
    ORACLE: '0xD91712c9F4037D0010041691Df191AB45994F2bF' as Address,
    FAUCET: '0x6a901982CE6cD2561F677217e012A33b8a88EF27' as Address,
  },
} as const;

// Init-time guard: literals hide behind `as Address`, so enforce 0x + 40 hex at module load.
for (const [chain, registry] of Object.entries(CONTRACTS)) {
  for (const [name, addr] of Object.entries(registry)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr))
      throw new Error(`CONTRACTS[${chain}].${name}: malformed address ${addr}`);
  }
}

export type SupportedChainId = keyof typeof CONTRACTS;
export type ContractName = keyof (typeof CONTRACTS)[SupportedChainId];

/** DEX singleton keys in the per-chain registry (env-overridable on testnet). */
export const CONTRACT_KEYS = [
  'POOL_FACTORY',
  'ADMIN',
  'ACCESS_CONTROL',
  'ORACLE',
  'FAUCET',
] as const;
export type DexContractKey = (typeof CONTRACT_KEYS)[number];

/**
 * Env var names for overriding ZERO placeholders until chapel/mainnet CREATE3 deploy.
 * Front: prefix with `VITE_` (e.g. `VITE_ADMIN_ADDRESS`). Back/keepers: bare names.
 */
export const CONTRACT_ENV_VARS: Record<DexContractKey, string> = {
  POOL_FACTORY: 'BTR_POOL_FACTORY_ADDRESS',
  ADMIN: 'BTR_ADMIN_ADDRESS',
  ACCESS_CONTROL: 'BTR_ACCESS_CONTROL_ADDRESS',
  ORACLE: 'BTR_ORACLE_ADDRESS',
  FAUCET: 'BTR_FAUCET_ADDRESS',
} as const;

/** Front (Vite) env var names — `VITE_` + bare key suffix used by Safety Control Center. */
export const CONTRACT_VITE_ENV_VARS: Record<DexContractKey, string> = {
  POOL_FACTORY: 'VITE_POOL_FACTORY_ADDRESS',
  ADMIN: 'VITE_ADMIN_ADDRESS',
  ACCESS_CONTROL: 'VITE_ACCESS_CONTROL_ADDRESS',
  ORACLE: 'VITE_ORACLE_ADDRESS',
  FAUCET: 'VITE_FAUCET_ADDRESS',
} as const;

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

export function getContractAddress(
  chainId: number,
  contractName: ContractName,
): Address | undefined {
  const chain = chainId as SupportedChainId;
  return CONTRACTS[chain]?.[contractName];
}

export function isChainSupported(chainId: number): chainId is SupportedChainId {
  return chainId in CONTRACTS;
}

export const SUPPORTED_CONTRACT_CHAIN_IDS = Object.keys(CONTRACTS).map(
  Number,
) as SupportedChainId[];

// ─────────────────────────────────────────────────────────────
// BTR DEX Accessors
// ─────────────────────────────────────────────────────────────

export function getBtrPoolFactory(chainId: number): Address | undefined {
  const chain = chainId as SupportedChainId;
  return CONTRACTS[chain]?.POOL_FACTORY;
}

export function getBtrAdmin(chainId: number): Address | undefined {
  const chain = chainId as SupportedChainId;
  return CONTRACTS[chain]?.ADMIN;
}

export function getBtrAccessControl(chainId: number): Address | undefined {
  const chain = chainId as SupportedChainId;
  return CONTRACTS[chain]?.ACCESS_CONTROL;
}

// ─────────────────────────────────────────────────────────────
// Mock Token Addresses (Anvil Only)
// ─────────────────────────────────────────────────────────────

// These are deterministic CREATE3 addresses from salts/bbbb_bb.txt
export const MOCK_TOKENS: Record<string, Address> = {
  // From salts/bbbb_bb.txt
  mUSDC: '0xbbbb4a42775f9d01fb2870e702c7ed47ed5b04bb' as Address,
  mUSDT: '0xbbbb12e5f2e8682a731202645cf3f863e9a5e2bb' as Address,
  mWETH: '0xbbbb9d6e02822bfe346b42985f54903d16419cbb' as Address,
  mWBTC: '0xbbbb8b9e7794532c28a72cc1513fd7f76257b0bb' as Address,
  mWBNB: '0xbbbb90f51f61bf8b1f96f2528daebdfc321f91bb' as Address,
  mSOL: '0xbbbb1fb625a6fa6f8a03e1b1c6d26a41177bf7bb' as Address,
  mZEC: '0xbbbb9094f5bf727a6144b354029abafb8c384fbb' as Address,
  mPAXG: '0xbbbb91b967c1efe11f0be13b8b191bc6e71ac5bb' as Address,
  mDAI: '0xbbbbe41729d9ad375c979fe8562e05f8036b88bb' as Address,
  mTUSD: '0xbbbb4cd51926fd22943de93f5f2768e01a8da0bb' as Address,
  mFDUSD: '0xbbbb74a69995f2fe9b7f4ea221f6f790646ca5bb' as Address,
  mUSDD: '0xbbbb9a634fdb18b322a898b871e3332c6668c3bb' as Address,
  mUSDP: '0xbbbbe1658df7d5cf39ef7d538f111eadf69fe2bb' as Address,
  mcrvUSD: '0xbbbbbb9e631883d249240201322470fb55ff27bb' as Address,
  mlisUSD: '0xbbbb4a42775f9d01fb2870e702c7ed47ed5b04bb' as Address, // Reuse mUSDC salt
  mAUSD: '0xbbbb12e5f2e8682a731202645cf3f863e9a5e2bb' as Address, // Reuse mUSDT salt
  mfrxUSD: '0xbbbb9d6e02822bfe346b42985f54903d16419cbb' as Address, // Reuse mWETH salt
};
