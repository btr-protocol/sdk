/**
 * PoolStorage slot readers: Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`). The slot tables and in-struct packing come from
 * solc's own `storageLayout`; they are the only place either number appears, and every decoder
 * reads them. `POOL_STRUCTS.Asset` is the v2 pool's `Asset` layout (storage version 12),
 * `POOL_STRUCTS.AssetV5` the v1 fleet's (5..9): `assetStructOf(layout)` picks one.
 * `PoolStorage` slots are picked by `Pool.storageVersion()` (`readStorageVersion`): v5
 * (`layout.v5.generated.ts`: no mark in the pool; the impl's `MarkStore`; storage versions 5..9) and
 * v10 (`layout.v10.generated.ts`, storage version 12: leg records and curves in the area behind
 * `legIndex` / `curveIndex`). Storage versions 2..4 are retired and throw. Dispatch is exact: a
 * version without tables throws. An ABI diff cannot see packing, so the generated files are pinned
 * by test/solidity-mirror.test.ts, and `src/pool/storage.test.ts` restates the numbers by hand.
 * Key = keccak256(abi.encode(key, mappingSlot)), same as Solidity 0.8.
 *
 * Off-chain ONLY. On-chain consumers (Flash / hooks) keep thin view fns they need.
 */

import { BPS, type QuarticCurve, type QuarticSeg } from '../amm/aimm.js';
import { encodeAbiParameters } from '../eth/abi.js';
import { bytesToHex, hexToBytes, keccak256 } from '../eth/index.js';
import { getCode } from '../eth/rpc.js';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';

/** EIP-7528 native sentinel + Solidity address(0): both map to PoolStorage.wnative. */
const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function isNativeKey(token: Address): boolean {
  const t = token.toLowerCase();
  return t === NATIVE_SENTINEL || t === ZERO_ADDR;
}

/**
 * Slot and packing tables mirroring solc.s own `storageLayout` numbers,
 * so a repack cannot silently desync them. Re-exported here because every decoder below reads them
 * and callers import them from this module.
 */
import { MARK_STORE_ABI } from '../abis/MarkStore.js';
import { MARK_STORE_ABI_V2 } from '../abis/MarkStore.v2.js';
import { HOOK_FLAGS_MASK, HOOK_PRE_OUTFLOW } from '../abis/solidity.generated.js';
import type { Assert, FieldsMatch, OracleConfigFields } from '../abis/structs.generated.js';
import { type CovTerms, type KneeTerms, decodeCovBits, decodeKneeBits } from './cov.js';
import { POOL_STRUCTS } from './layout.generated.js';
import { MARK_WORD_V4, MARK_WORD_WIRE2 } from './layout.v4.generated.js';
import { MARK_STORE_V5, POOL_STORAGE_V5 } from './layout.v5.generated.js';
import { MARK_STORE_V10, POOL_AREA_V10, POOL_STORAGE_V10 } from './layout.v10.generated.js';

export { POOL_STRUCTS } from './layout.generated.js';
export { MARK_WORD_V4, MARK_WORD_WIRE2 } from './layout.v4.generated.js';
export { MARK_STORE_V5, POOL_MAPPINGS_V5, POOL_STORAGE_V5 } from './layout.v5.generated.js';
export {
  MARK_STORE_V10,
  POOL_AREA_V10,
  POOL_MAPPINGS_V10,
  POOL_STORAGE_V10,
} from './layout.v10.generated.js';

/** `Pool.storageVersion()`. */
const STORAGE_VERSION_SELECTOR = '0x403ebd03';
/** How long a read `storageVersion()` serves (the back's cadence): a v1 -> v2 impl upgrade at the
 *  same address is seen within this. */
const STORAGE_VERSION_TTL_MS = 30_000;
const versions = new WeakMap<Eip1193Provider, Map<string, { v: Promise<number>; at: number }>>();

/**
 * `Pool.storageVersion()`: 5..9 = layout v5 (`POOL_STORAGE_V5`), 12 = layout v10
 * (`POOL_STORAGE_V10`, the v2 pool); any other version throws (`poolStorageOf`). Cached per
 * provider and pool for `STORAGE_VERSION_TTL_MS`: a pool's layout moves only with an impl upgrade,
 * which the next read after the TTL picks up.
 */
function readStorageVersion(provider: Eip1193Provider, pool: Address): Promise<number> {
  const byPool = versions.get(provider) ?? new Map<string, { v: Promise<number>; at: number }>();
  versions.set(provider, byPool);
  const key = pool.toLowerCase();
  const hit = byPool.get(key);
  const now = Date.now();
  if (hit && now - hit.at < STORAGE_VERSION_TTL_MS) return hit.v;
  const v = (
    provider.request({
      method: 'eth_call',
      params: [{ to: pool, data: STORAGE_VERSION_SELECTOR }, 'latest'],
    }) as Promise<Hex>
  ).then((r) => Number(BigInt(r)));
  const entry = { v, at: now };
  byPool.set(key, entry);
  v.catch(() => {
    if (byPool.get(key) === entry) byPool.delete(key);
  });
  return v;
}

/** The layout family of a `Pool.storageVersion()`, as the back's core `PoolLayout::of` serves it
 *  (core/src/storage.rs): 5..=9 layout 5, 12 layout 10 (the v2 pool). Retired 2..4, 10, 11 and
 *  anything else throw, so a pool is never read through another layout's slots. */
export function layoutOf(storageVersion: number): 5 | 10 {
  if (storageVersion >= 5 && storageVersion <= 9) return 5;
  if (storageVersion === 12) return 10;
  throw new Error(`unsupported storageVersion ${storageVersion}: no storage layout for it`);
}

/** The P8 mark store wire a storage version runs: 5..9 = wire 2 (Arc, Monad v1), 12 = wire 3 (the
 *  v2 pool). Exact match; any other version throws, so a store is never read through the other
 *  wire's slots, clocks or id. */
export function wireOf(storageVersion: number): 2 | 3 {
  const layout = layoutOf(storageVersion);
  if (layout === 5) return 2;
  if (layout === 10) return 3;
  throw new Error(`Pool.storageVersion() ${storageVersion}: no P8 mark store`);
}

/** The store constants (`MS`, `AUTH`, ...) a storage version selects (`wireOf`). */
export function markStoreOf(storageVersion: number): typeof MARK_STORE_V5 | typeof MARK_STORE_V10 {
  return wireOf(storageVersion) === 2 ? MARK_STORE_V5 : MARK_STORE_V10;
}

/** The MarkStore ABI a storage version selects (`wireOf`). */
export const markStoreAbiOf = (storageVersion: number) =>
  wireOf(storageVersion) === 2 ? MARK_STORE_ABI_V2 : MARK_STORE_ABI;

/** The absolute slot table a layout version selects (exact match, `layoutOf`). */
export function poolStorageOf(
  storageVersion: number,
): typeof POOL_STORAGE_V5 | typeof POOL_STORAGE_V10 {
  return layoutOf(storageVersion) === 5 ? POOL_STORAGE_V5 : POOL_STORAGE_V10;
}

/**
 * Per-asset yield-hook flag bits, generated from dex `libraries/PoolConstantsLib.sol`. Pool
 * dispatches a hook CALL only when `HookSlot.target != 0` AND the matching bit is set;
 * `HOOK_FLAGS_MASK` = known bits, dex rejects unknown bits at adminSetAssetHook.
 */
export { HOOK_FLAGS_MASK, HOOK_PRE_OUTFLOW };

/** Decoded `IPool.HookSlot` (single packed storage word). */
export interface HookSlot {
  target: Address;
  flags: number;
  /** Unix seconds of the last `hookCreditYield` rate bucket; 0 until the leg is seeded. */
  lastCreditAt: number;
}

/** `PoolConstantsLib.CLASS_ROWS_BIT`: the leg has a peg family or a risk row (store-owned flag). */
export const CLASS_ROWS_BIT = 1 << 7;
/** `PoolConstantsLib.KNEE_BIT`: the leg carries a knee (`Asset.kneeBits`, κ₂ > 0); derived. */
export const KNEE_BIT = 1 << 1;
/** `PoolConstantsLib.MAX_FAMILY`: highest peg-family id and row key (0 = the leg's default row). */
export const MAX_FAMILY = 4;

/** A `classRisk` / `classHead.row` word (`ClassRiskLib.pack`): kappaCovBps 0..13 | minFeePbps
 *  14..27 (`PoolConstantsLib.CLASS_FEE_SHIFT`), bits 28..63 zero. */
export interface ClassRisk {
  kappaCovBps: number;
  minFeePbps: number;
}

export function decodeClassRisk(pack: bigint): ClassRisk {
  return {
    kappaCovBps: Number(pack & 0x3fffn),
    minFeePbps: Number((pack >> 14n) & 0x3fffn),
  };
}

/** `IPool.ClassHead` word: family = low byte, default row = next 64 bits, then (v10) `famRow`, the
 *  leg's row in its own family (0 below v10); v10 also packs `expAt u32 | expHw u88` above bit 136
 *  (not decoded here). `ClassRiskLib.rowAt` reads `famRow` for the leg's own
 *  family and `classRisk[leg][f]` for any other. */
export function decodeClassHead(word: bigint): { family: number; row: bigint; famRow: bigint } {
  const U64 = 0xffff_ffff_ffff_ffffn;
  return { family: Number(word & 0xffn), row: (word >> 8n) & U64, famRow: (word >> 72n) & U64 };
}

/** `IPool.RiskConfig`: 2×uint16. Still an ABI/memory type (`getAsset` returns both fields), but
 *  no longer a storage struct of its own: both fields live in `Asset` slot 2. */
export interface RiskConfig {
  flags: number;
  /** κ (bps): convex coverage-wall strength. 0 = off (volatiles). */
  kappaCovBps: number;
}

/** `IPool.OracleConfig` as a pool stores it, in `Asset` slot 2 (`oracleBits`). */
export interface OracleConfig {
  /** Store lane (< 64) carrying the leg's P and R tiers. */
  lane: number;
  /** 0 = EXTERNAL, 1 = INTERNAL (quote = 1.0 peg; the P mark gates depeg only). */
  mode: number;
  /** 0 = ANCHOR_UNIT, 1 = UNIT_OF_ACCOUNT (the pool divides by the base's own mark). */
  quoteUnit: number;
}

/** The `Asset` struct packing a layout reads: v10 (storage version 12) moved κ and the depeg band
 *  out of the struct (`covBits`, `flags` 12..15), so `oracleBits` sits at byte 27, not 29. */
export function assetStructOf(
  layout: 5 | 10,
): typeof POOL_STRUCTS.Asset | typeof POOL_STRUCTS.AssetV5 {
  return layout === 10 ? POOL_STRUCTS.Asset : POOL_STRUCTS.AssetV5;
}

/** `PoolConstantsLib.DEPEG_STEP_BPS`: a v10 leg's depeg band is `flags >> 12` codes of this. */
export const DEPEG_STEP_BPS = 250;

export type _OracleConfigMatchesAbi = Assert<FieldsMatch<OracleConfig, OracleConfigFields>>;

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
 * `PoolStorage.wnative`: same as Solidity deposit/swap paths that wrap before mapping lookup.
 */
async function resolveTokenStorageKey(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<Address> {
  if (!isNativeKey(token)) return token;
  const word = await getStorageAt(provider, pool, POOL_STORAGE_V5.wnative);
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

/** `NUQuarticLib.Curve.segs` is a fixed uint256[28] block (m ≤ 14 → 2m live words). */
export const CURVE_SEG_SLOTS = 28;

/** Signed int64 packed at bit offset `shift` in a storage word. */
function i64AtBits(word: bigint, shift: number): bigint {
  const u = (word >> BigInt(shift)) & 0xffffffffffffffffn;
  return u >= 1n << 63n ? u - (1n << 64n) : u;
}

/** Solady SSTORE2's CREATE3 proxy init-code hash (`CREATE3_PROXY_INITCODE_HASH`). */
const CREATE3_PROXY_INITCODE_HASH = keccak256('0x67363d3d37363d34f03d5260086018f3');

/**
 * Layout v5: the account holding `pool`'s curve `curveId` (`NUQuarticLib.ptr`, the SSTORE2 CREATE3
 * address the pool deploys at salt `bytes32(uint256(curveId))`). Immutable once written.
 */
export function curvePointer(pool: Address, curveId: number): Address {
  const salt = curveId.toString(16).padStart(64, '0');
  const proxy = keccak256(
    `0xff${pool.slice(2).toLowerCase()}${salt}${CREATE3_PROXY_INITCODE_HASH.slice(2)}`,
  ).slice(26);
  return `0x${keccak256(`0xd694${proxy}01`).slice(26)}` as Address;
}

/** `recordOf`: `token`'s record slot off the 32 `legIndex` words (slots 83..114), `null` when
 *  unlisted. Linear probe from `uint160(token) % 32`, stopping at an empty entry. */
export function recordSlot(legIndex: readonly bigint[], token: Address): bigint | null {
  const t = BigInt(token);
  let h = Number(t & 31n);
  for (let n = 0; n < POOL_AREA_V10.LEG_INDEX_SLOTS; n++) {
    const e = legIndex[h] ?? 0n;
    if (e === 0n) return null;
    if ((e & ((1n << 160n) - 1n)) === t) return e >> 160n;
    h = (h + 1) & 31;
  }
  return null;
}

/** `curveAt`: curve `id`'s blob slot off the 8 `curveIndex` words (slots 115..122), `null` when not
 *  installed. Linear probe over the 64 u32 lanes from `id % 64`, stopping at an empty lane. */
export function curveSlot(curveIndex: readonly bigint[], id: number): bigint | null {
  let j = id & 63;
  for (let n = 0; n < POOL_AREA_V10.CURVE_INDEX_LANES; n++) {
    const e = ((curveIndex[j >> 3] ?? 0n) >> BigInt(32 * (j & 7))) & 0xffff_ffffn;
    if (e === 0n) return null;
    if ((e & 0xffffn) === BigInt(id)) return e >> 16n;
    j = (j + 1) & 63;
  }
  return null;
}

/** `n` consecutive pool words from `slot`, one transport round-trip (the tick batch coalesces). */
async function readWords(
  provider: Eip1193Provider,
  pool: Address,
  slot: bigint,
  n: number,
): Promise<bigint[]> {
  const w = await Promise.all(
    Array.from({ length: n }, (_, i) => getStorageAt(provider, pool, slot + BigInt(i))),
  );
  return w.map((x) => BigInt(x));
}

/**
 * The base slot of `token`'s `Asset` (its record): v10 through `legIndex`, falling back to the
 * `unlisted` mapping entry (slot 4) as `assetOf` does; v5..9 the `assets` mapping entry (slot 4).
 * `Custody` sits at +3 and `ClassHead` at +4 on v10. `key` = the resolved storage key.
 */
export async function assetSlot(
  provider: Eip1193Provider,
  pool: Address,
  key: Address,
): Promise<bigint> {
  const layout = layoutOf(await readStorageVersion(provider, pool));
  if (layout === 10) {
    const ix = await readWords(provider, pool, POOL_STORAGE_V10.legIndex, 32);
    return recordSlot(ix, key) ?? mappingBase(key, POOL_STORAGE_V10.unlisted);
  }
  return mappingBase(key, POOL_STORAGE_V5.assets);
}

/** A leg's `ClassHead` (v10 record +5, v9 `classHead` mapping 16; zero below 9). */
export async function readClassHead(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<{ family: number; row: bigint; famRow: bigint }> {
  const [layout, key] = await Promise.all([
    readStorageVersion(provider, pool).then(layoutOf),
    resolveTokenStorageKey(provider, pool, token),
  ]);
  const at =
    layout === 10
      ? (await assetSlot(provider, pool, key)) + POOL_AREA_V10.RECORD_CLASS_HEAD
      : mappingBase(key, POOL_STORAGE_V5.classHead);
  return decodeClassHead(BigInt(await getStorageAt(provider, pool, at)));
}

/** A leg's `Custody` word: v10 record +4, v5..9 the `custody` mapping (slot 7). */
export async function readCustody(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<Custody> {
  const [layout, key] = await Promise.all([
    readStorageVersion(provider, pool).then(layoutOf),
    resolveTokenStorageKey(provider, pool, token),
  ]);
  const at =
    layout === 10
      ? (await assetSlot(provider, pool, key)) + POOL_AREA_V10.RECORD_CUSTODY
      : mappingBase(key, POOL_STORAGE_V5.custody);
  return decodeCustody(await getStorageAt(provider, pool, at));
}

/**
 * Read + decode a shared curve: on v10 the pool's own words at `curveSlot` (the 8 `curveIndex` words,
 * then header + up to 2·14 segment words in one round-trip), on v5..9 the SSTORE2 blob at
 * `curvePointer` (one `eth_getCode`: a STOP byte, then header + 2 words per segment). Returns null
 * when the curve is not installed (header 0 / no code).
 * Curve type/eval: `QuarticCurve` + `evalQ`/`areaQ` in `@sdk/amm`.
 */
export async function readCurve(
  provider: Eip1193Provider,
  pool: Address,
  curveId: number,
): Promise<QuarticCurve | null> {
  const layout = layoutOf(await readStorageVersion(provider, pool));
  if (layout === 10) {
    const ix = await readWords(provider, pool, POOL_STORAGE_V10.curveIndex, 8);
    const at = curveSlot(ix, curveId);
    return at === null
      ? null
      : decodeCurve(await readWords(provider, pool, at, 1 + CURVE_SEG_SLOTS));
  }
  const code = (await getCode(provider, curvePointer(pool, curveId))).slice(4); // 0x + STOP
  const words = Array.from({ length: code.length >> 6 }, (_, i) =>
    BigInt(`0x${code.slice(64 * i, 64 * i + 64)}`),
  );
  return decodeCurve(words);
}

/** Header word + segment words → curve; null on header 0 or fewer words than `m` claims. */
function decodeCurve(words: bigint[]): QuarticCurve | null {
  const header = words[0] ?? 0n;
  if (header === 0n) return null;
  const m = Number(header & 0xffn);
  if (words.length < 1 + 2 * m) return null;
  // The directory holds the m-1 INTERIOR boundaries only; the last right edge is the BPS constant,
  // never stored. Those freed bits carry the median at 216, so reading m entries here both loses
  // b_m and mis-reads the median as one.
  const boundaries: number[] = [];
  for (let j = 1; j < m; j++) {
    boundaries.push(Number((header >> BigInt(8 + 16 * (j - 1))) & 0xffffn));
  }
  boundaries.push(BPS);
  const dispRef = Number((header >> 232n) & 0xffffn);
  const flags = Number((header >> 248n) & 0xffn);
  const segs: QuarticSeg[] = [];
  for (let i = 0; i < m; i++) {
    const a = words[1 + 2 * i];
    const b = words[2 + 2 * i];
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

/** A leg's oracle config, off its `Asset` slot-2 word through the layout's struct packing. */
export async function readOracleConfig(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<OracleConfig> {
  const [layout, key] = await Promise.all([
    readStorageVersion(provider, pool).then(layoutOf),
    resolveTokenStorageKey(provider, pool, token),
  ]);
  const leg = decodeLegOracle(
    await getStorageAt(provider, pool, (await assetSlot(provider, pool, key)) + 2n),
    layout,
  );
  return { lane: leg.lane, mode: leg.internal ? 1 : 0, quoteUnit: leg.uoa ? 1 : 0 };
}

/** A v2 leg's coverage law off its record: `covBits` (slot 2) and `kneeBits` (slot 3), decoded to
 *  bps as `getRiskConfig` reports them. The knee is read only while `flags` carries `KNEE_BIT`
 *  (`PoolConstantsLib`, bit 1); otherwise it reads as none. Throws on a v1 pool: its κ is the
 *  `kappaCovBps` struct field and it has no law terms. */
export async function readLegCov(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<CovTerms & KneeTerms & { flags: number }> {
  const [layout, key] = await Promise.all([
    readStorageVersion(provider, pool).then(layoutOf),
    resolveTokenStorageKey(provider, pool, token),
  ]);
  if (layout !== 10) throw new Error(`readLegCov: layout ${layout} has no covBits`);
  const base = await assetSlot(provider, pool, key);
  const f = POOL_STRUCTS.Asset;
  const [slot2, slot3] = await Promise.all([
    getStorageAt(provider, pool, base + BigInt(f.covBits[0])),
    getStorageAt(provider, pool, base + BigInt(f.kneeBits[0])),
  ]);
  const flags = u16At(slot2, f.flags[1]);
  const knee = flags & KNEE_BIT ? decodeKneeBits(u16At(slot3, f.kneeBits[1])) : decodeKneeBits(0);
  return { ...decodeCovBits(u32At(slot2, f.covBits[1])), ...knee, flags };
}

/** `PoolConstantsLib.SWAP_GATE_SLOTS`: the open-addressed `swapGate` table (v10), pinned by
 *  test/solidity-mirror.test.ts. */
export const SWAP_GATE_SLOTS = 64;

/** `PoolIOLib.requireSwapGate`: probe up from `uint160(caller) % 64` until the caller or the
 *  first empty slot. `readSlot(i)` returns table entry `i` (zero address = empty). A full table
 *  without the caller is a miss, as on chain (the loop there is bounded by the empty slot the
 *  table always keeps). */
export async function swapGateAdmits(
  readSlot: (i: number) => Promise<Address>,
  caller: Address,
): Promise<boolean> {
  const want = caller.toLowerCase();
  const start = Number(BigInt(caller) % BigInt(SWAP_GATE_SLOTS));
  for (let n = 0; n < SWAP_GATE_SLOTS; n++) {
    const a = (await readSlot((start + n) % SWAP_GATE_SLOTS)).toLowerCase();
    if (a === want) return true;
    if (BigInt(a) === 0n) return false;
  }
  return false;
}

/** Is `caller` in the pool's swap allowlist? v10+ pools gate swaps on `Pool.swapGate`, never on
 *  `AccessControl.perms` (that lane is DEPOSIT_GATED's only); older pools keep the AC lane, so
 *  they return `null` and the caller reads `perms` as before. */
export async function readSwapGateMember(
  provider: Eip1193Provider,
  pool: Address,
  caller: Address,
): Promise<boolean | null> {
  const v = await readStorageVersion(provider, pool);
  if (layoutOf(v) !== 10) return null;
  const base = POOL_STORAGE_V10.swapGate;
  return swapGateAdmits(
    async (i) => addressAt(await getStorageAt(provider, pool, base + BigInt(i)), 0),
    caller,
  );
}

/** `PoolStorage.lastGoodCWad9`: the uint40 in slot 0, 1e-9 WAD: the degraded same-asset exit cap
 *  (`exitCap`), WAD; 0 until an LP entrypoint has observed a rate. v5 packs it at byte 27 (bit 216,
 *  after `flashFeePbps` and `solvencyArmed`); v10 at byte 24 (bit 192, `PoolSolvencyLib.stampC`),
 *  as core `decode_pool_slot0` / `decode_pool_slot0_v10` read it. */
export async function readSolvencyState(
  provider: Eip1193Provider,
  pool: Address,
): Promise<{ lastGoodCWad: bigint }> {
  const layout = layoutOf(await readStorageVersion(provider, pool));
  const table = layout === 5 ? POOL_STORAGE_V5 : POOL_STORAGE_V10;
  const slot0 = BigInt(await getStorageAt(provider, pool, table.lastGoodCWad9));
  const shift = layout === 5 ? 216n : 192n;
  return { lastGoodCWad: ((slot0 >> shift) & ((1n << 40n) - 1n)) * 10n ** 9n };
}

const U128 = (1n << 128n) - 1n;
const field = (w: bigint, shift: number, width: number) =>
  Number((w >> BigInt(shift)) & ((1n << BigInt(width)) - 1n));

/** Decoded `IPool.Custody`: one word per leg at `custody` (slot 7). Storage version >= 6 meaning;
 *  on v5 pools the low half is the escrowed `protocolFees` (token units) instead. */
export interface Custody {
  /** Pending treasury LP shares, priced by `liquidityIndexWad`, not yet minted. Includes a
   *  permanent seed share once the leg has taken a deposit: claimable = max(treasuryShares - 1, 0). */
  treasuryShares: bigint;
  /** Tranche out on the leg's hook; `Asset.reserves = R_liq + invested`. */
  invested: bigint;
}

export function decodeCustody(word: Hex): Custody {
  const w = BigInt(word);
  return { treasuryShares: w & U128, invested: w >> 128n };
}

/** One feed of a mark word, exactly as the pool prices it, with the config mirror. The pool gates
 *  `now - obs` against `ttlSecs`. */
interface MarkWord {
  mark1e18: bigint;
  obs: number;
  sigmaPbps: number;
  confidenceBps: number;
  ttlSecs: number;
  maxDevBps: number;
  halted: boolean;
  /** `OracleConfig.mode == INTERNAL`: the leg quotes the 1.0 peg; this feed is its breaker. */
  internal: boolean;
  /** `OracleConfig.quoteUnit == UOA`: the mark is divided by the base mark. */
  uoa: boolean;
  /** 0 = band disarmed, and word 1 is then 0. */
  refBandBps: number;
}

/** A V5 lane float (`mant u25 | exp7 u7 << 25`) as a 1e18 mark. */
export function laneFloat(f: number): bigint {
  const mant = BigInt(f & 0x1ffffff);
  const e = BigInt((f >>> 25) & 0x7f);
  return e >= 16n ? mant << (e - 16n) : mant >> (16n - e);
}

/** A leg / store word as its feeds. Wire 3 (`MARK_WORD_V4`, dex-evm 1bfe04ed, core
 *  `decode_mark_word`): one feed, the depeg band at `DEPEG_SHIFT` in `DEPEG_STEP_BPS` codes, `ref`
 *  null. Wire 2 (`MARK_WORD_WIRE2`, the v1 fleet): the mirror rides on `primary`; `ref` carries no
 *  σ nor maxDev (the pool never reads them) and is all 0 while the band is disarmed. */
export function decodeMarkWord(
  word: Hex,
  wire: 2 | 3 = 3,
): { primary: MarkWord; ref: MarkWord | null } {
  const w = BigInt(word);
  if (wire === 3) {
    const m = MARK_WORD_V4;
    return {
      primary: {
        mark1e18: laneFloat(field(w, 0, 32)),
        obs: field(w, m.OBS_SHIFT, 32),
        sigmaPbps: field(w, m.SIGMA_SHIFT, 27),
        confidenceBps: field(w, m.CONF_SHIFT, 16),
        ttlSecs: field(w, m.TTL_SHIFT, 16),
        maxDevBps: field(w, m.MAX_DEV_SHIFT, 11),
        halted: field(w, m.HALT_SHIFT, 1) === 1,
        internal: field(w, m.INTERNAL_SHIFT, 1) === 1,
        uoa: field(w, m.UOA_SHIFT, 1) === 1,
        refBandBps: field(w, m.DEPEG_SHIFT, 4) * DEPEG_STEP_BPS,
      },
      ref: null,
    };
  }
  const m = MARK_WORD_WIRE2;
  return {
    primary: {
      mark1e18: laneFloat(field(w, 0, 32)),
      obs: field(w, m.OBS_SHIFT, 32),
      sigmaPbps: field(w, m.SIGMA_SHIFT, 27),
      confidenceBps: field(w, m.CONF_SHIFT, 16),
      ttlSecs: field(w, m.TTL_SHIFT, 16),
      maxDevBps: field(w, m.MAX_DEV_SHIFT, 11),
      halted: field(w, m.HALT_SHIFT, 1) === 1,
      internal: field(w, m.INTERNAL_SHIFT, 1) === 1,
      uoa: field(w, m.UOA_SHIFT, 1) === 1,
      refBandBps: field(w, m.REF_BAND_SHIFT, 16),
    },
    ref: {
      mark1e18: laneFloat(field(w, m.REF_SHIFT, 32)),
      obs: field(w, m.REF_OBS_SHIFT, 32),
      sigmaPbps: 0,
      confidenceBps: field(w, m.REF_CONF_SHIFT, 16),
      ttlSecs: field(w, m.REF_TTL_SHIFT, 16),
      maxDevBps: 0,
      halted: field(w, m.REF_HALT_SHIFT, 1) === 1,
      internal: false,
      uoa: false,
      refBandBps: 0,
    },
  };
}

/** A leg's oracle wiring off its `Asset` slot-2 word, through the layout's struct packing
 *  (`assetStructOf`). `refBandBps` is the depeg band in bps: the v5 struct field's low 12 bits, or
 *  on v10 the `flags` 12..15 code times `DEPEG_STEP_BPS` (`MarkWordLib.depegBps`). */
export function decodeLegOracle(
  slot2: Hex,
  layout: 5 | 10,
): {
  lane: number;
  internal: boolean;
  uoa: boolean;
  refBandBps: number;
} {
  const f = assetStructOf(layout);
  const b = u8At(slot2, f.oracleBits[1]);
  const refBandBps =
    layout === 10
      ? (u16At(slot2, f.flags[1]) >>> 12) * DEPEG_STEP_BPS
      : u16At(slot2, POOL_STRUCTS.AssetV5.refBandBps[1]) & 0xfff; // 12..15 = depeg code
  return {
    lane: b & MARK_STORE_V10.LANE_MASK,
    internal: (b & MARK_STORE_V10.INTERNAL_BIT) !== 0,
    uoa: (b & MARK_STORE_V10.UOA_BIT) !== 0,
    refBandBps,
  };
}

/** A store word as a pool prices it for one leg: σ floored at the lane's minSigma, the leg's own
 *  config in the mirror fields (`MarkWordLib.compose`; core `decode_store_word`). */
export function decodeStoreWord(
  word: Hex,
  leg: { internal: boolean; uoa: boolean; refBandBps: number },
  wire: 2 | 3 = 3,
): { primary: MarkWord; ref: MarkWord | null } {
  const out = decodeMarkWord(word, wire);
  const floor = Number(BigInt(word) >> BigInt(MARK_STORE_V10.MIN_SIGMA_SHIFT));
  out.primary.sigmaPbps = Math.max(out.primary.sigmaPbps, floor);
  out.primary.internal = leg.internal;
  out.primary.uoa = leg.uoa;
  out.primary.refBandBps = leg.refBandBps;
  return out;
}

/** ERC-1967 impl slot: a pool proxy's live impl, which carries the mark store. */
const IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn;

/** `MarkP8Lib.CONF_LO`/`CONF_HI` unpacked: bps of P8 conf codes 32..60. */
export const P8_CONF_TABLE = [
  36, 40, 45, 50, 56, 63, 71, 80, 90, 100, 112, 125, 140, 160, 180, 200, 225, 250, 280, 320, 360,
  400, 450, 500, 560, 640, 720, 850, 1000,
] as const;

/** `MarkStoreP8.classes()`: laneCls (3 bits per lane) | classes 1..5 | 6..7 (47 bits each: ttl u12 |
 *  maxDev u11 at 12 | minSigma u24 at 23). */
export type P8Classes = { laneCls: bigint; clsA: bigint; clsB: bigint };

const CLASSES_SELECTOR = '0x31e77853';
const P8_STORE_ID = {
  2: keccak256(new TextEncoder().encode('btr.markstore.p8')),
  3: keccak256(new TextEncoder().encode('btr.markstore.p8.v4')),
} as const;

/** The P8 class table off a `classes()` return; `null` for any other store id, including the
 *  other wire's. */
export function decodeP8Classes(ret: Hex, wire: 2 | 3 = 3): P8Classes | null {
  const w = (i: number) => BigInt(`0x${ret.slice(2 + 64 * i, 66 + 64 * i) || '0'}`);
  if (ret.length < 258 || w(3) !== BigInt(P8_STORE_ID[wire]) || w(0) === 0n) return null;
  return { laneCls: w(0), clsA: w(1), clsB: w(2) };
}

/** `lane`'s class `(ttl, maxDev, minSigma)`; all 0 when unlisted. */
export function p8ClassOf(c: P8Classes, lane: number): [number, number, number] {
  const k = Number((c.laneCls >> BigInt(3 * lane)) & 7n);
  const v = k === 0 ? 0n : k < 6 ? c.clsA >> BigInt(47 * (k - 1)) : c.clsB >> BigInt(47 * (k - 6));
  return [Number(v & 0xfffn), Number((v >> 12n) & 0x7ffn), Number((v >> 23n) & 0xffffffn)];
}

/** P8 conf code → bps: exact below 32, the table to 60, 65535 from 61. */
export function p8Conf(code: number): number {
  return code < 32 ? code : code < 61 ? P8_CONF_TABLE[code - 32]! : 0xffff;
}

/** P8 σ8 → pbps, never below the class floor (0 reads it exactly). */
export function p8Sigma(s8: number, floor: number): number {
  return s8 === 0 ? floor : Math.max(floor, (16 | (s8 & 15)) * 2 ** ((s8 >> 4) + 2));
}

/** Word slot of `lane` in a P8 store, 4 lanes per word (core `p8::word_slot`). Wire 3 has ONE
 *  tier at `MS + (lane >> 2)`; wire 2 keeps tier `t` (1 = P, 2 = R) at `MS + (t - 1) << 4 | g`. */
export function p8TierSlot(tier: 1 | 2, lane: number, wire: 2 | 3 = 3): bigint {
  if (wire === 3) {
    if (tier !== 1) throw new Error('wire 3 P8 store has no R tier');
    return MARK_STORE_V10.MS + BigInt(lane >> 2);
  }
  return MARK_STORE_V5.MS + (BigInt(tier - 1) << 4n) + BigInt(lane >> 2);
}

/** `lane`'s store word from its P8 word(s): `Pool.fallback`'s decode plus the class minSigma at
 *  `MIN_SIGMA_SHIFT` (the D2b field), so `decodeStoreWord` reads it unchanged. Byte-identical to
 *  core `p8::store_word`. Lane at 56j: mant u24 | e6 24 | age u12 30 | σ8 42 | st u6 50 (62 halted,
 *  63 dark); clock u32 at 224. Wire 3 (1bfe04ed): ONE tier word, `rw` ignored; clock and age
 *  count 250 ms ticks mod 2^32, so the decode needs `nowSecs` (the chain's `block.timestamp`).
 *  Wire 2 (v1 fleet): P and R tier words, both clocks in seconds, `nowSecs` unused. */
export function p8StoreWord(
  pw: Hex,
  rw: Hex | null,
  lane: number,
  c: P8Classes,
  nowSecs: number,
  wire: 2 | 3 = 3,
): Hex {
  const sh = BigInt(56 * (lane & 3));
  const P = BigInt(pw);
  const p = (P >> sh) & ((1n << 56n) - 1n);
  const M30 = 0x3fffffffn;
  const nt = BigInt(nowSecs) * 4n;
  if ((p & M30) === 0n && p >> 50n < 62n) return `0x${'0'.repeat(64)}`;
  const [ttl, maxDev, floor] = p8ClassOf(c, lane);
  const tier = (v: bigint, tw: bigint, cs: bigint): bigint => {
    const st = v >> 50n;
    // The lane's tick (clock - age, mod 2^32) unwrapped to within +-2^31 ticks of now, floored to
    // its second; 0 before genesis.
    const d = (((tw >> 224n) - ((v >> 30n) & 0xfffn) - nt) & 0xffffffffn) ^ 0x80000000n;
    const o = nt + d - 0x80000000n;
    const obs =
      wire === 2 ? ((tw >> 224n) - ((v >> 30n) & 0xfffn)) & 0xffffffffn : o > 0n ? o >> 2n : 0n;
    const live = st < 62n && (v & M30) !== 0n;
    const f = ((v & 0xffffffn) | ((v & 0x3f000000n) << 1n)) + 0x21000000n;
    return (obs << 32n) | (live ? f | (BigInt(p8Conf(Number(st))) << cs) : 0n);
  };
  let w =
    tier(p, P, 91n) |
    (BigInt(p8Sigma(Number((p >> 42n) & 0xffn), floor)) << 64n) |
    (BigInt(ttl) << 107n) |
    (BigInt(maxDev) << 123n) |
    (BigInt(p >> 50n === 62n) << 134n) |
    (BigInt(floor) << BigInt(MARK_STORE_V10.MIN_SIGMA_SHIFT));
  if (wire === 2) {
    if (rw === null) throw new Error('wire 2 P8 store word needs the R tier word');
    const R = BigInt(rw);
    const r = (R >> sh) & ((1n << 56n) - 1n);
    const m = MARK_WORD_WIRE2;
    w |=
      (tier(r, R, 64n) << BigInt(m.REF_SHIFT)) |
      (BigInt(ttl) << BigInt(m.REF_TTL_SHIFT)) |
      (BigInt(r >> 50n === 62n) << BigInt(m.REF_HALT_SHIFT));
  }
  return `0x${w.toString(16).padStart(64, '0')}`;
}

/** The impl store's P8 class table, the only layout `Pool`'s constructor admits. Throws on a failed
 *  or reverted read or a table without the P8 id: no mark (fail closed). */
async function readP8Classes(
  provider: Eip1193Provider,
  impl: Address,
  wire: 2 | 3,
): Promise<P8Classes> {
  const r = (await provider.request({
    method: 'eth_call',
    params: [{ to: impl, data: CLASSES_SELECTOR }, 'latest'],
  })) as Hex;
  const c = decodeP8Classes(r, wire);
  if (!c) throw new Error(`classes() of ${impl} is not a P8 table`);
  return c;
}

/** A leg's feed(s) as its pool prices them, off the impl's P8 store. The wire follows the storage
 *  version (`wireOf`), so an unsupported version throws before any slot is read. Wire 3 reads the
 *  one lane word (core `replica` reads it the same way); wire 2 reads both tier words. */
export async function readMarks(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
  nowSecs = Math.floor(Date.now() / 1000),
): Promise<{ primary: MarkWord; ref: MarkWord | null }> {
  const storageVersion = await readStorageVersion(provider, pool);
  const wire = wireOf(storageVersion);
  const key = await resolveTokenStorageKey(provider, pool, token);
  const [slot2, implWord] = await Promise.all([
    assetSlot(provider, pool, key).then((a) => getStorageAt(provider, pool, a + 2n)),
    getStorageAt(provider, pool, IMPL_SLOT),
  ]);
  const leg = decodeLegOracle(slot2, layoutOf(storageVersion));
  const impl = addressAt(implWord, 0);
  const cls = await readP8Classes(provider, impl, wire);
  const [pw, rw] = await Promise.all([
    getStorageAt(provider, impl, p8TierSlot(1, leg.lane, wire)),
    wire === 2 ? getStorageAt(provider, impl, p8TierSlot(2, leg.lane, wire)) : null,
  ]);
  return decodeStoreWord(p8StoreWord(pw, rw, leg.lane, cls, nowSecs, wire), leg, wire);
}
