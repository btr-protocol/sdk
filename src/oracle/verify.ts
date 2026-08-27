/**
 * Signed-quote verification for `ExternalOracle.batchPushSigned`.
 *
 * Lets any client/auditor verify an NXR-signed oracle push END-TO-END, zero server trust:
 * decode the packed calldata blob, rebuild the EIP-712 digest byte-for-byte, recover the
 * ECDSA signers, and check k-of-n quorum against the on-chain granted-signer set.
 *
 * Byte-contract is LOCKED — see dex/ORACLE_SIGNED_PUSH_SPEC.md. Digest, record layout, and the
 * concatenated-65-byte signature stride MUST agree with ExternalOracle.sol or verification fails
 * closed. Prices reuse the SDK B64 decoder (never reimplemented — one decoder, no parity drift).
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256, keccak256Input } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { concat, decodeB64, numberToHex, pad } from '../utils/encoding';

const HEADER_BYTES = 8;
const RECORD_BYTES = 22;
const IDX24_RECORD_BYTES = 24;
const SIG_STRIDE = 65;
/**
 * Wire version, checked FIRST. 24 B and 22 B strides produce colliding blob lengths (4 old
 * records = 96 B = header + 4 new records), so length can never discriminate the formats and a
 * stride mismatch must be REFUSED rather than misparsed.
 */
const BLOB_VERSION = 1;

/**
 * Record layout of a signed blob. NXR is the writer and its `RecordFormat`
 * (`nx-rates/sdk/rust/src/pipeline_config.rs`) is the authority for both spellings; a signer
 * emits whichever its domain declares (`signed_quotes.record_format`).
 *
 * `ticker22` is NXR's native layout. `idx24` is the LEGACY one it still emits for a consumer
 * that decodes ordinals - and it is what the Arc fleet is signing today
 * (`ops-flux/k0s/nxr/signer-configs/arc-{primary,reference}.config.yml` both say `idx24`), so
 * a verifier that knows only `ticker22` rejects every live push as "wrong wire format".
 */
export type RecordFormat = 'ticker22' | 'idx24';

/** keccak256("BatchQuote(bytes32 blobHash)") — the batch struct typehash. */
export const BATCH_TYPEHASH = keccak256Input('BatchQuote(bytes32 blobHash)');
/** solady EIP712 domain typehash (no salt — ExternalOracle overrides only name+version). */
export const EIP712_DOMAIN_TYPEHASH = keccak256Input(
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
);

/** One decoded quote record. Mark is exposed both as raw B64 and 1e18-scaled. */
export interface QuoteRecord {
  /**
   * `ticker22` ONLY. MITCH instrument id: content-derived from both assets plus the instrument
   * type, so it is identical on every chain and deployment. Resolves on-chain via
   * `feedIdOf(tickerId)`.
   */
  tickerId?: bigint;
  /**
   * `idx24` ONLY. Ordinal into the CONSUMER's own `getFeedIds()` array - a per-deployment fact,
   * which is exactly why the native layout replaced it. Resolve it as `feedIds[feedIndex]` and
   * never against a sibling chain's list.
   */
  feedIndex?: number;
  /** raw B64-packed mark (uint64). */
  priceB64: bigint;
  /** mark scaled to 1e18 (== on-chain `b64To1e18(price)`). 0 is invalid on-chain. */
  mark1e18: bigint;
  /** NXR-signed volatility, PBPS (stored directly as `sigmaPbps`). */
  sigmaPbps: number;
  /** mark confidence interval, bps. */
  confidence: number;
  /**
   * NXR-attested source time, ms. `idx24` carries one per record; `ticker22` carries one per blob
   * and it is copied onto every record here, so a reader never needs to know which layout it got.
   */
  sourceTsMs: bigint;
}

/** A decoded blob: its layout, its source time and its records. */
export interface QuoteBlob {
  /** Layout the bytes were parsed as. */
  format: RecordFormat;
  /** wire version - {@link BLOB_VERSION} for `ticker22`, 0 for headerless `idx24`. */
  version: number;
  /**
   * NXR-attested source timestamp, ms since epoch. Blob-level for `ticker22` (u48 header field);
   * for `idx24` it is the NEWEST record's, since that layout repeats it per record.
   */
  sourceTsMs: bigint;
  records: QuoteRecord[];
}

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number | bigint;
  verifyingContract: Address;
}

export interface QuorumResult {
  /** true iff k >= threshold, every recovered signer is granted on-chain, and all strictly ascending. */
  ok: boolean;
  /** distinct signers recovered from the blob. */
  k: number;
  /** granted-signer count supplied for the check (n). */
  n: number;
  /** recovered signer addresses, in signature order. */
  recovered: Address[];
  /** recovered addresses NOT in the on-chain granted set (empty when ok). */
  unknown: Address[];
  /** false if the recovered addresses are not strictly ascending (dup/unsorted → on-chain revert). */
  strictlyAscending: boolean;
}

const toBytes = (b: Hex | Uint8Array): Uint8Array =>
  typeof b === 'string' ? hexToBytes(b.slice(2)) : b;

/** Read a big-endian unsigned integer from `bytes[off, off+len)`. */
function readUint(bytes: Uint8Array, off: number, len: number): bigint {
  let v = 0n;
  for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}

/** True when the bytes carry a well-formed `ticker22` header AND a whole number of its records. */
function isTicker22(bytes: Uint8Array): boolean {
  return (
    bytes.length >= HEADER_BYTES + RECORD_BYTES &&
    bytes[0] === BLOB_VERSION &&
    bytes[7] === 0 &&
    (bytes.length - HEADER_BYTES) % RECORD_BYTES === 0
  );
}

/**
 * Which layout these bytes are in.
 *
 * The strides collide on length by construction, so the `ticker22` HEADER is the only
 * discriminator there is: version byte == 1 and reserved byte == 0. An `idx24` blob opens with
 * `idx:u16`, whose high byte is 0 for every ordinal below 256, so it cannot forge that header
 * while a deployment has fewer than 256 feeds.
 *
 * ponytail ceiling: a 256th feed would put a 1 in that byte and make a 24 B blob indistinguishable
 * from a 22 B one. Upgrade path: pass `format` explicitly (the caller knows its own domain) rather
 * than widening this guess. Detection fails CLOSED - an unparseable blob throws, never misparses.
 */
function detectFormat(bytes: Uint8Array): RecordFormat {
  if (isTicker22(bytes)) return 'ticker22';
  if (bytes.length >= IDX24_RECORD_BYTES && bytes.length % IDX24_RECORD_BYTES === 0) return 'idx24';
  throw new Error(
    `blob length ${bytes.length} fits neither a ticker22 header plus ${RECORD_BYTES}-byte records ` +
      `nor a whole number of ${IDX24_RECORD_BYTES}-byte idx24 records`,
  );
}

/**
 * Decode a packed batch blob, byte-exact with `batchPushSigned`. Two layouts, per NXR's writer:
 *   ticker22: header(8) = version u8 | sourceTsMs u48 | reserved u8   (reserved MUST be 0)
 *             record(22) = tickerId u64 | price u64 | sigmaPbps u32 | conf u16
 *   idx24:    no header; record(24) = idx u16 | price u64 | sigmaPbps u32 | conf u16 | sourceTs u64
 * Big-endian throughout. `format` is auto-detected when omitted; pass it to refuse the other one.
 * Fails closed on a wrong version, a non-zero reserved byte, or a ragged body.
 */
export function decodeBlob(blob: Hex | Uint8Array, format?: RecordFormat): QuoteBlob {
  const bytes = toBytes(blob);
  const fmt = format ?? detectFormat(bytes);

  if (fmt === 'idx24') {
    if (bytes.length < IDX24_RECORD_BYTES) {
      throw new Error(`blob length ${bytes.length} is shorter than one idx24 record`);
    }
    if (bytes.length % IDX24_RECORD_BYTES !== 0) {
      throw new Error(
        `blob length ${bytes.length} not a whole number of ${IDX24_RECORD_BYTES}-byte records`,
      );
    }
    const records: QuoteRecord[] = [];
    let newest = 0n;
    for (let o = 0; o < bytes.length; o += IDX24_RECORD_BYTES) {
      const priceB64 = readUint(bytes, o + 2, 8);
      const sourceTsMs = readUint(bytes, o + 16, 8);
      if (sourceTsMs > newest) newest = sourceTsMs;
      records.push({
        feedIndex: Number(readUint(bytes, o, 2)),
        priceB64,
        // reuse the SDK B64 decoder (== on-chain b64To1e18) — do NOT reimplement.
        mark1e18: priceB64 === 0n ? 0n : decodeB64(priceB64, 18),
        sigmaPbps: Number(readUint(bytes, o + 10, 4)),
        confidence: Number(readUint(bytes, o + 14, 2)),
        sourceTsMs,
      });
    }
    return { format: fmt, version: 0, sourceTsMs: newest, records };
  }

  if (bytes.length < HEADER_BYTES + RECORD_BYTES) {
    throw new Error(`blob length ${bytes.length} is shorter than a header plus one record`);
  }
  // Version FIRST, before any record is read: the length collision above makes it the only
  // thing that can tell a stride change from a valid blob.
  if (bytes[0] !== BLOB_VERSION) {
    throw new Error(`blob version ${bytes[0]} != ${BLOB_VERSION} (wrong wire format)`);
  }
  if (bytes[7] !== 0) throw new Error(`blob header reserved byte is ${bytes[7]}, not 0`);
  const body = bytes.length - HEADER_BYTES;
  if (body % RECORD_BYTES !== 0) {
    throw new Error(`blob body ${body} not a whole number of ${RECORD_BYTES}-byte records`);
  }
  const sourceTsMs = readUint(bytes, 1, 6);
  const records: QuoteRecord[] = [];
  for (let o = HEADER_BYTES; o < bytes.length; o += RECORD_BYTES) {
    const priceB64 = readUint(bytes, o + 8, 8);
    records.push({
      tickerId: readUint(bytes, o, 8),
      priceB64,
      // reuse the SDK B64 decoder (== on-chain b64To1e18) — do NOT reimplement.
      mark1e18: priceB64 === 0n ? 0n : decodeB64(priceB64, 18),
      sigmaPbps: Number(readUint(bytes, o + 16, 4)),
      confidence: Number(readUint(bytes, o + 20, 2)),
      sourceTsMs,
    });
  }
  return { format: fmt, version: bytes[0], sourceTsMs, records };
}

/**
 * Rebuild the EIP-712 digest the contract signs over:
 *   digest = keccak256(0x1901 ++ domainSeparator ++ structHash),
 *   structHash = keccak256(BATCH_TYPEHASH ++ keccak256(blob)),
 *   domainSeparator = keccak256(DOMAIN_TYPEHASH ++ keccak256(name) ++ keccak256(version)
 *                     ++ chainId ++ verifyingContract).
 * (abi.encode of static words == plain concatenation.)
 */
export function batchDigest(blob: Hex | Uint8Array, domain: Eip712Domain): Hex {
  const blobHash = keccak256(toBytes(blob));
  const structHash = keccak256(concat([BATCH_TYPEHASH, blobHash]));
  const domainSeparator = keccak256(
    concat([
      EIP712_DOMAIN_TYPEHASH,
      keccak256Input(domain.name),
      keccak256Input(domain.version),
      pad(numberToHex(BigInt(domain.chainId))),
      pad(domain.verifyingContract),
    ]),
  );
  return keccak256(concat(['0x1901', domainSeparator, structHash]));
}

/** Recover the signer of a raw 32-byte digest from a single 65-byte (r||s||v) signature. */
export function recoverDigestSigner(digest: Hex, sig: Hex | Uint8Array): Address {
  const s = toBytes(sig);
  if (s.length !== SIG_STRIDE)
    throw new Error(`signature must be ${SIG_STRIDE} bytes, got ${s.length}`);
  const v = s[64];
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) throw new Error(`invalid recovery byte v=${v}`);
  const pub = secp256k1.Signature.fromBytes(s.slice(0, 64), 'compact')
    .addRecoveryBit(recovery)
    .recoverPublicKey(hexToBytes(digest.slice(2))) // digest is already keccak256, never re-hashed
    .toBytes(false); // uncompressed, 65 bytes (0x04 ++ X ++ Y)
  return checksumAddress(`0x${keccak256(`0x${bytesToHex(pub.slice(1))}`).slice(-40)}`);
}

/**
 * Recover every signer from concatenated 65-byte signatures over `digest`.
 * `sigs` MUST be a multiple of 65 (fixed stride, no EIP-2098) — the count is the quorum claim.
 */
export function recoverSigners(digest: Hex, sigs: Hex | Uint8Array): Address[] {
  const bytes = toBytes(sigs);
  if (bytes.length === 0 || bytes.length % SIG_STRIDE !== 0) {
    throw new Error(`sigs length ${bytes.length} not a positive multiple of ${SIG_STRIDE}`);
  }
  const out: Address[] = [];
  for (let o = 0; o < bytes.length; o += SIG_STRIDE) {
    out.push(recoverDigestSigner(digest, bytes.slice(o, o + SIG_STRIDE)));
  }
  return out;
}

/**
 * Check k-of-n quorum exactly as `batchPushSigned` does: every recovered signer must be a granted
 * signer, recovered addresses must be strictly ascending (the on-chain distinctness/sort check),
 * and their count must reach `threshold`.
 */
export function verifyQuorum(
  recovered: Address[],
  onchainSigners: Address[],
  threshold: number,
): QuorumResult {
  const granted = new Set(onchainSigners.map((a) => a.toLowerCase()));
  const unknown = recovered.filter((a) => !granted.has(a.toLowerCase()));
  let strictlyAscending = true;
  for (let i = 1; i < recovered.length; i++) {
    if (BigInt(recovered[i - 1].toLowerCase()) >= BigInt(recovered[i].toLowerCase())) {
      strictlyAscending = false;
      break;
    }
  }
  const k = recovered.length;
  return {
    ok: k >= threshold && unknown.length === 0 && strictlyAscending,
    k,
    n: onchainSigners.length,
    recovered,
    unknown,
    strictlyAscending,
  };
}

export interface VerifyBatchArgs {
  blob: Hex | Uint8Array;
  sigs: Hex | Uint8Array;
  domain: Eip712Domain;
  onchainSigners: Address[];
  threshold: number;
  /** Record layout. Auto-detected when omitted; see {@link decodeBlob}. */
  format?: RecordFormat;
}

export interface VerifiedBatch {
  blob: QuoteBlob;
  digest: Hex;
  quorum: QuorumResult;
}

/** One-shot: decode + rebuild digest + recover + quorum-check a signed push. */
export function verifyBatch({
  blob,
  sigs,
  domain,
  onchainSigners,
  threshold,
  format,
}: VerifyBatchArgs): VerifiedBatch {
  const digest = batchDigest(blob, domain);
  return {
    blob: decodeBlob(blob, format),
    digest,
    quorum: verifyQuorum(recoverSigners(digest, sigs), onchainSigners, threshold),
  };
}
