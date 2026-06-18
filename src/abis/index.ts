/**
 * Contract ABIs
 * @module @btr-protocol/sdk/abis
 *
 * Canonical source of all contract ABIs used across the project.
 * Post-Phase 42H: Diamond removed; Admin/Staking/Distributor/Flash are singletons
 * with `pool` as first arg of pool-scoped fns. Pool surface is flat. PoolFactory
 * deploys EIP-1167 minimal-clones.
 *
 * Phase 42K.10D Pass-31 R31-5: ALM surface (Vault, Dex, BtrPoolAdapter, Factory,
 * Swapper, AccessControl, PriceProvider) added alongside DEX exports + shared Treasury.
 */

// DEX surface
export * from './Admin.js';
export * from './Bridge.js';
export * from './BridgeableERC20.js';
export * from './Distributor.js';
export * from './Flash.js';
export * from './GovToken.js';
export * from './Pool.js';
export * from './PoolFactory.js';
export * from './Router.js';
export * from './Staking.js';
export * from './StakedGov.js';
export * from './StakedLP.js';
export * from './Treasury.js';

// ALM surface (Pass-31 R31-5)
export * from './Vault.js';
export * from './Dex.js';
export * from './BtrPoolAdapter.js';
export * from './Factory.js';
export * from './Swapper.js';
export * from './AccessControl.js';
export * from './PriceProvider.js';
