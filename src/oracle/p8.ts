/**
 * `MarkStoreP8.publishMarks` calldata (wire 3): segment walk, signature recovery and the roster
 * check, byte for byte what `MarkStoreP8._segment` / `MarkStoreBase._quorum` accept.
 *
 * Calldata = selector | segment*. A segment = `t u8 | srcMs u48 | lane mask u64`, then per set
 * lane its entry (`markF u32 | code u8`, plus `σ8 u8` when `code & 0x80`), then the quorum tail
 * `signerBitmap u16 | k × r‖s‖v` in ascending bit order. Bit i selects signer i of the tier's
 * STORED roster (ascending by address); the roster, k and the relayers are no longer in calldata.
 * The k signatures sign `BatchQuoteV4(keccak(header | lanes))` under tier t's domain.
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import type { Address, Hex } from '../eth/types';
import { wireOf } from '../pool/storage';
import { recoverDigestSigner, tierVerifier } from './eip712';
import { type P8SegmentV2, verifyPushP8V2 } from './p8.v2';
import { pushDigest } from './wire';

/** `publishMarks()`. */
export const PUBLISH_MARKS_SELECTOR = '0x013b6436';
/** `MarkStoreBase` is constructed with version "3"; the name is the oracle family's. */
const P8_DOMAIN = { name: 'BTR ExternalOracleV4', version: '3' } as const;
/** `MarkP8Lib.CONF_MAX`: the highest conf code a lane entry may carry. */
const P8_CONF_MAX = 61;
/** The store's raw read of its auth word: byte `0x80 | AUTH (0x20)` (`Pool.fallback`'s raw path).
 *  Tier t at bit `32 (t - 1)`: `n u8 | k u8 | nRelayers u8`. */
export const P8_AUTH_READ: Hex = '0xa0';
/** Raw read of tier t's signer i: `0x80 | (0x30 + 16 (t - 1) + i)` = `0xB0 + 16 (t - 1) + i`. The
 *  word is `address | 1 << 160 if disabled`. */
export const p8SignerRead = (tier: 1 | 2, i: number): Hex =>
  `0x${(0xb0 + 16 * (tier - 1) + i).toString(16)}`;
/** Raw read of tier t's relayer i: `0xD0 + 16 (t - 1) + i`. */
export const p8RelayerRead = (tier: 1 | 2, i: number): Hex =>
  `0x${(0xd0 + 16 * (tier - 1) + i).toString(16)}`;

export interface P8Segment {
  tier: 1 | 2;
  /** Source time (unix ms) the segment's marks carry. */
  srcMs: number;
  /** Lanes the segment carries (the store may skip a halted or non-advancing one). */
  lanes: number;
  /** Signer bitmap: bit i = signer i of the tier's stored roster. */
  bitmap: number;
  /** The stored threshold; the bitmap must set exactly k bits. */
  k: number;
  /** What each of the signatures recovers to, in bit order. */
  recovered: Address[];
  /** Bitmap and signatures valid against the stored roster: exactly k bits, each < n, each
   *  signature recovering to a live (not disabled) signer at its bit. */
  quorum: boolean;
  /** Same as `quorum`. The store also needs the sender on the tier's relayers, which a landed tx
   *  implies; compare `tx.from` to check it. */
  ok: boolean;
}

/** Verify every segment of one `publishMarks` tx input. `auth` is the store's word 0x20 and
 *  `signers[t]` the raw signer words of tier t (`p8SignerRead`), n of them per `auth`. */
export function verifyPushP8(
  calldata: Hex,
  ctx: { factory: Address; chainId: number; auth: bigint; signers: Record<1 | 2, Hex[]> },
): P8Segment[] {
  if (!calldata.toLowerCase().startsWith(PUBLISH_MARKS_SELECTOR)) {
    throw new Error('not a publishMarks call');
  }
  const b = hexToBytes(calldata.slice(2));
  const need = (end: number) => {
    if (end > b.length) throw new Error('truncated push calldata');
  };
  const out: P8Segment[] = [];
  for (let off = 4; off < b.length; ) {
    need(off + 15);
    const tier = b[off];
    if (tier !== 1 && tier !== 2) throw new Error(`bad segment tier ${tier}`);
    const dv = new DataView(b.buffer, b.byteOffset + off + 1, 14);
    const srcMs = dv.getUint16(0) * 2 ** 32 + dv.getUint32(2);
    let mask = dv.getBigUint64(6);
    if (mask === 0n) throw new Error('empty lane mask');
    let p = off + 15;
    let lanes = 0;
    for (; mask !== 0n; mask >>= 1n) {
      if ((mask & 1n) === 0n) continue;
      need(p + 5);
      // `_lane` reverts on a conf code above CONF_MAX.
      if ((b[p + 4] & 0x7f) > P8_CONF_MAX) throw new Error('lane conf code out of range');
      p += b[p + 4] & 0x80 ? 6 : 5;
      lanes++;
    }
    const cfg = ctx.auth >> BigInt(32 * (tier - 1));
    const n = Number(cfg & 0xffn);
    const k = Number((cfg >> 8n) & 0xffn);
    need(p + 2);
    const bitmap = (b[p] << 8) | b[p + 1];
    let bits = 0;
    for (let m = bitmap; m; m >>= 1) bits += m & 1;
    const sigs = p + 2;
    need(sigs + 65 * k);
    const digest = pushDigest(b.slice(off, p), {
      ...P8_DOMAIN,
      chainId: ctx.chainId,
      verifyingContract: tierVerifier(ctx.factory, tier),
    });
    // The contract hands `v` to ecrecover as is, which takes 27 or 28 only.
    for (let i = 0; i < k; i++) {
      const v = b[sigs + 65 * i + 64];
      if (v !== 27 && v !== 28) throw new Error(`bad signature recovery byte ${v}`);
    }
    const recovered = Array.from({ length: k }, (_, i) =>
      recoverDigestSigner(digest, b.slice(sigs + 65 * i, sigs + 65 * (i + 1))),
    );
    // Bits ascend with the signatures. A disabled signer's word carries bit 160, never matching.
    const bitIdx: number[] = [];
    for (let i = 0; i < 16; i++) if ((bitmap >> i) & 1) bitIdx.push(i);
    const quorum =
      k > 0 &&
      bits === k &&
      bitmap >> n === 0 &&
      bitIdx.every((bit, j) => {
        const w = ctx.signers[tier][bit];
        return w !== undefined && BigInt(w) === BigInt(recovered[j].toLowerCase());
      });
    out.push({ tier, srcMs, lanes, bitmap, k, recovered, quorum, ok: quorum });
    off = sigs + 65 * k;
  }
  return out;
}

export type P8Verified = { wire: 2; segments: P8SegmentV2[] } | { wire: 3; segments: P8Segment[] };

/** Verify one `publishMarks` tx input against the wire the pool's `storageVersion` runs: 5..9 =
 *  wire 2 (`p8.v2.ts`, `auth` = word `P8_AUTH_READ_V2`), 10 = wire 3 (`signers` required). Exact
 *  match like `layoutOf`; any other version throws. */
export function verifyPushP8At(
  storageVersion: number,
  calldata: Hex,
  ctx: { factory: Address; chainId: number; auth: bigint; signers?: Record<1 | 2, Hex[]> },
): P8Verified {
  if (wireOf(storageVersion) === 2) {
    return { wire: 2, segments: verifyPushP8V2(calldata, ctx) };
  }
  if (!ctx.signers) throw new Error('wire 3 verification needs the stored signer words');
  return { wire: 3, segments: verifyPushP8(calldata, { ...ctx, signers: ctx.signers }) };
}
