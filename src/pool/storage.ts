/**
 * PoolStorage slot readers — Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`), pinned by dex PoolStorageLayout.t.sol:
 *   slot0 = baseToken|initialized, 1 = wnative, 2 = treasury; mappings assets=3,
 *   oracleConfigs=4, riskConfigs=5, curves=6, lpBalances=7, protocolFees=8;
 *   feeParams=9, flowCooldownSeconds=10, lastDepositTime=11, lastLPStakeTime=12,
 *   factory=13, assetHooks=14, invested=15.
 * Key = keccak256(abi.encode(key, mappingSlot)) — same as Solidity 0.8.
 *
 * Off-chain ONLY. On-chain consumers (Flash / hooks) keep thin view fns they need.
 * Policy: dex/evm/README.md § "Off-chain reads (no storage getters)".
 */

import type { QuarticCurve, QuarticSeg } from '../amm/aimm.js';
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
  /** Packed: baseToken (address, bytes 0..19) + initialized (bool @ byte 20). */
  baseToken: 0n,
  wnative: 1n,
  treasury: 2n,
  assets: 3n,
  oracleConfigs: 4n,
  riskConfigs: 5n,
  curves: 6n,
  lpBalances: 7n,
  protocolFees: 8n,
  feeParams: 9n,
  flowCooldownSeconds: 10n,
  lastDepositTime: 11n,
  lastLPStakeTime: 12n,
  factory: 13n,
  assetHooks: 14n,
  invested: 15n,
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

/** Decoded `IPool.HookSlot { address target; uint32 flags }` (single packed storage word). */
export interface HookSlot {
  target: Address;
  flags: number;
}

/** Decode a packed HookSlot word: target @ byte offset 0 (low 20B), uint32 flags @ offset 20. */
export function decodeHookSlot(word: Hex): HookSlot {
  return { target: addressAt(word, 0), flags: u32At(word, 20) };
}

/** Read the per-asset HookSlot (assetHooks mapping, slot 15). `target == address(0)` ⇒ no hook. */
export async function readAssetHook(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<HookSlot> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const word = await getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE.assetHooks));
  return decodeHookSlot(word);
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
  /** Ref-band oracle instance (independent signer set); zero address = legacy fallback to primary. */
  refPrimary: Address;
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
  return `0x${bytesToHex(b.slice(i, i + 20))}` as Address;
}

/** Mapping entry base slot for a uint16 key (curves preset table). */
export function mappingBaseU16(key: number, mappingSlot: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(key), mappingSlot],
  );
  return BigInt(keccak256(encoded));
}

/** Signed int64 packed at bit offset `shift` in a storage word. */
function i64AtBits(word: bigint, shift: number): bigint {
  const u = (word >> BigInt(shift)) & 0xffffffffffffffffn;
  return u >= 1n << 63n ? u - (1n << 64n) : u;
}

/**
 * Read the asset's pricing-shape pointer (Asset slot 1, bits [224:240), byte 28): presetId into
 * `PoolStorage.curves`. 0 = no preset (fallback quote).
 */
export async function readAssetPresetId(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<number> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const word = await getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE.assets) + 1n);
  // Asset slot 1: minLiquidity[0:16) liquidityIndex[16:24) lastUpdate[24:28) presetId[28:30).
  return u16At(word, 28);
}

/**
 * Read + decode a shared preset curve (`NUQuartic.Curve` @ curves[presetId], slot 6):
 * header slot + the 2m live segment slots (of the fixed uint256[28] block). Returns null when
 * the preset is unset (header 0 — Pricing falls back to the linear-impact quote).
 * Curve type/eval: `QuarticCurve` + `evalQ`/`areaQ` in `@sdk/amm`.
 */
export async function readCurve(
  provider: Eip1193Provider,
  pool: Address,
  presetId: number,
): Promise<QuarticCurve | null> {
  const base = mappingBaseU16(presetId, POOL_STORAGE.curves);
  const header = BigInt(await getStorageAt(provider, pool, base));
  if (header === 0n) return null;
  const m = Number(header & 0xffn);
  const boundaries: number[] = [];
  for (let j = 1; j <= m; j++) {
    boundaries.push(Number((header >> BigInt(8 + 16 * (j - 1))) & 0xffffn));
  }
  const dispRef = Number((header >> 232n) & 0xffffn);
  const flags = Number((header >> 248n) & 0xffn);
  const words = await Promise.all(
    Array.from({ length: 2 * m }, (_, i) => getStorageAt(provider, pool, base + 1n + BigInt(i))),
  );
  const segs: QuarticSeg[] = [];
  for (let i = 0; i < m; i++) {
    const a = BigInt(words[2 * i]);
    const b = BigInt(words[2 * i + 1]);
    const sRaw = (b >> 64n) & ((1n << 128n) - 1n);
    segs.push({
      c0: i64AtBits(a, 0),
      c1: i64AtBits(a, 64),
      c2: i64AtBits(a, 128),
      c3: i64AtBits(a, 192),
      c4: i64AtBits(b, 0),
      S: sRaw >= 1n << 127n ? sRaw - (1n << 128n) : sRaw,
    });
  }
  return { m, boundaries, dispRef, flags, segs };
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
  // Slots: 0=feedId, 1=refFeedId, 2=primary|refBandBps|mode (packed), 3=refPrimary (appended last).
  const [feedId, refFeedId, packed, refWord] = await Promise.all([
    getStorageAt(provider, pool, base),
    getStorageAt(provider, pool, base + 1n),
    getStorageAt(provider, pool, base + 2n),
    getStorageAt(provider, pool, base + 3n),
  ]);
  return {
    feedId,
    refFeedId,
    primary: addressAt(packed, 0),
    refBandBps: u16At(packed, 20),
    mode: u8At(packed, 22),
    refPrimary: addressAt(refWord, 0),
  };
}
