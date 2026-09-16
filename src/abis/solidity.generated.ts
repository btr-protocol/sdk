// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.

/**
 * Solidity enum ordinals and internal constants
 * @module @btr-protocol/sdk/abis
 *
 * solc keeps neither in the ABI, so neither can be fetched the way `POOL_ABI` is: this file is
 * MAINTAINED BY HAND against the declaring `.sol`. What keeps it honest is
 * `test/solidity-mirror.test.ts`, which parses those files and fails on any divergence — it is
 * how `SWEEP` and `BACKFILL_LEGS` were found missing. Never hand-write an ordinal without running
 * it: `OpType` is grouped by timelock tier and `Resource` by meaning, so both renumber whenever a
 * member joins a group.
 */

/** Second arg of `Admin.requestOp` / `execute` / `cancelTimelock`. Grouped by timelock tier, so a member added to a group SHIFTS every ordinal after it.
 */
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
  /** Payload = the token address only; the amount is recomputed at execute. Pays out to
   *  `treasury()`, so `Admin._tier` puts it on the HIGH (treasury-custody) lane. */
  SWEEP: 11,
  /** One-shot per pool: arms pool-level solvency by writing the leg roster. CRITICAL lane. */
  BACKFILL_LEGS: 12,
  /** Seat handover (GEN-1). Pool-level key, GOVERNANCE tier; payload = the next seat.
   *  Staging the live owner is normalised to the sentinel donation at request time. */
  UPDATE_POOL_ADMIN: 13,
} as const;
export type OpType = (typeof OpType)[keyof typeof OpType];

/** Risk-op selector for `Admin.batchRiskOp`.
 */
export const BatchOp = {
  HALT: 0,
  UNHALT: 1,
} as const;
export type BatchOp = (typeof BatchOp)[keyof typeof BatchOp];

/** Subsystem tag carried by `Err.NotFound` / `Err.FeatureDisabled` and friends. Ordered by MEANING, so ordinals move when a member joins its group.
 */
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

/** Index into the packed `AccessControl.GOV_DELAYS()` word (8 x uint32 seconds). See `govDelays` in src/governance.
 */
export const Tier = {
  GOVERNANCE: 0,
  LISTING: 1,
  TUNING: 2,
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

/** Key of `AccessControl.pendingRole` and of `queueRole`/`executeRole`/`cancelRole`.
 */
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

// On-chain library constants.
export const HALT_RISK_BIT = 1;
export const HALT_GUARDIAN_BIT = 64;
export const HALT_ANCHOR_BIT = 128;
export const HALT_MASK = 193;
export const HALT_SETTABLE_MASK = 65;
export const SWAP_ENABLED_BIT = 2;
export const LIABILITY_SWAP_ENABLED_BIT = 4;
export const FLASH_ENABLED_BIT = 16;
export const FEED_HALT_BIT = 1;
export const MAX_CONFIDENCE_HALT_BPS = 1000;
export const MAX_DISPERSION_PBPS = 900000;
export const HOOK_PRE_OUTFLOW = 1;
export const HOOK_POST_INFLOW = 2;

// On-chain library constants.
export const STALE_Z = 472;
export const STALE_GRACE_CAP_SECS = 30;

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
