/**
 * PoolStorage slot readers — Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`). Mapping bases:
 *   assets=4, oracleConfigs=5, riskConfigs=6, profiles=7, …
 * Key = keccak256(abi.encode(token, mappingSlot)) — same as Solidity 0.8.
 *
 * Off-chain ONLY. On-chain consumers (Flash / hooks) keep thin view fns they need.
 * Policy: dex/evm/README.md § "Off-chain reads (no storage getters)".
 */

import { encodeAbiParameters } from '../eth/abi.js';
import { bytesToHex, hexToBytes, keccak256 } from '../eth/index.js';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';

/** EIP-7528 native sentinel + Solidity address(0) — both map to PoolStorage.wnative. */
const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function isNativeKey(token: Address): boolean {
  const t = token.toLowerCase();
  return t === NATIVE_SENTINEL || t === ZERO_ADDR;
}

/** Absolute slots of `IPool.PoolStorage` fields (pinned by PoolStorageLayout.t.sol). */
export const POOL_STORAGE = {
  baseToken: 0n,
  wnative: 1n,
  bridge: 2n,
  treasuryInitialized: 3n,
  assets: 4n,
  oracleConfigs: 5n,
  riskConfigs: 6n,
  profiles: 7n,
  lpBalances: 8n,
  protocolFees: 9n,
  feeParams: 10n,
  // 11 reserved by FeeParams packing (64 B → 2 slots)
  flowCooldownSeconds: 12n,
  lastDepositTime: 13n,
  lastLPStakeTime: 14n,
  baseTokenOracle: 15n,
  baseTokenFeedId: 16n,
  factory: 17n,
  assetHooks: 18n,
  invested: 19n,
} as const;

/**
 * Per-asset yield-hook flag bits — canonical mirror of dex `libraries/Constants.sol`
 * (verified exact: HOOK_PRE_OUTFLOW=1<<0, HOOK_POST_INFLOW=1<<1). SSoT for back/front.
 * Pool dispatches a hook CALL only when `HookSlot.target != 0` AND the matching bit is set.
 */
export const HOOK_PRE_OUTFLOW = 1 << 0;
export const HOOK_POST_INFLOW = 1 << 1;
/** Known-bits mask; dex rejects unknown bits at adminSetAssetHook. */
export const HOOK_FLAGS_MASK = HOOK_PRE_OUTFLOW | HOOK_POST_INFLOW;

export interface LiquidityProfile {
  weights: number[];
  knots: number[];
}

export interface RiskConfig {
  decayStartRatioBps: number;
  coverageMin: number;
  coverageMax: number;
  decaySlope: number;
  depthAmplifier: number;
  flags: number;
  kappaCovBps: number;
}

export interface OracleConfig {
  feedId: Hex;
  refFeedId: Hex;
  primary: Address;
  refBandBps: number;
  mode: number;
}

/** Mapping entry base slot: keccak256(abi.encode(key, mappingSlot)). */
export function mappingBase(key: Address, mappingSlot: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [key, mappingSlot],
  );
  return BigInt(keccak256(encoded));
}

/**
 * Resolve the storage mapping key for a token. Native (EIP-7528 / address(0)) is stored under
 * `PoolStorage.wnative` — same as Solidity deposit/swap paths that wrap before mapping lookup.
 */
export async function resolveTokenStorageKey(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<Address> {
  if (!isNativeKey(token)) return token;
  const word = await getStorageAt(provider, pool, POOL_STORAGE.wnative);
  return addressAt(word, 0);
}

export async function getStorageAt(
  provider: Eip1193Provider,
  address: Address,
  slot: bigint,
): Promise<Hex> {
  const slotHex = `0x${slot.toString(16).padStart(64, '0')}` as Hex;
  return (await provider.request({
    method: 'eth_getStorageAt',
    params: [address, slotHex, 'latest'],
  })) as Hex;
}

/** Read a uint16 packed at `offset` bytes into a 32-byte storage word (LSB-aligned). */
export function u16At(word: Hex, offset: number): number {
  const b = hexToBytes(word.slice(2));
  const i = 32 - offset - 2;
  return (b[i]! << 8) | b[i + 1]!;
}

export function u32At(word: Hex, offset: number): number {
  const b = hexToBytes(word.slice(2));
  const i = 32 - offset - 4;
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

export function u8At(word: Hex, offset: number): number {
  const b = hexToBytes(word.slice(2));
  return b[32 - offset - 1]!;
}

export function i8At(word: Hex, offset: number): number {
  const u = u8At(word, offset);
  return u > 127 ? u - 256 : u;
}

export function addressAt(word: Hex, offset: number): Address {
  const b = hexToBytes(word.slice(2));
  const i = 32 - offset - 20;
  return (`0x${bytesToHex(b.slice(i, i + 20))}`) as Address;
}

export async function readLiquidityProfile(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<LiquidityProfile> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const base = mappingBase(key, POOL_STORAGE.profiles);
  const [wWord, kWord] = await Promise.all([
    getStorageAt(provider, pool, base),
    getStorageAt(provider, pool, base + 1n),
  ]);
  const rawW = Array.from({ length: 16 }, (_, i) => u8At(wWord, i));
  let n = 16;
  while (n > 0 && rawW[n - 1] === 0) n--;
  const weights = rawW.slice(0, n);
  const knots: number[] = [];
  const nKnots = Math.max(weights.length + 1, 0);
  for (let i = 0; i < nKnots && i < 17; i++) {
    knots.push(i8At(kWord, i));
  }
  return { weights, knots };
}

export async function readRiskConfig(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<RiskConfig> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const word = await getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE.riskConfigs));
  return {
    decayStartRatioBps: u16At(word, 0),
    coverageMin: u16At(word, 2),
    coverageMax: u16At(word, 4),
    decaySlope: u32At(word, 6),
    depthAmplifier: u16At(word, 10),
    flags: u16At(word, 12),
    kappaCovBps: u16At(word, 14),
  };
}

export async function readOracleConfig(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<OracleConfig> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const base = mappingBase(key, POOL_STORAGE.oracleConfigs);
  const [feedId, refFeedId, packed] = await Promise.all([
    getStorageAt(provider, pool, base),
    getStorageAt(provider, pool, base + 1n),
    getStorageAt(provider, pool, base + 2n),
  ]);
  return {
    feedId,
    refFeedId,
    primary: addressAt(packed, 0),
    refBandBps: u16At(packed, 20),
    mode: u8At(packed, 22),
  };
}
