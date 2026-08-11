/**
 * PoolStorage slot readers — Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`), pinned by dex PoolStorageLayout.t.sol.
 * `POOL_STORAGE` (slots) and `POOL_STRUCTS` (in-struct [slot, byteOffset]) below are the ONLY
 * place either number appears — every decoder reads them — and both tables are asserted
 * field-by-field against the `storageLayout` of dex/evm's forge artifacts by
 * test/storage-layout.test.ts.
 * An ABI diff cannot see packing, so that test, not test/abi-freshness.test.ts, is what catches
 * a repack.
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
  /** Packed word: baseToken + initialized + protoShare + flashFeePbps + flowCooldownSeconds. */
  baseToken: 0n,
  initialized: 0n,
  protoShare: 0n,
  flashFeePbps: 0n,
  flowCooldownSeconds: 0n,
  wnative: 1n,
  treasury: 2n,
  factory: 3n,
  assets: 4n,
  oracleConfigs: 5n,
  riskConfigs: 6n,
  curves: 7n,
  protocolFees: 8n,
  /** Per-leg `HookSlot`: target + flags + the `hookCreditYield` clock, one word. */
  assetHooks: 9n,
  invested: 10n,
  /** Per-leg ERC-20 receipt registry: `mapping(leg => LPToken)`. */
  lpTokens: 11n,
} as const;

/**
 * In-struct field position as `[slot, byteOffset]`, LSB-aligned exactly as solc packs.
 * `slot` is relative to the struct's own base (the mapping-entry base for a mapping value).
 */
export const POOL_STRUCTS = {
  /** Flat scalars of `PoolStorage` itself (slot 0 is a packed word; the rest are whole slots). */
  PoolStorage: {
    baseToken: [0, 0],
    initialized: [0, 20],
    protoShare: [0, 21],
    flashFeePbps: [0, 22],
    flowCooldownSeconds: [0, 24],
    wnative: [1, 0],
    treasury: [2, 0],
    factory: [3, 0],
  },
  Asset: {
    reserves: [0, 0],
    liabilities: [0, 16],
    minLiquidity: [1, 0],
    liquidityIndex: [1, 12],
    presetId: [1, 24],
    deadSeedPow10: [1, 26],
    anchor: [2, 0],
    minFeePbps: [2, 20],
    maxFeePbps: [2, 22],
    maxDispersion: [2, 24],
    decimals: [2, 28],
    gamma: [2, 29],
    vega: [3, 0],
    haircutSuppressor: [3, 2],
    minDispersion: [3, 4],
  },
  RiskConfig: {
    coverageMin: [0, 0],
    coverageMax: [0, 2],
    flags: [0, 4],
    kappaCovBps: [0, 6],
  },
  OracleConfig: {
    feedId: [0, 0],
    refFeedId: [1, 0],
    primary: [2, 0],
    refBandBps: [2, 20],
    mode: [2, 22],
    quoteUnit: [2, 23],
    refPrimary: [3, 0],
  },
  HookSlot: {
    target: [0, 0],
    flags: [0, 20],
    lastCreditAt: [0, 24],
  },
} as const satisfies Record<string, Record<string, readonly [number, number]>>;

/**
 * Per-asset yield-hook flag bits — canonical mirror of dex `libraries/PoolConstants.sol`
 * (verified exact: HOOK_PRE_OUTFLOW=1<<0, HOOK_POST_INFLOW=1<<1). SSoT for back/front.
 * Pool dispatches a hook CALL only when `HookSlot.target != 0` AND the matching bit is set.
 */
export const HOOK_PRE_OUTFLOW = 1 << 0;
export const HOOK_POST_INFLOW = 1 << 1;
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

/** `IPool.RiskConfig` — 4×uint16 in one word. */
export interface RiskConfig {
  coverageMin: number;
  coverageMax: number;
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
  const f = POOL_STRUCTS.RiskConfig;
  return {
    coverageMin: u16At(word, f.coverageMin[1]),
    coverageMax: u16At(word, f.coverageMax[1]),
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
