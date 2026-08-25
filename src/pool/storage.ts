/**
 * PoolStorage slot readers — Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`). `POOL_STORAGE` (slots) and `POOL_STRUCTS`
 * (in-struct [slot, byteOffset]) are GENERATED from solc's own `storageLayout` — they are the only
 * place either number appears, and every decoder reads them. An ABI diff cannot see packing, so
 * `bun run gen:check` (generated files vs artifacts), not test/abi-freshness.test.ts, is what
 * catches a repack; `src/pool/storage.test.ts` restates the numbers by hand as an offline pin.
 * Key = keccak256(abi.encode(key, mappingSlot)) — same as Solidity 0.8.
 *
 * Off-chain ONLY. On-chain consumers (Flash / hooks) keep thin view fns they need.
 * Policy: dex/evm/README.md § "Off-chain reads (no storage getters)".
 */

import { BPS, type QuarticCurve, type QuarticSeg } from '../amm/aimm.js';
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

/**
 * Slot and packing tables, generated from dex/evm's compiled `storageLayout` — solc's own numbers,
 * so a repack cannot silently desync them. Re-exported here because every decoder below reads them
 * and callers import them from this module.
 */
import { HOOK_POST_INFLOW, HOOK_PRE_OUTFLOW } from '../abis/solidity.generated.js';
import { POOL_STORAGE, POOL_STRUCTS } from './layout.generated.js';

export { POOL_MAPPINGS, POOL_STORAGE, POOL_STRUCTS } from './layout.generated.js';

/**
 * Per-asset yield-hook flag bits, generated from dex `libraries/PoolConstantsLib.sol`. Pool
 * dispatches a hook CALL only when `HookSlot.target != 0` AND the matching bit is set.
 */
export { HOOK_POST_INFLOW, HOOK_PRE_OUTFLOW };
/** Known-bits mask; dex rejects unknown bits at adminSetAssetHook. */
export const HOOK_FLAGS_MASK = HOOK_PRE_OUTFLOW | HOOK_POST_INFLOW;

/** Decoded `IPool.HookSlot` (single packed storage word). */
export interface HookSlot {
  target: Address;
  flags: number;
  /** Unix seconds of the last `hookCreditYield` rate bucket; 0 until the leg is seeded. */
  lastCreditAt: number;
}

/** Decode a packed HookSlot word (offsets: POOL_STRUCTS.HookSlot). */
export function decodeHookSlot(word: Hex): HookSlot {
  const f = POOL_STRUCTS.HookSlot;
  return {
    target: addressAt(word, f.target[1]),
    flags: u32At(word, f.flags[1]),
    lastCreditAt: u32At(word, f.lastCreditAt[1]),
  };
}

/** Read the per-asset HookSlot (assetHooks mapping). `target == address(0)` ⇒ no hook. */
export async function readAssetHook(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<HookSlot> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const word = await getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE.assetHooks));
  return decodeHookSlot(word);
}

/** `IPool.RiskConfig` — 2×uint16. Still an ABI/memory type (`getAsset` returns both fields), but
 *  no longer a storage struct of its own: both fields live in `Asset` slot 2. */
export interface RiskConfig {
  flags: number;
  /** κ (bps): convex coverage-wall strength. 0 = off (volatiles). */
  kappaCovBps: number;
}

export interface OracleConfig {
  feedId: Hex;
  refFeedId: Hex;
  primary: Address;
  refBandBps: number;
  mode: number;
  /**
   * DEN-01 mark denomination (`uint8`, the byte the former `bool usdQuoted` occupied):
   * 0 = ANCHOR_UNIT (mark already in anchor units), 1 = UNIT_OF_ACCOUNT (`<TOKEN>-USD`, so the
   * pool divides by the base's own USD mark at consumption).
   */
  quoteUnit: number;
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

/** `NUQuartic.Curve.segs` is a fixed uint256[28] block (m ≤ 14 → 2m live words). */
export const CURVE_SEG_SLOTS = 28;

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
 * Read the asset's pricing-shape pointer (`Asset.presetId`): index into `PoolStorage.curves`.
 * 0 = no preset (fallback quote).
 */
export async function readAssetPresetId(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<number> {
  const [slot, offset] = POOL_STRUCTS.Asset.presetId;
  const key = await resolveTokenStorageKey(provider, pool, token);
  const word = await getStorageAt(
    provider,
    pool,
    mappingBase(key, POOL_STORAGE.assets) + BigInt(slot),
  );
  return u16At(word, offset);
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
  // ONE transport round-trip: the segment block is a FIXED uint256[28] slot run (m ≤ 14), so the
  // header and every possible segment word are fetched speculatively together. The transport's
  // tick-batch coalesces these into a single JSON-RPC POST; per-slot eth_getStorageAt cannot ride
  // Multicall3 aggregate3 (raw storage, no view getter by policy - see module header). The old
  // header-first read cost two sequential round-trips per curve.
  const words = await Promise.all(
    Array.from({ length: 1 + CURVE_SEG_SLOTS }, (_, i) =>
      getStorageAt(provider, pool, base + BigInt(i)),
    ),
  );
  const header = BigInt(words[0]);
  if (header === 0n) return null;
  const m = Number(header & 0xffn);
  // The directory holds the m-1 INTERIOR boundaries only; the last right edge is the BPS constant,
  // never stored (NUQuartic.set: "interior boundaries only; b_m = SC.BPS"). Those freed bits carry
  // the median at 216, so reading m entries here both loses b_m and mis-reads the median as one.
  const boundaries: number[] = [];
  for (let j = 1; j < m; j++) {
    boundaries.push(Number((header >> BigInt(8 + 16 * (j - 1))) & 0xffffn));
  }
  boundaries.push(BPS);
  const dispRef = Number((header >> 232n) & 0xffffn);
  const flags = Number((header >> 248n) & 0xffn);
  const segs: QuarticSeg[] = [];
  for (let i = 0; i < m; i++) {
    const a = BigInt(words[1 + 2 * i]);
    const b = BigInt(words[2 + 2 * i]);
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

/**
 * Per-leg risk fields. The `riskConfigs` mapping is GONE — `flags` and `kappaCovBps` were folded
 * into `Asset` slot 2 — so this reads that word instead. Kept as its own function rather than
 * folded into `getAsset` because it is one raw `eth_getStorageAt` against a slot the SDK already
 * pins, where `getAsset` is a full `eth_call` returning fourteen fields; callers that want only
 * the coverage wall (front's per-asset risk cache) should not pay for the rest.
 */
export async function readRiskConfig(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<RiskConfig> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const f = POOL_STRUCTS.Asset;
  const word = await getStorageAt(
    provider,
    pool,
    mappingBase(key, POOL_STORAGE.assets) + BigInt(f.flags[0]),
  );
  return {
    flags: u16At(word, f.flags[1]),
    kappaCovBps: u16At(word, f.kappaCovBps[1]),
  };
}

export async function readOracleConfig(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<OracleConfig> {
  const key = await resolveTokenStorageKey(provider, pool, token);
  const base = mappingBase(key, POOL_STORAGE.oracleConfigs);
  const f = POOL_STRUCTS.OracleConfig;
  // Slots: 0=feedId, 1=refFeedId, 2=primary|refBandBps|mode|quoteUnit (packed), 3=refPrimary.
  const at = (slot: number) => getStorageAt(provider, pool, base + BigInt(slot));
  const [feedId, refFeedId, packed, refWord] = await Promise.all([
    at(f.feedId[0]),
    at(f.refFeedId[0]),
    at(f.primary[0]),
    at(f.refPrimary[0]),
  ]);
  return {
    feedId,
    refFeedId,
    primary: addressAt(packed, f.primary[1]),
    refBandBps: u16At(packed, f.refBandBps[1]),
    mode: u8At(packed, f.mode[1]),
    quoteUnit: u8At(packed, f.quoteUnit[1]),
    refPrimary: addressAt(refWord, f.refPrimary[1]),
  };
}
