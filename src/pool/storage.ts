/**
 * PoolStorage slot readers: Solana-style deterministic layout, no Solidity getters.
 *
 * SSoT: `IPool.PoolStorage` @ slot 0 (`Pool.sol`). `POOL_STORAGE` (slots) and `POOL_STRUCTS`
 * (in-struct [slot, byteOffset]) are GENERATED from solc's own `storageLayout`; they are the only
 * place either number appears, and every decoder reads them. Two layouts are live, picked by
 * `Pool.storageVersion()` (`readStorageVersion`): v2 (Arc, `layout.generated.ts`, frozen), v3
 * (`layout.v3.generated.ts`: the `Custody` word, `marks`, and the slots after them moved), v4
 * (`layout.v4.generated.ts`: one `marks` word per leg, `lastGoodCWad` in slot 0) and v5
 * (`layout.v5.generated.ts`: no mark in the pool; the impl's `MarkStore`). An ABI diff cannot see packing, so
 * `bun run gen:check` (generated files vs artifacts), not test/abi-freshness.test.ts, is what
 * catches a repack; `src/pool/storage.test.ts` restates the numbers by hand as an offline pin.
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
import { HOOK_PRE_OUTFLOW } from '../abis/solidity.generated.js';
import { POOL_STORAGE, POOL_STRUCTS } from './layout.generated.js';
import { MARK_WORD, POOL_STORAGE_V3 } from './layout.v3.generated.js';
import { MARK_WORD_V4, POOL_STORAGE_V4 } from './layout.v4.generated.js';
import { MARK_STORE, POOL_STORAGE_V5, POOL_STRUCTS_V5 } from './layout.v5.generated.js';

export { POOL_MAPPINGS, POOL_STORAGE, POOL_STRUCTS } from './layout.generated.js';
export {
  MARK_WORD,
  POOL_MAPPINGS_V3,
  POOL_STORAGE_V3,
  POOL_STRUCTS_V3,
} from './layout.v3.generated.js';
export {
  MARK_WORD_V4,
  POOL_MAPPINGS_V4,
  POOL_STORAGE_V4,
  POOL_STRUCTS_V4,
} from './layout.v4.generated.js';
export {
  MARK_STORE,
  POOL_MAPPINGS_V5,
  POOL_STORAGE_V5,
  POOL_STRUCTS_V5,
} from './layout.v5.generated.js';

/** `Pool.storageVersion()`. */
const STORAGE_VERSION_SELECTOR = '0x403ebd03';
const versions = new WeakMap<Eip1193Provider, Map<string, Promise<number>>>();

/**
 * `Pool.storageVersion()`: 2 = layout v2 (Arc, `POOL_STORAGE`), 3 = layout v3 (`POOL_STORAGE_V3`),
 * 4 = layout v4 (`POOL_STORAGE_V4`), >= 5 = layout v5 (`POOL_STORAGE_V5`). Memoised per provider and pool: a pool's layout moves only with an impl
 * upgrade.
 */
function readStorageVersion(provider: Eip1193Provider, pool: Address): Promise<number> {
  const byPool = versions.get(provider) ?? new Map<string, Promise<number>>();
  versions.set(provider, byPool);
  const key = pool.toLowerCase();
  const hit = byPool.get(key);
  if (hit) return hit;
  const v = (
    provider.request({
      method: 'eth_call',
      params: [{ to: pool, data: STORAGE_VERSION_SELECTOR }, 'latest'],
    }) as Promise<Hex>
  ).then((r) => Number(BigInt(r)));
  byPool.set(key, v);
  v.catch(() => byPool.delete(key));
  return v;
}

/** The absolute slot table a layout version selects. */
function poolStorageOf(
  storageVersion: number,
): typeof POOL_STORAGE | typeof POOL_STORAGE_V3 | typeof POOL_STORAGE_V4 | typeof POOL_STORAGE_V5 {
  if (storageVersion >= 5) return POOL_STORAGE_V5;
  if (storageVersion >= 4) return POOL_STORAGE_V4;
  return storageVersion === 3 ? POOL_STORAGE_V3 : POOL_STORAGE;
}

/**
 * Per-asset yield-hook flag bits, generated from dex `libraries/PoolConstantsLib.sol`. Pool
 * dispatches a hook CALL only when `HookSlot.target != 0` AND the matching bit is set.
 */
export { HOOK_PRE_OUTFLOW };
/** Known-bits mask; dex rejects unknown bits at adminSetAssetHook. */
export const HOOK_FLAGS_MASK = HOOK_PRE_OUTFLOW;

/** Decoded `IPool.HookSlot` (single packed storage word). */
export interface HookSlot {
  target: Address;
  flags: number;
  /** Unix seconds of the last `hookCreditYield` rate bucket; 0 until the leg is seeded. */
  lastCreditAt: number;
}

/** `IPool.RiskConfig`: 2×uint16. Still an ABI/memory type (`getAsset` returns both fields), but
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
 * `PoolStorage.wnative`: same as Solidity deposit/swap paths that wrap before mapping lookup.
 */
async function resolveTokenStorageKey(
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

/** `NUQuarticLib.Curve.segs` is a fixed uint256[28] block (m ≤ 14 → 2m live words). */
export const CURVE_SEG_SLOTS = 28;

/** Mapping entry base slot for a uint16 key (the shared curve table). */
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

/**
 * Read + decode a shared curve: on v5 the SSTORE2 blob at `curvePointer` (one `eth_getCode`: a STOP
 * byte, then header + 2 words per segment), on v2–v4 `NUQuarticLib.Curve` @ curves[curveId],
 * slot 6 (header slot + the 2m live words of the fixed uint256[28] block). Returns null when the
 * curve is not installed (header 0 / no code).
 * Curve type/eval: `QuarticCurve` + `evalQ`/`areaQ` in `@sdk/amm`.
 */
export async function readCurve(
  provider: Eip1193Provider,
  pool: Address,
  curveId: number,
): Promise<QuarticCurve | null> {
  if ((await readStorageVersion(provider, pool)) >= 5) {
    const code = (await getCode(provider, curvePointer(pool, curveId))).slice(4); // 0x + STOP
    const words = Array.from({ length: code.length >> 6 }, (_, i) =>
      BigInt(`0x${code.slice(64 * i, 64 * i + 64)}`),
    );
    return decodeCurve(words);
  }
  const base = mappingBaseU16(curveId, POOL_STORAGE.curves);
  // ONE transport round-trip: the segment block is a FIXED uint256[28] slot run (m ≤ 14), so the
  // header and every possible segment word are fetched speculatively together. The transport's
  // tick-batch coalesces these into a single JSON-RPC POST; per-slot eth_getStorageAt cannot ride
  // Multicall3 aggregate3 (raw storage, no view getter by policy - see module header).
  const words = await Promise.all(
    Array.from({ length: 1 + CURVE_SEG_SLOTS }, (_, i) =>
      getStorageAt(provider, pool, base + BigInt(i)),
    ),
  );
  return decodeCurve(words.map((w) => BigInt(w)));
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

/** `PoolStorage.lastGoodCWad` (slot 14 on v2, 13 on v3; on v4 the uint40 `lastGoodCWad9` in slot
 *  0's tail, 1e-9 WAD): the degraded same-asset exit cap (`exitCap`), WAD; 0 until an LP
 *  entrypoint has observed a rate. */
export async function readSolvencyState(
  provider: Eip1193Provider,
  pool: Address,
): Promise<{ lastGoodCWad: bigint }> {
  const layout = poolStorageOf(await readStorageVersion(provider, pool));
  if ('lastGoodCWad' in layout) {
    return { lastGoodCWad: BigInt(await getStorageAt(provider, pool, layout.lastGoodCWad)) };
  }
  const slot0 = BigInt(await getStorageAt(provider, pool, layout.lastGoodCWad9));
  return { lastGoodCWad: (slot0 >> 216n) * 10n ** 9n };
}

const U128 = (1n << 128n) - 1n;
const field = (w: bigint, shift: number, width: number) =>
  Number((w >> BigInt(shift)) & ((1n << BigInt(width)) - 1n));

/** Decoded `IPool.Custody` (layout v3): one word per leg at `custody` (slot 7). */
export interface Custody {
  /** Escrowed protocol slice of the leg's balance, token units. Includes a permanent 1-wei seed
   *  once the leg has taken a deposit: claimable = max(protocolFees - 1, 0). */
  protocolFees: bigint;
  /** Tranche out on the leg's hook; `Asset.reserves = R_liq + invested`. */
  invested: bigint;
}

export function decodeCustody(word: Hex): Custody {
  const w = BigInt(word);
  return { protocolFees: w & U128, invested: w >> 128n };
}

/** A `marks` word (layout v3): a feed exactly as the pool prices it, plus, on word 0 only, the
 *  config mirror. The pool gates `now - obs` against `ttlSecs`. */
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

export function decodeMark(word: Hex): MarkWord {
  const w = BigInt(word);
  const m = MARK_WORD;
  return {
    mark1e18: w & U128,
    obs: field(w, m.OBS_SHIFT, 32),
    sigmaPbps: field(w, m.SIGMA_SHIFT, 27),
    confidenceBps: field(w, m.CONF_SHIFT, 16),
    ttlSecs: field(w, m.TTL_SHIFT, 16),
    maxDevBps: field(w, m.MAX_DEV_SHIFT, 11),
    halted: field(w, m.HALT_SHIFT, 1) === 1,
    internal: field(w, m.INTERNAL_SHIFT, 1) === 1,
    uoa: field(w, m.UOA_SHIFT, 1) === 1,
    refBandBps: field(w, m.REF_BAND_SHIFT, 16),
  };
}

/** A V5 lane float (`mant u25 | exp7 u7 << 25`) as a 1e18 mark. */
export function laneFloat(f: number): bigint {
  const mant = BigInt(f & 0x1ffffff);
  const e = BigInt((f >>> 25) & 0x7f);
  return e >= 16n ? mant << (e - 16n) : mant >> (16n - e);
}

/** A layout-v4 `marks` word as its two feeds. The mirror rides on `primary`; `ref` carries no σ
 *  nor maxDev (the pool never reads them) and is all 0 while the band is disarmed. */
export function decodeMarkWord(word: Hex): { primary: MarkWord; ref: MarkWord } {
  const w = BigInt(word);
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

/** A layout-v5 leg's oracle wiring off its `Asset` slot-2 word. */
export function decodeLegOracle(slot2: Hex): {
  lane: number;
  internal: boolean;
  uoa: boolean;
  refBandBps: number;
} {
  const f = POOL_STRUCTS_V5.Asset;
  const b = u8At(slot2, f.oracleBits[1]);
  return {
    lane: b & MARK_STORE.LANE_MASK,
    internal: (b & MARK_STORE.INTERNAL_BIT) !== 0,
    uoa: (b & MARK_STORE.UOA_BIT) !== 0,
    refBandBps: u16At(slot2, f.refBandBps[1]) & 0xfff, // 12..15 = depeg code
  };
}

/** A store word as a pool prices it for one leg: σ floored at the lane's minSigma, the leg's own
 *  config in the mirror fields. Byte-identical to dex-evm `MarkWordLib.compose`. */
export function decodeStoreWord(
  word: Hex,
  leg: { internal: boolean; uoa: boolean; refBandBps: number },
): { primary: MarkWord; ref: MarkWord } {
  const out = decodeMarkWord(word);
  const floor = Number(BigInt(word) >> BigInt(MARK_STORE.MIN_SIGMA_SHIFT));
  out.primary.sigmaPbps = Math.max(out.primary.sigmaPbps, floor);
  out.primary.internal = leg.internal;
  out.primary.uoa = leg.uoa;
  out.primary.refBandBps = leg.refBandBps;
  return out;
}

/** ERC-1967 impl slot: a pool proxy's live impl, which carries the mark store. */
const IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbcn;

/** The store word of `lane` at `impl` (`PoolFactory.implementation()`). */
async function readStoreWord(provider: Eip1193Provider, impl: Address, lane: number): Promise<Hex> {
  return getStorageAt(provider, impl, MARK_STORE.MS + BigInt(lane));
}

/** `MarkP8Lib.CONF_LO`/`CONF_HI` unpacked: bps of P8 conf codes 32..60. */
export const P8_CONF_TABLE = [
  36, 40, 45, 50, 56, 63, 71, 80, 90, 100, 112, 125, 140, 160, 180, 200, 225, 250, 280, 320, 360,
  400, 450, 500, 560, 640, 720, 850, 1000,
] as const;

/** `MarkStoreP8.classes()`: laneCls (3 bits per lane) | classes 1..5 | 6..7 (47 bits each: ttl u12 |
 *  maxDev u11 at 12 | minSigma u24 at 23). */
export type P8Classes = { laneCls: bigint; clsA: bigint; clsB: bigint };

const CLASSES_SELECTOR = '0x31e77853';
const P8_STORE_ID = keccak256(new TextEncoder().encode('btr.markstore.p8'));

/** The P8 class table off a `classes()` return; `null` for any other store id. */
export function decodeP8Classes(ret: Hex): P8Classes | null {
  const w = (i: number) => BigInt(`0x${ret.slice(2 + 64 * i, 66 + 64 * i) || '0'}`);
  if (ret.length < 258 || w(3) !== BigInt(P8_STORE_ID) || w(0) === 0n) return null;
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

/** Tier `t` (1 = P, 2 = R) word slot of `lane` in a P8 store: 4 lanes per word. */
export function p8TierSlot(tier: 1 | 2, lane: number): bigint {
  return MARK_STORE.MS + (BigInt(tier - 1) << 4n) + BigInt(lane >> 2);
}

/** `lane`'s store word from its P8 tier words: `Pool.fallback`'s decode plus the class minSigma at
 *  `MIN_SIGMA_SHIFT` (the D2b field), so `decodeStoreWord` reads it unchanged. Byte-identical to
 *  core `p8::store_word`. Lane at 56j: mant u24 | e6 24 | age u12 30 | σ8 42 | st u6 50 (62 halted,
 *  63 dark); clock u32 at 224. */
export function p8StoreWord(pw: Hex, rw: Hex, lane: number, c: P8Classes): Hex {
  const sh = BigInt(56 * (lane & 3));
  const [P, R] = [BigInt(pw), BigInt(rw)];
  const [p, r] = [(P >> sh) & ((1n << 56n) - 1n), (R >> sh) & ((1n << 56n) - 1n)];
  const M30 = 0x3fffffffn;
  if ((p & M30) === 0n && p >> 50n < 62n) return `0x${'0'.repeat(64)}`;
  const [ttl, maxDev, floor] = p8ClassOf(c, lane);
  const tier = (v: bigint, tw: bigint, cs: bigint): bigint => {
    const st = v >> 50n;
    const obs = ((tw >> 224n) - ((v >> 30n) & 0xfffn)) & 0xffffffffn;
    const live = st < 62n && (v & M30) !== 0n;
    const f = ((v & 0xffffffn) | ((v & 0x3f000000n) << 1n)) + 0x21000000n;
    return (obs << 32n) | (live ? f | (BigInt(p8Conf(Number(st))) << cs) : 0n);
  };
  const w =
    tier(p, P, 91n) |
    (tier(r, R, 64n) << 135n) |
    (BigInt(p8Sigma(Number((p >> 42n) & 0xffn), floor)) << 64n) |
    (BigInt(ttl) << 107n) |
    (BigInt(ttl) << 215n) |
    (BigInt(maxDev) << 123n) |
    (BigInt(p >> 50n === 62n) << 134n) |
    (BigInt(r >> 50n === 62n) << 231n) |
    (BigInt(floor) << BigInt(MARK_STORE.MIN_SIGMA_SHIFT));
  return `0x${w.toString(16).padStart(64, '0')}`;
}

/** The impl store's P8 class table; `null` for a D2b store, which reverts `classes()`. Throws on
 *  a failed read or a table without the P8 id: neither layout, so no mark (fail closed). */
async function readP8Classes(provider: Eip1193Provider, impl: Address): Promise<P8Classes | null> {
  let r: Hex;
  try {
    r = (await provider.request({
      method: 'eth_call',
      params: [{ to: impl, data: CLASSES_SELECTOR }, 'latest'],
    })) as Hex;
  } catch (e) {
    // EIP-1474 code 3, or geth's bare "execution reverted" for an empty revert
    const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown };
    if (code === 3 || /^execution reverted/i.test(String(message ?? ''))) return null;
    throw e;
  }
  const c = decodeP8Classes(r);
  if (!c) throw new Error(`classes() of ${impl} is not a P8 table`);
  return c;
}

/** A leg's two feeds as its pool prices them; `null` on a v2 pool, which reads its oracle live. */
export async function readMarks(
  provider: Eip1193Provider,
  pool: Address,
  token: Address,
): Promise<{ primary: MarkWord; ref: MarkWord } | null> {
  const version = await readStorageVersion(provider, pool);
  if (version < 3) return null;
  const key = await resolveTokenStorageKey(provider, pool, token);
  if (version >= 5) {
    const [slot2, implWord] = await Promise.all([
      getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE_V5.assets) + 2n),
      getStorageAt(provider, pool, IMPL_SLOT),
    ]);
    const leg = decodeLegOracle(slot2);
    const impl = addressAt(implWord, 0);
    const cls = await readP8Classes(provider, impl);
    if (!cls) return decodeStoreWord(await readStoreWord(provider, impl, leg.lane), leg);
    const [pw, rw] = await Promise.all([
      getStorageAt(provider, impl, p8TierSlot(1, leg.lane)),
      getStorageAt(provider, impl, p8TierSlot(2, leg.lane)),
    ]);
    return decodeStoreWord(p8StoreWord(pw, rw, leg.lane, cls), leg);
  }
  if (version >= 4) {
    return decodeMarkWord(
      await getStorageAt(provider, pool, mappingBase(key, POOL_STORAGE_V4.marks)),
    );
  }
  const base = mappingBase(key, POOL_STORAGE_V3.marks);
  const [w0, w1] = await Promise.all([
    getStorageAt(provider, pool, base),
    getStorageAt(provider, pool, base + 1n),
  ]);
  return { primary: decodeMark(w0), ref: decodeMark(w1) };
}
