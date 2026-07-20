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

import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256, keccak256Input } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { concat, decodeB64, numberToHex, pad } from '../utils/encoding';

const RECORD_BYTES = 24;
const SIG_STRIDE = 65;

/** keccak256("BatchQuote(bytes32 blobHash)") — the batch struct typehash. */
export const BATCH_TYPEHASH = keccak256Input('BatchQuote(bytes32 blobHash)');
/** solady EIP712 domain typehash (no salt — ExternalOracle overrides only name+version). */
export const EIP712_DOMAIN_TYPEHASH = keccak256Input(
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
);

/** One decoded 24-byte quote record. Mark is exposed both as raw B64 and 1e18-scaled. */
export interface QuoteRecord {
  /** append-only index into `feedIds[]` (resolves to a bytes32 feedId on-chain). */
  idx: number;
  /** raw B64-packed mark (uint64). */
  priceB64: bigint;
  /** mark scaled to 1e18 (== on-chain `b64To1e18(price)`). 0 is invalid on-chain. */
  mark1e18: bigint;
  /** NXR-signed volatility, PBPS (stored directly as `sigma`). */
  sigma: number;
  /** mark confidence interval, bps. */
  confidence: number;
  /** NXR-attested source timestamp, ms since epoch (strictly monotonic per feed). */
  sourceTs: bigint;
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

/**
 * Decode a packed batch blob into quote records. Mirrors the 24-byte big-endian record
 * (idx u16 | price u64 | sigma u32 | conf u16 | sourceTs u64) read by `batchPushSigned`.
 */
export function decodeBlob(blob: Hex | Uint8Array): QuoteRecord[] {
  const bytes = toBytes(blob);
  if (bytes.length === 0 || bytes.length % RECORD_BYTES !== 0) {
    throw new Error(`blob length ${bytes.length} not a positive multiple of ${RECORD_BYTES}`);
  }
  const out: QuoteRecord[] = [];
  for (let o = 0; o < bytes.length; o += RECORD_BYTES) {
    const priceB64 = readUint(bytes, o + 2, 8);
    out.push({
      idx: Number(readUint(bytes, o, 2)),
      priceB64,
      // reuse the SDK B64 decoder (== on-chain b64To1e18) — do NOT reimplement.
      mark1e18: priceB64 === 0n ? 0n : decodeB64(priceB64, 18),
      sigma: Number(readUint(bytes, o + 10, 4)),
      confidence: Number(readUint(bytes, o + 14, 2)),
      sourceTs: readUint(bytes, o + 16, 8),
    });
  }
  return out;
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
  const pub = secp256k1.Signature.fromCompact(s.slice(0, 64))
    .addRecoveryBit(recovery)
    .recoverPublicKey(hexToBytes(digest.slice(2)))
    .toRawBytes(false); // uncompressed, 65 bytes (0x04 ++ X ++ Y)
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
}

export interface VerifiedBatch {
  records: QuoteRecord[];
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
}: VerifyBatchArgs): VerifiedBatch {
  const digest = batchDigest(blob, domain);
  return {
    records: decodeBlob(blob),
    digest,
    quorum: verifyQuorum(recoverSigners(digest, sigs), onchainSigners, threshold),
  };
}
