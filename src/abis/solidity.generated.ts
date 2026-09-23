// GENERATED from dex-evm/abi/constants.json by `bun scripts/gen-constants.ts`. Do not edit.

/**
 * Solidity enum ordinals and internal constants
 * @module @btr-protocol/sdk/abis
 *
 * solc keeps neither in the ABI, so neither can be fetched the way `POOL_ABI` is. dex-evm
 * publishes them from its own sources as `abi/constants.json`; this file is that JSON, typed.
 * `test/solidity-mirror.test.ts` re-parses the declaring `.sol` and fails on any divergence.
 */

/** Risk-op selector for `Admin.batchRiskOp`. */
export const BatchOp = {
  HALT: 0,
  UNHALT: 1,
} as const;
export type BatchOp = (typeof BatchOp)[keyof typeof BatchOp];

/** Second arg of `Admin.requestOp` / `execute` / `cancelOp`. Grouped by timelock tier, so a member added to a group SHIFTS every ordinal after it. */
export const OpType = {
  NONE: 0,
  MIGRATE_BASE_TOKEN: 1,
  UPDATE_ANCHOR: 2,
  UPDATE_TREASURY: 3,
  UPDATE_HOOK: 4,
  ADD_ASSET: 5,
  UPDATE_RISK: 6,
  UPDATE_FEES: 7,
  UPDATE_PROFILE: 8,
  UPDATE_CURVE: 9,
  UPDATE_ASSET_PARAMS: 10,
  SWEEP: 11,
  BACKFILL_LEGS: 12,
  UPDATE_POOL_ADMIN: 13,
} as const;
export type OpType = (typeof OpType)[keyof typeof OpType];

/** Subsystem tag carried by `Err.NotFound` / `Err.FeatureDisabled` and friends. Ordered by MEANING, so ordinals move when a member joins its group. */
export const Resource = {
  ASSET: 0,
  ORACLE: 1,
  FEED: 2,
  TREASURY: 3,
  GOVERNANCE: 4,
  SWAP: 5,
  LIABILITY_SWAP: 6,
  FLASH: 7,
  TRANSFER: 8,
} as const;
export type Resource = (typeof Resource)[keyof typeof Resource];

/** Key of `AccessControl.pendingRole` and of `queueRole`/`executeRole`/`cancelRole`. */
export const Role = {
  NONE: 0,
  FACTORY: 1,
  TREASURY: 2,
  OWNER: 3,
  RISK_STEWARD: 4,
  GUARDIAN: 5,
  GUARDIAN_REVOKE: 6,
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Index into the packed `AccessControl.GOV_DELAYS()` word (3 x uint32 seconds). See `govDelays` in src/governance. */
export const Tier = {
  GOVERNANCE: 0,
  LISTING: 1,
  TUNING: 2,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

// `Asset.flags` / `RiskConfig.flags` bits and masks (PoolConstantsLib).
export const DEPOSIT_GATED_BIT = 512;
export const ENABLE_MASK = 112;
export const FEED_HALT_BIT = 1;
export const FLASH_ENABLED_BIT = 64;
export const GATE_MASK = 1536;
export const HALT_ANCHOR_BIT = 4;
export const HALT_GUARDIAN_BIT = 2;
export const HALT_MASK = 7;
export const HALT_RISK_BIT = 1;
export const HALT_SETTABLE_MASK = 3;
export const HOOK_FLAGS_MASK = 3;
export const HOOK_POST_INFLOW = 2;
export const HOOK_PRE_OUTFLOW = 1;
export const KNOWN_FLAGS_MASK = 1911;
export const LIABILITY_SWAP_ENABLED_BIT = 32;
export const SWAP_ENABLED_BIT = 16;
export const SWAP_GATED_BIT = 1024;
export const TOKEN_EXOTIC_BIT = 256;

// Pool wire constants (PoolConstantsLib).
export const INDEX_REASON_DONATE = 0;
export const INDEX_REASON_FEE = 4;
export const INDEX_REASON_WRITEDOWN = 3;
export const INDEX_REASON_YIELD = 1;
export const MAX_CONFIDENCE_HALT_BPS = 1000;
export const MAX_DISPERSION_PBPS = 900000;
export const ORACLE_MODE_EXTERNAL = 0;
export const ORACLE_MODE_INTERNAL = 1;
export const QUOTE_UNIT_ANCHOR = 0;
export const QUOTE_UNIT_UOA = 1;

// Staleness (PricingLib).
export const MAX_STALE_GRACE_SECS = 30;
export const STALE_Z = 472;

// `AccessControl.perms` lanes (ConstantsLib). Bits 0-15 are the leg gate bits themselves (DEPOSIT_GATED, SWAP_GATED); Arc's AccessControl predates the word, see `acGeneration`.
export const PERM_GUARDIAN = 131072;
export const PERM_INSTANT = 131071;
export const PERM_KEEPER = 65536;
export const PERM_RISK_STEWARD = 262144;

/** Packed `ConstantsLib` timelock schedules, seconds per `Tier`. */
export const GOV_DELAYS = {
  PROD_DELAYS: {
    GOVERNANCE: 604800,
    LISTING: 86400,
    TUNING: 3600,
  },
  TESTNET_DELAYS: {
    GOVERNANCE: 21600,
    LISTING: 7200,
    TUNING: 3600,
  },
} as const;

/**
 * Ops whose timelock key ignores `subject` (`Admin._keyOf` returns `_key(pool, opId)`). Every
 * other op keys on `(pool, opId, subject)`, so cancelling one with `subject = 0` computes a key
 * nothing was queued under and reverts `NoPending` instead of vetoing.
 */
export const POOL_SCOPED_OPS: readonly OpType[] = [
  OpType.MIGRATE_BASE_TOKEN,
  OpType.UPDATE_TREASURY,
  OpType.UPDATE_FEES,
  OpType.UPDATE_POOL_ADMIN,
];
