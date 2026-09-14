/**
 * Wire codecs + EIP-712 digests for the ExternalOracleV4/V5 push path.
 *
 * V5 (`ExternalOracleV4.pushV4` / `pushSignedV4`): 8 x 29-bit lanes, wire v5 DIFF blobs, 11-byte
 * header, 5-byte price entries, `tsDs` = deciseconds since midnight UTC (cyclic, no epoch).
 *
 * V6 (`ExternalOracleV5.push`): 12-byte header (`srcSecs` = ABSOLUTE source second u32, A-262),
 * same 5/5/3-byte sections, but the price lane is a self-describing u32 (`exp7:u7 | mant:u25`,
 * `mark = mant << (exp7 - 16)`, no per-feed bias) and `nC == nP` is mandatory: price and conf are
 * walked in lockstep on the same `gi` sequence.
 *
 * Byte-contract is LOCKED against the shared fixtures
 * dex-evm/test/fixtures/oracle-v5-wire-golden.json (keccak = 0x66151804…9b35) and
 * dex-evm/test/fixtures/oracle-v6-wire-golden.json.
 * Signature recovery + k-of-n quorum live in `eip712.ts` (`recoverSigners` / `verifyQuorum`) -
 * one recovery path, no parity drift.
 */

import { keccak256, keccak256Input } from '../eth/index';
import type { Hex } from '../eth/types';
import { concat, numberToHex, pad } from '../utils/encoding';
import { EIP712_DOMAIN_TYPEHASH, type Eip712Domain } from './eip712';

/** Live wire generations: v5 blobs carry version byte 5, v6 blobs version byte 6. */
export type PushWire = 'v5' | 'v6';

/** keccak256("BatchQuoteV4(bytes32 blobHash)") - the wire-v5 push typehash (ExternalOracleV4). */
export const BATCH_TYPEHASH_V4 = keccak256Input('BatchQuoteV4(bytes32 blobHash)');
/** keccak256("SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)") */
export const SESSION_TYPEHASH = keccak256Input(
  'SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)',
);

export const V5_BLOB_VERSION = 5;
export const V5_HEADER_BYTES = 11; // ver u8 | seq u32 | tsDs u24 | nP u8 | nS u8 | nC u8
export const V5_PRICE_ENTRY_BYTES = 5; // gi u8 | lane u32 (top 3 bits zero)
export const V5_SIGMA_ENTRY_BYTES = 5; // gi u8 | sigmaPbps u32
export const V5_CONF_ENTRY_BYTES = 3; // gi u8 | confBps u16
/** ExternalOracleV4.LANES_PER_SLOT - 8, down from V3's 10 (wider lanes). */
export const V5_LANES_PER_SLOT = 8;
/** 29 significant lane bits; the top 3 of the u32 entry are reserved and MUST be zero. */
export const V5_LANE_MASK = (1 << 29) - 1;
/** Mantissa MSB (bit 24): set ⇔ live price; clear + nonzero = a sentinel-write the chain skips. */
export const V5_MANT_MSB = 1 << 24;
/** Deciseconds in a day: the modulus of the v5 `tsDs` field (u20 value, zero-padded to u24). */
export const V5_DAY_DS = 864_000;

export const V6_BLOB_VERSION = 6;
export const V6_HEADER_BYTES = 12; // ver u8 | seq u32 | srcSecs u32 | nP u8 | nS u8 | nC u8
/** `mark = mant << (exp7 - 16)`: the self-describing exponent is absolute, no per-feed bias. */
export const V6_EXP_OFFSET = 16;
/** `ExternalOracleV5._checkHeader` bounds on `srcSecs` against `block.timestamp`. */
export const V6_SOURCE_TS_FUTURE_SKEW_SECS = 5;
export const V6_MAX_SOURCE_AGE_SECS = 6 * 3600;

/** V5 lane geometry `exp:u4 | mant:u25` (caller-supplied bias) and v6 `exp7:u7 | mant:u25`. */
const LANE_SPEC: Record<PushWire, { mantBits: number; expBits: number }> = {
  v5: { mantBits: 25, expBits: 4 },
  v6: { mantBits: 25, expBits: 7 },
};

const toBytes = (b: Hex | Uint8Array): Uint8Array => {
  if (typeof b !== 'string') return b;
  if (!/^0x[0-9a-fA-F]*$/.test(b)) throw new Error('hex blob must be 0x-prefixed hex');
  const h = b.slice(2);
  if (h.length % 2 !== 0) throw new Error(`hex blob odd length ${h.length}: full octets only`);
  return Uint8Array.from((h.match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
};

function readUint(bytes: Uint8Array, off: number, len: number): bigint {
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

function writeUint(bytes: Uint8Array, off: number, len: number, value: bigint): void {
  let v = value;
  for (let i = len - 1; i >= 0; i--, v >>= 8n) bytes[off + i] = Number(v & 0xffn);
}

const checkGi = (version: number, gi: number, last: number, section: string): void => {
  if (!Number.isInteger(gi) || gi < 0 || gi > 255)
    throw new Error(`V${version} ${section} gi ${gi} not u8`);
  if (gi <= last)
    throw new Error(`V${version} ${section} entries not ascending by gi (${gi} after ${last})`);
};

/**
 * Decode one packed price lane to mark1e18.
 *  - v5 `exp:u4 | mant:u25`: `exp = raw + expBias`; the caller carries the per-feed bias.
 *  - v6 `exp7:u7 | mant:u25`: SELF-DESCRIBING, `exp = raw - 16`; `expBias` is ignored.
 * The all-zero lane (and any lane with the mantissa MSB unset) is the STALE sentinel -> 0n,
 * exactly the fail-closed value `getFeed` serves.
 */
export function decodeLane(lane: bigint | number, expBias: number, wire: PushWire): bigint {
  const l = BigInt(lane);
  const { mantBits } = LANE_SPEC[wire];
  const mant = l & ((1n << BigInt(mantBits)) - 1n);
  if ((mant & (1n << BigInt(mantBits - 1))) === 0n) return 0n; // STALE sentinel
  const raw = Number(l >> BigInt(mantBits));
  const exp = wire === 'v6' ? raw - V6_EXP_OFFSET : raw + expBias;
  return exp >= 0 ? mant << BigInt(exp) : mant >> BigInt(-exp);
}

/**
 * Normalize a 1e18 value into a lane (test/golden mirror of the Solidity `_lane` helpers).
 * Floor-encode: mantissa lands in [2^(mantBits-1), 2^mantBits). Throws when no exponent fits.
 * v6 ignores `expBias` and derives the absolute `exp7` (so the contract and keeper read it back
 * without knowing the feed's original bias).
 */
export function encodeLane(value1e18: bigint, expBias: number, wire: PushWire): number {
  const { mantBits, expBits } = LANE_SPEC[wire];
  const expMax = 1 << expBits;
  const lo = 1n << BigInt(mantBits - 1);
  const hi = 1n << BigInt(mantBits);
  for (let e = 0; e < expMax; e++) {
    const shift = wire === 'v6' ? e - V6_EXP_OFFSET : e + expBias;
    const m = shift >= 0 ? value1e18 >> BigInt(shift) : value1e18 << BigInt(-shift);
    if (m >= lo && m < hi) return (e << mantBits) | Number(m);
  }
  throw new Error(`no exponent fits value ${value1e18} at bias ${expBias} (${wire})`);
}

// ── wire v5 (ExternalOracleV4): 11B header, 5B price entries, 29-bit lanes ───────────────────

/** A price entry: `gi:u8 | lane:u32` with the top 3 bits zero (29 significant lane bits). */
export interface V5PriceEntry {
  gi: number;
  /** raw 29-bit lane; 0 (or mantissa MSB unset) = STALE sentinel. Decode with {@link decodeLane}. */
  lane: number;
}

export interface V5Blob {
  /** Always 5. The version byte, not the oracle's name (the contract is ExternalOracleV4). */
  version: number;
  seq: number;
  /** DECISECONDS SINCE MIDNIGHT UTC, [0, 864000). Cyclic - no epoch. See {@link reconSecsFromDs}. */
  tsDs: number;
  prices: V5PriceEntry[];
  sigmas: Array<{ gi: number; sigmaPbps: number }>;
  confs: Array<{ gi: number; confBps: number }>;
}

/**
 * Decode a wire-v5 DIFF blob: header 11B (`ver:u8=5 | seq:u32 | tsDs:u24 | nP:u8 | nS:u8 | nC:u8`),
 * then nP x 5B price entries (gi u8 | lane u32), nS x 5B sigma entries (gi u8 | sigmaPbps u32),
 * nC x 3B conf entries (gi u8 | confBps u16).
 *
 * Fails closed where `_checkHeader` reverts `BadBlobHeader` (wrong version, `tsDs >= 864000`,
 * all-empty blob, length disagreeing with section counts, reserved top-3 lane bits, non-ascending
 * `gi`), plus anywhere the price walk SKIPS instead of pricing: a nonzero lane with the mantissa
 * MSB clear is the sentinel-write the chain flags and ignores, so the decoder rejects it rather
 * than carrying a lane that will never become a mark.
 *
 * `dayMod` is NOT read here: it is a storage-only tag the contract derives from the reconstructed
 * source day, never a wire field.
 */
export function decodeBlobV5(blob: Hex | Uint8Array): V5Blob {
  const { ts, ...d } = decodeBlob(blob, V5_BLOB_VERSION);
  return { ...d, tsDs: ts };
}

/** One walker for both wires: v6 differs in the header clock (`srcSecs` u32 absolute vs `tsDs`
 *  u24 cyclic, so a 12B header), the lane rule (no reserved bits, sentinels kept) and the
 *  `nC == nP` conf lockstep. `ts` is the raw header clock in the wire's own unit. */
function decodeBlob(
  blob: Hex | Uint8Array,
  version: number,
): Omit<V5Blob, 'tsDs'> & { ts: number } {
  const v = `V${version}`;
  const v6 = version === V6_BLOB_VERSION;
  const hdr = v6 ? V6_HEADER_BYTES : V5_HEADER_BYTES;
  const b = toBytes(blob);
  if (b.length < hdr) throw new Error(`${v} blob length ${b.length} shorter than header`);
  if (b[0] !== version) throw new Error(`${v} blob version ${b[0]} != ${version}`);
  const ts = Number(readUint(b, 5, hdr - 8));
  if (!v6 && ts >= V5_DAY_DS) throw new Error(`${v} tsDs ${ts} outside [0, ${V5_DAY_DS})`);
  const nP = b[hdr - 3];
  const nS = b[hdr - 2];
  const nC = b[hdr - 1];
  if (v6 ? nP === 0 : nP === 0 && nS === 0 && nC === 0)
    throw new Error(`${v} blob carries no entries`);
  if (v6 && nC !== nP)
    throw new Error(`${v} blob nC ${nC} != nP ${nP} (conf is mandatory per price entry)`);
  const want =
    hdr + nP * V5_PRICE_ENTRY_BYTES + nS * V5_SIGMA_ENTRY_BYTES + nC * V5_CONF_ENTRY_BYTES;
  if (b.length !== want) {
    throw new Error(`${v} blob length ${b.length} != sections (${nP}p ${nS}s ${nC}c => ${want})`);
  }
  const prices: V5Blob['prices'] = [];
  const sigmas: V5Blob['sigmas'] = [];
  const confs: V5Blob['confs'] = [];
  let o = hdr;
  let last = -1;
  for (let i = 0; i < nP; i++, o += V5_PRICE_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(version, gi, last, 'price');
    last = gi;
    const lane = Number(readUint(b, o + 1, 4));
    if (!v6) {
      if (lane > V5_LANE_MASK)
        throw new Error(`V5 lane ${lane} sets a reserved top bit (gi ${gi})`);
      if (lane !== 0 && (lane & V5_MANT_MSB) === 0) {
        throw new Error(
          `V5 lane ${lane} MSB-clear sentinel (gi ${gi}): chain skips, never a price`,
        );
      }
    }
    prices.push({ gi, lane });
  }
  last = -1;
  for (let i = 0; i < nS; i++, o += V5_SIGMA_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(version, gi, last, 'sigma');
    last = gi;
    sigmas.push({ gi, sigmaPbps: Number(readUint(b, o + 1, 4)) });
  }
  last = -1;
  for (let i = 0; i < nC; i++, o += V5_CONF_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(version, gi, last, 'conf');
    last = gi;
    confs.push({ gi, confBps: Number(readUint(b, o + 1, 2)) });
    if (v6 && gi !== prices[i].gi) {
      throw new Error(`V6 price/conf gi mismatch: price gi ${prices[i].gi} vs conf gi ${gi}`);
    }
  }
  return { version: b[0], seq: Number(readUint(b, 1, 4)), ts, prices, sigmas, confs };
}

/**
 * Encode a wire-v5 DIFF blob. The byte-exact inverse of {@link decodeBlobV5}; it validates every
 * field the contract validates rather than silently reordering or truncating, so a blob this
 * produces is one `pushV4` accepts.
 */
export function encodeBlobV5(b: Omit<V5Blob, 'version'>): Uint8Array {
  const { seq, tsDs, prices, sigmas, confs } = b;
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) throw new Error(`V5 bad seq ${seq}`);
  if (!Number.isInteger(tsDs) || tsDs < 0 || tsDs >= V5_DAY_DS) {
    throw new Error(`V5 tsDs ${tsDs} outside [0, ${V5_DAY_DS})`);
  }
  if (prices.length > 255 || sigmas.length > 255 || confs.length > 255) {
    throw new Error('V5 section counts are u8');
  }
  if (prices.length === 0 && sigmas.length === 0 && confs.length === 0) {
    throw new Error('V5 blob carries no entries');
  }
  const out = new Uint8Array(
    V5_HEADER_BYTES +
      prices.length * V5_PRICE_ENTRY_BYTES +
      sigmas.length * V5_SIGMA_ENTRY_BYTES +
      confs.length * V5_CONF_ENTRY_BYTES,
  );
  writeUint(out, 0, 1, BigInt(V5_BLOB_VERSION));
  writeUint(out, 1, 4, BigInt(seq));
  writeUint(out, 5, 3, BigInt(tsDs));
  out[8] = prices.length;
  out[9] = sigmas.length;
  out[10] = confs.length;
  let o = V5_HEADER_BYTES;
  let last = -1;
  for (const p of prices) {
    checkGi(V5_BLOB_VERSION, p.gi, last, 'price');
    last = p.gi;
    if (p.lane < 0 || p.lane > V5_LANE_MASK) {
      throw new Error(`V5 lane ${p.lane} outside 29 bits (gi ${p.gi})`);
    }
    if (p.lane !== 0 && (p.lane & V5_MANT_MSB) === 0) {
      throw new Error(
        `V5 lane ${p.lane} MSB-clear sentinel (gi ${p.gi}): chain skips, never a price`,
      );
    }
    out[o] = p.gi;
    writeUint(out, o + 1, 4, BigInt(p.lane));
    o += V5_PRICE_ENTRY_BYTES;
  }
  last = -1;
  for (const s of sigmas) {
    checkGi(V5_BLOB_VERSION, s.gi, last, 'sigma');
    last = s.gi;
    if (s.sigmaPbps < 0 || s.sigmaPbps > 0xffffffff) {
      throw new Error(`V5 sigmaPbps ${s.sigmaPbps} outside u32 (gi ${s.gi})`);
    }
    out[o] = s.gi;
    writeUint(out, o + 1, 4, BigInt(s.sigmaPbps));
    o += V5_SIGMA_ENTRY_BYTES;
  }
  last = -1;
  for (const c of confs) {
    checkGi(V5_BLOB_VERSION, c.gi, last, 'conf');
    last = c.gi;
    if (c.confBps < 0 || c.confBps > 0xffff) {
      throw new Error(`V5 confBps ${c.confBps} outside u16 (gi ${c.gi})`);
    }
    out[o] = c.gi;
    writeUint(out, o + 1, 2, BigInt(c.confBps));
    o += V5_CONF_ENTRY_BYTES;
  }
  return out;
}

// ── wire v6 (ExternalOracleV5): 12B header (absolute srcSecs), self-describing exp7 lane, nC == nP

/** v5 sections with an ABSOLUTE clock (`version` is 6); the lane is a full-u32 `exp7:u7 | mant:u25`
 *  and `confs` is one per price entry in the same `gi` order. */
export type V6Blob = Omit<V5Blob, 'tsDs'> & {
  /** Absolute source second (unix), the header's u32. No reconstruction, no day ambiguity. */
  srcSecs: number;
};

/**
 * Decode a wire-v6 DIFF blob: header 12B (`ver:u8=6 | seq:u32 | srcSecs:u32 | nP:u8 | nS:u8 | nC:u8`),
 * then nP x 5B price entries (gi u8 | lane u32), nS x 5B sigma entries, nC x 3B conf entries.
 *
 * Fails closed where `_checkHeader` reverts `BadBlobHeader` (wrong version, `nP == 0`, `nC != nP`,
 * length disagreeing with section counts, non-ascending `gi`), plus a price/conf `gi` sequence
 * that is not identical. With `nowSecs` (the pushing block's timestamp) it also applies the
 * chain's `FutureTimestamp` / `StaleTimestamp` bounds on `srcSecs`. The lane's absolute `exp7`
 * uses all 32 bits, so there is NO reserved-top-bit rule; a nonzero lane with the mantissa MSB
 * clear is the sentinel-write `_applyLane` SKIPS (returns false) rather than reverts, so the
 * decoder keeps it and `decodeLane` reads it as the stale 0n.
 */
export function decodeBlobV6(blob: Hex | Uint8Array, nowSecs?: number): V6Blob {
  const { ts, ...d } = decodeBlob(blob, V6_BLOB_VERSION);
  if (nowSecs !== undefined) {
    if (ts > nowSecs + V6_SOURCE_TS_FUTURE_SKEW_SECS)
      throw new Error(`V6 srcSecs ${ts} in the future of ${nowSecs}`);
    if (ts + V6_MAX_SOURCE_AGE_SECS < nowSecs)
      throw new Error(`V6 srcSecs ${ts} stale at ${nowSecs}`);
  }
  return { ...d, srcSecs: ts };
}

/**
 * Absolute seconds for a v5 `tsDs`, the client mirror of `ExternalOracleV4._recon`: pick the
 * nearest candidate day around `nowSecs`. Unambiguous for any true age under +/-12h; a caller
 * MUST still bound the result (the contract rejects anything outside
 * [now - MAX_RECON_AGE, now + SOURCE_TS_FUTURE_SKEW]) before trusting it.
 */
export function reconSecsFromDs(nowSecs: number, tsDs: number): number {
  const nowDs = (nowSecs % 86_400) * 10;
  let d = tsDs - nowDs;
  if (d > V5_DAY_DS / 2) d -= V5_DAY_DS;
  else if (d < -V5_DAY_DS / 2) d += V5_DAY_DS;
  return nowSecs + Math.trunc(d / 10);
}

/** EIP-712 domain separator (solady shape: name, version, chainId, verifyingContract). */
export function domainSeparator(domain: Eip712Domain): Hex {
  return keccak256(
    concat([
      EIP712_DOMAIN_TYPEHASH,
      keccak256Input(domain.name),
      keccak256Input(domain.version),
      pad(numberToHex(BigInt(domain.chainId))),
      pad(domain.verifyingContract),
    ]),
  );
}

/**
 * The digest the push quorum signs: keccak(0x1901 ++ domainSep ++ keccak(TYPEHASH ++ keccak(blob))).
 * `domain.name` must match the wire ("BTR ExternalOracleV4").
 */
export function pushDigest(blob: Hex | Uint8Array, domain: Eip712Domain): Hex {
  const blobHash = keccak256(toBytes(blob));
  const structHash = keccak256(concat([BATCH_TYPEHASH_V4, blobHash]));
  return keccak256(concat(['0x1901', domainSeparator(domain), structHash]));
}

/**
 * The digest a quorum signs to open a V4 push session (`openSession`). Verifying THIS - the
 * grant - is the honest client-side proof for session pushes, which carry no calldata sigs.
 */
export function sessionGrantDigest(
  domain: Eip712Domain,
  grant: { relay: string; expiresAt: number | bigint; maxSeq: number; nonce: number },
): Hex {
  const structHash = keccak256(
    concat([
      SESSION_TYPEHASH,
      pad(grant.relay as Hex),
      pad(numberToHex(BigInt(grant.expiresAt))),
      pad(numberToHex(BigInt(grant.maxSeq))),
      pad(numberToHex(BigInt(grant.nonce))),
    ]),
  );
  return keccak256(concat(['0x1901', domainSeparator(domain), structHash]));
}
