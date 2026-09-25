/**
 * Deployed Contract Addresses
 *
 * This is the canonical source for all deployed contract addresses.
 * Frontend and other consumers should import from here.
 *
 * PLACEHOLDER REGISTRY. This is not the source of truth for deployed addresses and nothing
 * should be wired to it: there is no 5042002 key, so CONTRACTS[5042002] is undefined on the
 * only chain BTR is deployed to, and every DEX address on the chains listed below is
 * zeroAddress. The real source of truth for deployed addresses is the backend venues API
 * (`GET {api}/v1/venues`), which the front end consumes directly.
 *
 * Pool proxies are ERC-1967 beacon proxies pointing at `PoolFactory` itself (the factory IS the
 * beacon). `PoolFactory.createPool(salt, ...)` mints them through the CREATE3 factory with the
 * PoolFactory as the sender, so a pool address is `f(create3Factory, poolFactory, salt)`: the base
 * token and the roster are mutable state and are not in it, and one salt lands on one address on
 * every chain of a fleet. `predictPool(salt)` derives it off chain. Singletons are CREATE3 from the
 * deployer EOA instead, so they do NOT share that property across fleets. Mock tokens are plain
 * nonce-ordered CREATE.
 */

import type { Address } from './types';
import { zeroAddress } from './types';

// ─────────────────────────────────────────────────────────────
// Contract Addresses by Chain
// ─────────────────────────────────────────────────────────────

export const CONTRACTS = {
  // Localhost (Anvil) - placeholder addresses, not deployed
  31337: {
    BTR: zeroAddress,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: zeroAddress,
    POOL_ZERO: '0xb7127AE785907441BFBC6C7bDAcC339CD7e2b712' as Address,
    POOL_STABLE: '0xb712dCA09c4327daC7789EA34574783dC554b712' as Address,
    // TODO: real deployment addresses
    POOL_FACTORY: zeroAddress,
    ADMIN: zeroAddress,
    ACCESS_CONTROL: zeroAddress,
    ORACLE: zeroAddress,
    STAKING: zeroAddress,
    DISTRIBUTOR: zeroAddress,
    FAUCET: zeroAddress,
  },

  // Ethereum Mainnet - placeholder addresses, not deployed (to be deployed)
  1: {
    BTR: zeroAddress,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: zeroAddress,
    POOL_ZERO: zeroAddress,
    POOL_STABLE: zeroAddress,
    // TODO: real deployment addresses
    POOL_FACTORY: zeroAddress,
    ADMIN: zeroAddress,
    ACCESS_CONTROL: zeroAddress,
    ORACLE: zeroAddress,
    STAKING: zeroAddress,
    DISTRIBUTOR: zeroAddress,
    FAUCET: zeroAddress,
  },

  // BNB Chain - placeholder addresses, not deployed (to be deployed)
  56: {
    BTR: zeroAddress,
    // deployments/bnb.manifest.json `.roles.treasury`; never the deployer EOA.
    TREASURY: '0x0E7A1152074492649a126DC1b931B635bf54c8Fb' as Address,
    BRIDGE: zeroAddress,
    POOL_ZERO: zeroAddress,
    POOL_STABLE: zeroAddress,
    // TODO: real deployment addresses
    POOL_FACTORY: zeroAddress,
    ADMIN: zeroAddress,
    ACCESS_CONTROL: zeroAddress,
    ORACLE: zeroAddress,
    STAKING: zeroAddress,
    DISTRIBUTOR: zeroAddress,
    FAUCET: zeroAddress,
  },

  // Base - placeholder addresses, not deployed (to be deployed)
  8453: {
    BTR: zeroAddress,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: zeroAddress,
    POOL_ZERO: zeroAddress,
    POOL_STABLE: zeroAddress,
    // TODO: real deployment addresses
    POOL_FACTORY: zeroAddress,
    ADMIN: zeroAddress,
    ACCESS_CONTROL: zeroAddress,
    ORACLE: zeroAddress,
    STAKING: zeroAddress,
    DISTRIBUTOR: zeroAddress,
    FAUCET: zeroAddress,
  },

  // Arbitrum - placeholder addresses, not deployed (to be deployed)
  42161: {
    BTR: zeroAddress,
    TREASURY: '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3' as Address,
    BRIDGE: zeroAddress,
    POOL_ZERO: zeroAddress,
    POOL_STABLE: zeroAddress,
    // TODO: real deployment addresses
    POOL_FACTORY: zeroAddress,
    ADMIN: zeroAddress,
    ACCESS_CONTROL: zeroAddress,
    ORACLE: zeroAddress,
    STAKING: zeroAddress,
    DISTRIBUTOR: zeroAddress,
    FAUCET: zeroAddress,
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
type ContractName = keyof (typeof CONTRACTS)[SupportedChainId];

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
