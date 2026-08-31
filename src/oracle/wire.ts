/**
 * Wire codecs + EIP-712 verification for the packed-slot push oracles.
 *
 * V2 (`ExternalOracleV2.batchPushSignedV2`): 8 x 28-bit price lanes per slot, 100-byte records.
 * V3 (`ExternalOracleV3.pushV3` / `pushSignedV3`): 10 x 22-bit lanes, wire v4 DIFF blobs
 * (price/sigma/conf sections, per-entry globalIndex).
 *
 * Byte-contract is LOCKED against the Solidity golden vectors
 * (dex test/unit/ExternalOracleV{2,3}.t.sol): V2 keccak(blob) =
 * 0x9aa00cc5…671b, V3 = 0x452332cb…3f88. Signature recovery + k-of-n quorum reuse
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

export type PushWire = 'v2' | 'v3';

/** keccak256("BatchQuoteV2(bytes32 blobHash)") */
export const BATCH_TYPEHASH_V2 = keccak256Input('BatchQuoteV2(bytes32 blobHash)');
/** keccak256("BatchQuoteV3(bytes32 blobHash)") */
export const BATCH_TYPEHASH_V3 = keccak256Input('BatchQuoteV3(bytes32 blobHash)');
/** keccak256("SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)") */
export const SESSION_TYPEHASH = keccak256Input(
  'SessionGrant(address relay,uint48 expiresAt,uint32 maxSeq,uint16 nonce)',
);

export const V2_BLOB_VERSION = 2;
export const V2_HEADER_BYTES = 9; // version u8 | seq u32 | sourceTsDs u32
export const V2_RECORD_BYTES = 100; // slotId u32 | priceWord 32 | sigmaWord 32 | confWord 32
export const V3_BLOB_VERSION = 4;
export const V3_HEADER_BYTES = 12; // version u8 | seq u32 | sourceTsDs u32 | nP u8 | nS u8 | nC u8

const V2_LANE_BITS = 28;
const V2_MANT_BITS = 23;
const V3_LANE_BITS = 22;
const V3_MANT_BITS = 18;

const toBytes = (b: Hex | Uint8Array): Uint8Array =>
  typeof b === 'string'
    ? Uint8Array.from((b.slice(2).match(/../g) ?? []).map((x) => Number.parseInt(x, 16)))
    : b;

function readUint(bytes: Uint8Array, off: number, len: number): bigint {
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

/**
 * Decode one packed price lane to mark1e18. `laneBits` picks the layout:
 * V2 lane = exp:u5 | mant:u23 (MSB of mant set for a live price); V3 = exp:u4 | mant:u18.
 * The all-zero lane (and any lane with the mantissa MSB unset) is the STALE sentinel -> 0n,
 * exactly the fail-closed value `getFeed` serves.
 */
export function decodeLane(lane: bigint | number, expBias: number, wire: PushWire): bigint {
  const l = BigInt(lane);
  const mantBits = wire === 'v2' ? V2_MANT_BITS : V3_MANT_BITS;
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
  const mantBits = wire === 'v2' ? V2_MANT_BITS : V3_MANT_BITS;
  const expMax = wire === 'v2' ? 32 : 16;
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
 * `domain.name` must match the wire ("BTR ExternalOracleV2" / "BTR ExternalOracleV3").
 */
export function pushDigest(blob: Hex | Uint8Array, domain: Eip712Domain, wire: PushWire): Hex {
  const blobHash = keccak256(toBytes(blob));
  const typehash = wire === 'v2' ? BATCH_TYPEHASH_V2 : BATCH_TYPEHASH_V3;
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
