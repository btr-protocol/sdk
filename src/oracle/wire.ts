/**
 * Wire codecs + EIP-712 verification for the packed-slot push oracles.
 *
 * V2 (`ExternalOracleV2.batchPushSignedV2`): 8 x 28-bit price lanes per slot, 100-byte records.
 * V3 (`ExternalOracleV3.pushV3` / `pushSignedV3`): 10 x 22-bit lanes, wire v4 DIFF blobs
 * (price/sigma/conf sections, per-entry globalIndex).
 * V5 (`ExternalOracleV4.pushV4` / `pushSignedV4`): 8 x 29-bit lanes, wire v5 DIFF blobs, 11-byte
 * header, 5-byte price entries, `tsDs` = deciseconds since midnight UTC (cyclic, no epoch).
 *
 * Byte-contract is LOCKED against the Solidity golden vectors
 * (dex test/unit/ExternalOracleV{2,3}.t.sol): V2 keccak(blob) =
 * 0x9aa00cc5…671b, V3 = 0x452332cb…3f88; V5 against the shared four-codec fixture
 * dex-evm/test/fixtures/oracle-v5-wire-golden.json (keccak = 0x66151804…9b35).
 * Signature recovery + k-of-n quorum reuse
 * `verify.ts` (`recoverSigners` / `verifyQuorum`) - one recovery path, no parity drift.
 * A V3 SESSION push (`pushV3`) carries NO calldata signatures: the quorum signed the
 * session grant, and per-push authenticity is msg.sender + the emitted blobHash. A
 * client must NOT pretend to verify those; it can only verify signed pushes and the
 * grant itself.
 */

import { keccak256, keccak256Input } from '../eth/index';
import type { Hex } from '../eth/types';
import { concat, numberToHex, pad } from '../utils/encoding';
import { EIP712_DOMAIN_TYPEHASH, type Eip712Domain } from './verify';

/** Wire generation. Note the version byte is NOT the name: v3 blobs carry ver=4, v5 carry ver=5. */
export type PushWire = 'v2' | 'v3' | 'v5';

/** keccak256("BatchQuoteV2(bytes32 blobHash)") */
export const BATCH_TYPEHASH_V2 = keccak256Input('BatchQuoteV2(bytes32 blobHash)');
/** keccak256("BatchQuoteV3(bytes32 blobHash)") */
export const BATCH_TYPEHASH_V3 = keccak256Input('BatchQuoteV3(bytes32 blobHash)');
/** keccak256("BatchQuoteV4(bytes32 blobHash)") - the wire-v5 push typehash (ExternalOracleV4). */
export const BATCH_TYPEHASH_V4 = keccak256Input('BatchQuoteV4(bytes32 blobHash)');
/** keccak256("SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)") */
export const SESSION_TYPEHASH = keccak256Input(
  'SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)',
);

export const V2_BLOB_VERSION = 2;
export const V2_HEADER_BYTES = 9; // version u8 | seq u32 | sourceTsDs u32
export const V2_RECORD_BYTES = 100; // slotId u32 | priceWord 32 | sigmaWord 32 | confWord 32
export const V3_BLOB_VERSION = 4;
export const V3_HEADER_BYTES = 12; // version u8 | seq u32 | sourceTsDs u32 | nP u8 | nS u8 | nC u8
export const V5_BLOB_VERSION = 5;
export const V5_HEADER_BYTES = 11; // ver u8 | seq u32 | tsDs u24 | nP u8 | nS u8 | nC u8
export const V5_PRICE_ENTRY_BYTES = 5; // gi u8 | lane u32 (top 3 bits zero)
export const V5_SIGMA_ENTRY_BYTES = 5; // gi u8 | sigmaPbps u32
export const V5_CONF_ENTRY_BYTES = 3; // gi u8 | confBps u16
/** ExternalOracleV4.LANES_PER_SLOT - 8, down from V3's 10 (wider lanes). */
export const V5_LANES_PER_SLOT = 8;
/** 29 significant lane bits; the top 3 of the u32 entry are reserved and MUST be zero. */
export const V5_LANE_MASK = (1 << 29) - 1;
/** Deciseconds in a day: the modulus of the v5 `tsDs` field (u20 value, zero-padded to u24). */
export const V5_DAY_DS = 864_000;

const V2_LANE_BITS = 28;
const V3_LANE_BITS = 22;

/** Per-wire lane geometry. lane = exp:u(expBits) | mant:u(mantBits), mant MSB set when live. */
const LANE_SPEC: Record<PushWire, { mantBits: number; expBits: number }> = {
  v2: { mantBits: 23, expBits: 5 },
  v3: { mantBits: 18, expBits: 4 },
  v5: { mantBits: 25, expBits: 4 },
};

const toBytes = (b: Hex | Uint8Array): Uint8Array =>
  typeof b === 'string'
    ? Uint8Array.from((b.slice(2).match(/../g) ?? []).map((x) => Number.parseInt(x, 16)))
    : b;

function readUint(bytes: Uint8Array, off: number, len: number): bigint {
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

function writeUint(bytes: Uint8Array, off: number, len: number, value: bigint): void {
  let v = value;
  for (let i = len - 1; i >= 0; i--, v >>= 8n) bytes[off + i] = Number(v & 0xffn);
}

const checkGi = (gi: number, last: number, section: string): void => {
  if (!Number.isInteger(gi) || gi < 0 || gi > 255) throw new Error(`V5 ${section} gi ${gi} not u8`);
  if (gi <= last)
    throw new Error(`V5 ${section} entries not ascending by gi (${gi} after ${last})`);
};

/**
 * Decode one packed price lane to mark1e18. `laneBits` picks the layout:
 * V2 lane = exp:u5 | mant:u23 (MSB of mant set for a live price); V3 = exp:u4 | mant:u18;
 * V5 = exp:u4 (bits 25..28) | mant:u25 (bits 0..24).
 * The all-zero lane (and any lane with the mantissa MSB unset) is the STALE sentinel -> 0n,
 * exactly the fail-closed value `getFeed` serves.
 */
export function decodeLane(lane: bigint | number, expBias: number, wire: PushWire): bigint {
  const l = BigInt(lane);
  const { mantBits } = LANE_SPEC[wire];
  const mant = l & ((1n << BigInt(mantBits)) - 1n);
  if ((mant & (1n << BigInt(mantBits - 1))) === 0n) return 0n; // STALE sentinel
  const exp = Number(l >> BigInt(mantBits)) + expBias;
  return exp >= 0 ? mant << BigInt(exp) : mant >> BigInt(-exp);
}

/**
 * Normalize a 1e18 value into a lane (test/golden mirror of the Solidity `_lane` helpers).
 * Floor-encode: mantissa lands in [2^(mantBits-1), 2^mantBits). Throws when no exponent fits.
 */
export function encodeLane(value1e18: bigint, expBias: number, wire: PushWire): number {
  const { mantBits, expBits } = LANE_SPEC[wire];
  const expMax = 1 << expBits;
  const lo = 1n << BigInt(mantBits - 1);
  const hi = 1n << BigInt(mantBits);
  for (let e = 0; e < expMax; e++) {
    const shift = e + expBias;
    const m = shift >= 0 ? value1e18 >> BigInt(shift) : value1e18 << BigInt(-shift);
    if (m >= lo && m < hi) return (e << mantBits) | Number(m);
  }
  throw new Error(`no exponent fits value ${value1e18} at bias ${expBias} (${wire})`);
}

/** One lane of a decoded V2 slot record. Sentinel lanes are kept (lane = 0) so index = laneIdx. */
export interface V2Lane {
  /** globalIndex = slotId * 8 + laneIdx. */
  gi: number;
  /** raw 28-bit lane; 0 / MSB-unset = STALE sentinel. Decode with {@link decodeLane}. */
  lane: number;
  sigmaPbps: number;
  confBps: number;
}

export interface V2Record {
  slotId: number;
  lanes: V2Lane[]; // always 8, index = laneIdx
}

export interface V2Blob {
  version: number;
  seq: number;
  /** deciseconds since the oracle's immutable EPOCH; seconds = EPOCH + sourceTsDs/10. */
  sourceTsDs: number;
  records: V2Record[];
}

/** Decode a V2 push blob (header 9B + n x 100B slot records). Fails closed on version/stride. */
export function decodeBlobV2(blob: Hex | Uint8Array): V2Blob {
  const b = toBytes(blob);
  if (b.length < V2_HEADER_BYTES + V2_RECORD_BYTES) {
    throw new Error(`V2 blob length ${b.length} shorter than header + one record`);
  }
  if (b[0] !== V2_BLOB_VERSION) throw new Error(`V2 blob version ${b[0]} != ${V2_BLOB_VERSION}`);
  if ((b.length - V2_HEADER_BYTES) % V2_RECORD_BYTES !== 0) {
    throw new Error(`V2 blob body not a whole number of ${V2_RECORD_BYTES}-byte records`);
  }
  const records: V2Record[] = [];
  for (let o = V2_HEADER_BYTES; o < b.length; o += V2_RECORD_BYTES) {
    const slotId = Number(readUint(b, o, 4));
    const priceWord = readUint(b, o + 4, 32);
    const sigmaWord = readUint(b, o + 36, 32);
    const confWord = readUint(b, o + 68, 32);
    const lanes: V2Lane[] = [];
    for (let lane = 0; lane < 8; lane++) {
      lanes.push({
        gi: slotId * 8 + lane,
        lane: Number((priceWord >> BigInt(lane * V2_LANE_BITS)) & ((1n << 28n) - 1n)),
        sigmaPbps: Number((sigmaWord >> BigInt(lane * 32)) & 0xffffffffn),
        confBps: Number((confWord >> BigInt(lane * 16)) & 0xffffn),
      });
    }
    records.push({ slotId, lanes });
  }
  return {
    version: b[0],
    seq: Number(readUint(b, 1, 4)),
    sourceTsDs: Number(readUint(b, 5, 4)),
    records,
  };
}

export interface V3Blob {
  version: number;
  seq: number;
  sourceTsDs: number;
  prices: Array<{ gi: number; lane: number }>;
  sigmas: Array<{ gi: number; sigmaPbps: number }>;
  confs: Array<{ gi: number; confBps: number }>;
}

/**
 * Decode a wire-v4 DIFF blob (V3): header 12B, then nP x 4B price entries (gi u8 | lane u24),
 * nS x 5B sigma entries (gi u8 | sigmaPbps u32), nC x 3B conf entries (gi u8 | confBps u16).
 * Length must match the section counts exactly (the contract reverts BadBlobHeader otherwise).
 */
export function decodeBlobV3(blob: Hex | Uint8Array): V3Blob {
  const b = toBytes(blob);
  if (b.length < V3_HEADER_BYTES) throw new Error(`V3 blob length ${b.length} shorter than header`);
  if (b[0] !== V3_BLOB_VERSION) throw new Error(`V3 blob version ${b[0]} != ${V3_BLOB_VERSION}`);
  const nP = b[9];
  const nS = b[10];
  const nC = b[11];
  if (b.length !== V3_HEADER_BYTES + nP * 4 + nS * 5 + nC * 3) {
    throw new Error(`V3 blob length ${b.length} != sections (${nP}p ${nS}s ${nC}c)`);
  }
  const prices: V3Blob['prices'] = [];
  const sigmas: V3Blob['sigmas'] = [];
  const confs: V3Blob['confs'] = [];
  let o = V3_HEADER_BYTES;
  for (let i = 0; i < nP; i++, o += 4) {
    prices.push({ gi: b[o], lane: Number(readUint(b, o + 1, 3)) });
  }
  for (let i = 0; i < nS; i++, o += 5) {
    sigmas.push({ gi: b[o], sigmaPbps: Number(readUint(b, o + 1, 4)) });
  }
  for (let i = 0; i < nC; i++, o += 3) {
    confs.push({ gi: b[o], confBps: Number(readUint(b, o + 1, 2)) });
  }
  return {
    version: b[0],
    seq: Number(readUint(b, 1, 4)),
    sourceTsDs: Number(readUint(b, 5, 4)),
    prices,
    sigmas,
    confs,
  };
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
 * Fails closed exactly where `_checkHeader` / the price walk revert `BadBlobHeader`: wrong version,
 * `tsDs >= 864000`, an all-empty blob, a length that disagrees with the section counts, a lane with
 * any of its reserved top 3 bits set, and a non-ascending `gi` inside a section.
 *
 * `dayMod` is NOT read here: it is a storage-only tag the contract derives from the reconstructed
 * source day, never a wire field.
 */
export function decodeBlobV5(blob: Hex | Uint8Array): V5Blob {
  const b = toBytes(blob);
  if (b.length < V5_HEADER_BYTES) throw new Error(`V5 blob length ${b.length} shorter than header`);
  if (b[0] !== V5_BLOB_VERSION) throw new Error(`V5 blob version ${b[0]} != ${V5_BLOB_VERSION}`);
  const tsDs = Number(readUint(b, 5, 3));
  if (tsDs >= V5_DAY_DS) throw new Error(`V5 tsDs ${tsDs} outside [0, ${V5_DAY_DS})`);
  const nP = b[8];
  const nS = b[9];
  const nC = b[10];
  if (nP === 0 && nS === 0 && nC === 0) throw new Error('V5 blob carries no entries');
  const want =
    V5_HEADER_BYTES +
    nP * V5_PRICE_ENTRY_BYTES +
    nS * V5_SIGMA_ENTRY_BYTES +
    nC * V5_CONF_ENTRY_BYTES;
  if (b.length !== want) {
    throw new Error(`V5 blob length ${b.length} != sections (${nP}p ${nS}s ${nC}c => ${want})`);
  }
  const prices: V5Blob['prices'] = [];
  const sigmas: V5Blob['sigmas'] = [];
  const confs: V5Blob['confs'] = [];
  let o = V5_HEADER_BYTES;
  let last = -1;
  for (let i = 0; i < nP; i++, o += V5_PRICE_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(gi, last, 'price');
    last = gi;
    const lane = Number(readUint(b, o + 1, 4));
    if (lane > V5_LANE_MASK) throw new Error(`V5 lane ${lane} sets a reserved top bit (gi ${gi})`);
    prices.push({ gi, lane });
  }
  last = -1;
  for (let i = 0; i < nS; i++, o += V5_SIGMA_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(gi, last, 'sigma');
    last = gi;
    sigmas.push({ gi, sigmaPbps: Number(readUint(b, o + 1, 4)) });
  }
  last = -1;
  for (let i = 0; i < nC; i++, o += V5_CONF_ENTRY_BYTES) {
    const gi = b[o];
    checkGi(gi, last, 'conf');
    last = gi;
    confs.push({ gi, confBps: Number(readUint(b, o + 1, 2)) });
  }
  return { version: b[0], seq: Number(readUint(b, 1, 4)), tsDs, prices, sigmas, confs };
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
    checkGi(p.gi, last, 'price');
    last = p.gi;
    if (p.lane < 0 || p.lane > V5_LANE_MASK) {
      throw new Error(`V5 lane ${p.lane} outside 29 bits (gi ${p.gi})`);
    }
    out[o] = p.gi;
    writeUint(out, o + 1, 4, BigInt(p.lane));
    o += V5_PRICE_ENTRY_BYTES;
  }
  last = -1;
  for (const s of sigmas) {
    checkGi(s.gi, last, 'sigma');
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
    checkGi(c.gi, last, 'conf');
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
 * `domain.name` must match the wire ("BTR ExternalOracleV2" / "BTR ExternalOracleV3" /
 * "BTR ExternalOracleV4" for v5).
 */
export function pushDigest(blob: Hex | Uint8Array, domain: Eip712Domain, wire: PushWire): Hex {
  const blobHash = keccak256(toBytes(blob));
  const typehash =
    wire === 'v2' ? BATCH_TYPEHASH_V2 : wire === 'v3' ? BATCH_TYPEHASH_V3 : BATCH_TYPEHASH_V4;
  const structHash = keccak256(concat([typehash, blobHash]));
  return keccak256(concat(['0x1901', domainSeparator(domain), structHash]));
}

/**
 * The digest a quorum signs to open a V3 push session (`openSession`). Verifying THIS - the
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

/** Slot deciseconds -> unix ms, given the oracle's immutable EPOCH (seconds). */
export const tsFromDs = (epochSecs: number, sourceTsDs: number): number =>
  epochSecs * 1000 + sourceTsDs * 100;
