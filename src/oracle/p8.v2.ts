/**
 * `MarkStoreP8.publishMarks` calldata (WIRE 2, `storageVersion() 5..9`: Arc, Monad v1; wire 3 is `p8.ts`): segment walk, signature recovery and the on-chain roster
 * check, byte for byte what `MarkStoreP8._segment` / `MarkStoreBase._quorum` accept.
 *
 * Calldata = selector | segment*. A segment = `t u8 | srcSecs u32 | lane mask u64`, then per set
 * lane its entry (`markF u32 | code u8`, plus `σ8 u8` when `code & 0x80`), then the quorum tail
 * `nSigners u8 | signers | k u8 | nRelayers u8 | relayers | k × r‖s‖v`. The k signatures sign
 * `BatchQuoteV4(keccak(segment up to the tail))` under tier t's domain, and keccak of the tail
 * prefix (to the signatures) must equal tier t's committed half of the store's auth word
 * (`MarkStoreBase.AUTH`, read with `P8_AUTH_READ_V2`), so the roster in the calldata IS the on-chain one.
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256 } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { recoverDigestSigner, tierVerifier } from './eip712';
import { pushDigest } from './wire';

const PUBLISH_MARKS_SELECTOR = '0x013b6436';
/** `MarkStoreBase` is constructed with version "2"; the name is the oracle family's. */
const P8_DOMAIN = { name: 'BTR ExternalOracleV4', version: '2' } as const;
/** `MarkP8Lib.CONF_MAX`: the highest conf code a lane entry may carry. */
const P8_CONF_MAX = 61;
/** The store's raw read of its auth word: byte `0x80 | AUTH (0x40)` (`Pool.fallback`'s raw path). */
export const P8_AUTH_READ_V2: Hex = '0xc0';

/** One lane entry as the store reads it: `markF u32 | code u8 [| σ8 u8]`. The signatures cover
 *  these bytes, so this is the signed price a UI can bind a displayed number to. */
export interface P8Entry {
  /** Lane index = bit position in the segment's lane mask. */
  lane: number;
  /** The signed mark, 1e18 per unit in the pool's catalog unit (25-bit mantissa, so ~3e-8 exact). */
  mark1e18: bigint;
  /** Conf code (7 bits). */
  confCode: number;
  /** σ8 code when the entry carries one. */
  sigma8?: number;
}

/** `markF` float (`mant u25 | exp7 << 25`) as 1e18: `mant << (exp - 16)`, right shift below 16. */
const markF = (f: number): bigint => {
  const mant = BigInt(f & 0x1ffffff);
  const e = BigInt((f >>> 25) & 0x7f);
  return e >= 16n ? mant << (e - 16n) : mant >> (16n - e);
};

/** The entry at `p` for `lane`, and its byte length (5, or 6 with σ8). Caller has bounds-checked. */
export function readLaneEntry(b: Uint8Array, p: number, lane: number): { e: P8Entry; n: number } {
  const f = new DataView(b.buffer, b.byteOffset + p, 4).getUint32(0);
  const withSigma = (b[p + 4] & 0x80) !== 0;
  return {
    e: {
      lane,
      mark1e18: markF(f),
      confCode: b[p + 4] & 0x7f,
      ...(withSigma && { sigma8: b[p + 5] }),
    },
    n: withSigma ? 6 : 5,
  };
}

export interface P8SegmentV2 {
  tier: 1 | 2;
  /** Source second the segment's marks carry. */
  srcSecs: number;
  /** Lanes the segment carries (the store may skip a halted or non-advancing one). */
  lanes: number;
  /** The carried lanes' signed entries, in lane order. */
  entries: P8Entry[];
  /** The roster the calldata carries (ascending) and the threshold it commits to. */
  roster: Address[];
  k: number;
  relayers: Address[];
  /** What each of the k signatures recovers to, in order. */
  recovered: Address[];
  /** keccak of the roster tail matches tier `tier`'s half of the store's auth word. */
  committed: boolean;
  /** The k recovered signers are strictly ascending and each on the roster. */
  quorum: boolean;
  /** `committed && quorum`: the signatures and roster are valid. The store also needs the sender
   *  on `relayers`, which a landed tx implies; compare `tx.from` to check it. */
  ok: boolean;
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Verify every segment of one `publishMarks` tx input against `auth`, the store's word 0x40. */
export function verifyPushP8V2(
  calldata: Hex,
  ctx: { factory: Address; chainId: number; auth: bigint },
): P8SegmentV2[] {
  if (!calldata.toLowerCase().startsWith(PUBLISH_MARKS_SELECTOR)) {
    throw new Error('not a publishMarks call');
  }
  const b = hexToBytes(calldata.slice(2));
  const need = (end: number) => {
    if (end > b.length) throw new Error('truncated push calldata');
  };
  const addrs = (at: number, n: number): Address[] =>
    Array.from({ length: n }, (_, i) =>
      checksumAddress(`0x${hex(b.slice(at + 20 * i, at + 20 * i + 20))}` as Address),
    );
  const out: P8SegmentV2[] = [];
  for (let off = 4; off < b.length; ) {
    need(off + 13);
    const tier = b[off];
    if (tier !== 1 && tier !== 2) throw new Error(`bad segment tier ${tier}`);
    const srcSecs = new DataView(b.buffer, b.byteOffset + off + 1, 4).getUint32(0);
    let mask = new DataView(b.buffer, b.byteOffset + off + 5, 8).getBigUint64(0);
    if (mask === 0n) throw new Error('empty lane mask');
    let p = off + 13;
    let lanes = 0;
    const entries: P8Entry[] = [];
    for (let lane = 0; mask !== 0n; mask >>= 1n, lane++) {
      if ((mask & 1n) === 0n) continue;
      need(p + 5);
      // `_lane` reverts on a conf code above CONF_MAX.
      if ((b[p + 4] & 0x7f) > P8_CONF_MAX) throw new Error('lane conf code out of range');
      need(p + (b[p + 4] & 0x80 ? 6 : 5));
      const r = readLaneEntry(b, p, lane);
      entries.push(r.e);
      p += r.n;
      lanes++;
    }
    need(p + 1);
    const nSig = b[p];
    const kAt = p + 1 + 20 * nSig;
    need(kAt + 2);
    const k = b[kAt];
    const sigs = kAt + 2 + 20 * b[kAt + 1];
    need(sigs + 65 * k);
    const digest = pushDigest(b.slice(off, p), {
      ...P8_DOMAIN,
      chainId: ctx.chainId,
      verifyingContract: tierVerifier(ctx.factory, tier),
    });
    const roster = addrs(p + 1, nSig);
    // The contract hands `v` to ecrecover as is, which takes 27 or 28 only.
    for (let i = 0; i < k; i++) {
      const v = b[sigs + 65 * i + 64];
      if (v !== 27 && v !== 28) throw new Error(`bad signature recovery byte ${v}`);
    }
    const recovered = Array.from({ length: k }, (_, i) =>
      recoverDigestSigner(digest, b.slice(sigs + 65 * i, sigs + 65 * (i + 1))),
    );
    const half = (ctx.auth >> BigInt((2 - tier) << 7)) & ((1n << 128n) - 1n);
    const committed = BigInt(keccak256(b.slice(p, sigs)).slice(0, 34)) === half;
    const onRoster = new Set(roster.map((a) => a.toLowerCase()));
    const quorum =
      k > 0 &&
      recovered.every(
        (a, i) =>
          onRoster.has(a.toLowerCase()) &&
          (i === 0 || BigInt(recovered[i - 1].toLowerCase()) < BigInt(a.toLowerCase())),
      );
    out.push({
      tier,
      srcSecs,
      lanes,
      entries,
      roster,
      k,
      relayers: addrs(kAt + 2, b[kAt + 1]),
      recovered,
      committed,
      quorum,
      ok: committed && quorum,
    });
    off = sigs + 65 * k;
  }
  return out;
}
