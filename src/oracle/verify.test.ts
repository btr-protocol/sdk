/**
 * Signed-quote verify helpers — round-trip + fixed-vector tests.
 *
 * The digest/record/signature contract is locked against ExternalOracle.sol
 * (dex/ORACLE_SIGNED_PUSH_SPEC.md). Fixed private keys give deterministic signer
 * addresses so recovery is asserted exactly, not just round-tripped.
 */

import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256 } from '../eth/index.js';
import type { Address, Hex } from '../eth/types.js';
import { decodeB64, encodeB64 } from '../utils/encoding.js';
import {
  type Eip712Domain,
  batchDigest,
  decodeBlob,
  recoverSigners,
  verifyBatch,
  verifyQuorum,
} from './verify.js';

const DOMAIN: Eip712Domain = {
  name: 'BTR ExternalOracle',
  version: '1',
  chainId: 97,
  verifyingContract: '0xD91712c9F4037D0010041691Df191AB45994F2bF',
};

// Deterministic signer keys → stable addresses.
const KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000a11',
  '0x0000000000000000000000000000000000000000000000000000000000000b22',
  '0x0000000000000000000000000000000000000000000000000000000000000c33',
] as const;

const addrOf = (priv: Hex): Address =>
  checksumAddress(
    `0x${keccak256(`0x${bytesToHex(secp256k1.getPublicKey(hexToBytes(priv.slice(2)), false).slice(1))}`).slice(-40)}`,
  );

/**
 * `prehash: false` is mandatory: the digest is already keccak256 and noble-curves v2 sha256-hashes
 * the message by default, which would sign the wrong preimage and recover the wrong address.
 */
function sign(digest: Hex, priv: Hex): Uint8Array {
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(hexToBytes(digest.slice(2)), hexToBytes(priv.slice(2)), {
      prehash: false,
      format: 'recovered',
    }),
    'recovered',
  );
  const out = new Uint8Array(65);
  out.set(sig.toBytes('compact'), 0);
  out[64] = 27 + (sig.recovery as number);
  return out;
}

/** Build a 22-byte record big-endian: tickerId u64 | price u64 | sigmaPbps u32 | conf u16. */
function rec(tickerId: bigint, priceB64: bigint, sigmaPbps: number, conf: number): Uint8Array {
  const b = new Uint8Array(22);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(0, tickerId);
  dv.setBigUint64(8, priceB64);
  dv.setUint32(16, sigmaPbps);
  dv.setUint16(20, conf);
  return b;
}

/** header(8) = version u8 | sourceTsMs u48 | reserved u8, then the records verbatim. */
function blobOf(sourceTsMs: bigint, ...records: Uint8Array[]): Uint8Array {
  const h = new Uint8Array(8);
  h[0] = 1;
  for (let i = 0; i < 6; i++) h[1 + i] = Number((sourceTsMs >> BigInt(8 * (5 - i))) & 0xffn);
  return new Uint8Array([...h, ...records.flatMap((r) => [...r])]);
}

/** A whole one-record blob: the common case in these tests. */
function record(
  tickerId: bigint,
  priceB64: bigint,
  sigmaPbps: number,
  conf: number,
  sourceTsMs: bigint,
): Uint8Array {
  return blobOf(sourceTsMs, rec(tickerId, priceB64, sigmaPbps, conf));
}

/** Concatenate signatures sorted by recovered signer address ascending (the on-chain requirement). */
function quorumSigs(digest: Hex, privs: readonly Hex[]): Uint8Array {
  const sorted = [...privs].sort((a, b) =>
    BigInt(addrOf(a).toLowerCase()) < BigInt(addrOf(b).toLowerCase()) ? -1 : 1,
  );
  const out = new Uint8Array(sorted.length * 65);
  sorted.forEach((p, i) => out.set(sign(digest, p), i * 65));
  return out;
}

describe('decodeBlob', () => {
  it('extracts fields and 1e18 mark for a single record', () => {
    const priceB64 = encodeB64(123456n * 10n ** 8n, 8); // $123456 @ 8 decimals
    const blob = record(3n, priceB64, 4200, 15, 1_700_000_000_000n);
    const decoded = decodeBlob(blob);
    expect(decoded.version).toBe(1);
    expect(decoded.sourceTsMs).toBe(1_700_000_000_000n);
    const [r] = decoded.records;
    expect(r.tickerId).toBe(3n);
    expect(r.priceB64).toBe(priceB64);
    expect(r.mark1e18).toBe(decodeB64(priceB64, 18));
    expect(r.sigmaPbps).toBe(4200);
    expect(r.confidence).toBe(15);
  });

  it('decodes multi-record blobs and rejects a ragged or short one', () => {
    const blob = blobOf(
      2n,
      rec(1n, encodeB64(10n ** 18n, 18), 1, 2),
      rec(2n, encodeB64(2n * 10n ** 18n, 18), 3, 4),
    );
    expect(decodeBlob(blob).records).toHaveLength(2);
    expect(() => decodeBlob(new Uint8Array([...blob, 0xff]))).toThrow();
    expect(() => decodeBlob(new Uint8Array(8))).toThrow();
    expect(() => decodeBlob(new Uint8Array(0))).toThrow();
  });

  /** 4 idx24 records, the layout the Arc signers emit (`record_format: idx24`). */
  function idx24(count: number): Uint8Array {
    const b = new Uint8Array(count * 24);
    const dv = new DataView(b.buffer);
    for (let i = 0; i < count; i++) {
      dv.setUint16(i * 24, i); // idx
      dv.setBigUint64(i * 24 + 2, encodeB64(10n ** 18n, 18));
      dv.setUint32(i * 24 + 10, 300);
      dv.setUint16(i * 24 + 14, 25);
      dv.setBigUint64(i * 24 + 16, 1_700_000_000_000n + BigInt(i));
    }
    return b;
  }

  it('decodes the headerless idx24 layout, keyed by feedIds ordinal', () => {
    const decoded = decodeBlob(idx24(4));
    expect(decoded.format).toBe('idx24');
    expect(decoded.version).toBe(0);
    expect(decoded.records).toHaveLength(4);
    // Repeated per record on this layout; the blob-level value is the NEWEST of them.
    expect(decoded.sourceTsMs).toBe(1_700_000_000_003n);
    const [r] = decoded.records;
    expect(r.feedIndex).toBe(0);
    expect(r.tickerId).toBeUndefined();
    expect(r.sigmaPbps).toBe(300);
    expect(r.confidence).toBe(25);
    expect(r.sourceTsMs).toBe(1_700_000_000_000n);
    expect(r.mark1e18).toBe(decodeB64(encodeB64(10n ** 18n, 18), 18));
  });

  /**
   * THE anti-misparse gate. 4 records at the 24-byte stride is 96 B, which is also a valid
   * header + 4 22-byte records: length cannot tell the formats apart, so only the header can.
   * Auto-detection reads a real idx24 blob correctly (its first byte is the high byte of an
   * ordinal < 256, so it can never forge the version byte), and a caller that DECLARES ticker22
   * still refuses it rather than mispricing it.
   */
  it('does not confuse the two colliding strides', () => {
    const old24 = idx24(4);
    expect((old24.length - 8) % 22).toBe(0); // the collision this test exists for
    expect(decodeBlob(old24).format).toBe('idx24');
    expect(() => decodeBlob(old24, 'ticker22')).toThrow(/blob version/);
    // …and the reverse: a real ticker22 blob is never read as idx24.
    const blob = blobOf(2n, rec(1n, encodeB64(10n ** 18n, 18), 1, 2), rec(2n, 5n, 3, 4));
    expect(decodeBlob(blob).format).toBe('ticker22');
  });

  it('rejects a non-zero reserved byte', () => {
    const blob = record(1n, encodeB64(10n ** 18n, 18), 1, 2, 1n);
    blob[7] = 1;
    expect(() => decodeBlob(blob, 'ticker22')).toThrow(/reserved/);
    // Auto-detection still fails closed - it fits neither layout - it just says so differently.
    expect(() => decodeBlob(blob)).toThrow(/fits neither/);
  });
});

describe('batchDigest', () => {
  it('is deterministic and domain-sensitive', () => {
    const blob = record(1n, encodeB64(10n ** 18n, 18), 1, 2, 1n);
    const d1 = batchDigest(blob, DOMAIN);
    expect(d1).toBe(batchDigest(blob, DOMAIN));
    expect(d1).not.toBe(batchDigest(blob, { ...DOMAIN, chainId: 56 }));
    expect(d1).toHaveLength(66); // 0x + 32 bytes
  });
});

describe('recoverSigners + verifyQuorum', () => {
  const signers = KEYS.map(addrOf);
  const blob = record(1n, encodeB64(10n ** 18n, 18), 100, 5, 42n);
  const digest = batchDigest(blob, DOMAIN);

  it('recovers the exact signer addresses', () => {
    const sig = sign(digest, KEYS[0]);
    expect(recoverSigners(digest, sig)).toEqual([addrOf(KEYS[0])]);
  });

  it('accepts a valid 2-of-3 quorum', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    const q = verifyQuorum(recoverSigners(digest, sigs), signers, 2);
    expect(q.ok).toBe(true);
    expect(q.k).toBe(2);
    expect(q.n).toBe(3);
    expect(q.unknown).toEqual([]);
    expect(q.strictlyAscending).toBe(true);
  });

  it('rejects when threshold is not met', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    expect(verifyQuorum(recoverSigners(digest, sigs), signers, 3).ok).toBe(false);
  });

  it('rejects an ungranted signer', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    const q = verifyQuorum(recoverSigners(digest, sigs), [addrOf(KEYS[0])], 2);
    expect(q.ok).toBe(false);
    expect(q.unknown).toEqual([addrOf(KEYS[1])]);
  });

  it('rejects unsorted / duplicate signatures', () => {
    // Two sigs deliberately NOT ascending (same signer twice → not strictly increasing).
    const dup = new Uint8Array(130);
    dup.set(sign(digest, KEYS[0]), 0);
    dup.set(sign(digest, KEYS[0]), 65);
    const q = verifyQuorum(recoverSigners(digest, dup), signers, 2);
    expect(q.strictlyAscending).toBe(false);
    expect(q.ok).toBe(false);
  });

  it('fails closed when the blob is tampered after signing', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    const tampered = record(1n, encodeB64(2n * 10n ** 18n, 18), 100, 5, 42n); // different mark
    const q = verifyBatch({
      blob: tampered,
      sigs,
      domain: DOMAIN,
      onchainSigners: signers,
      threshold: 2,
    });
    // sigs were over the original digest; against the tampered digest they recover foreign addresses.
    expect(q.quorum.ok).toBe(false);
  });

  it('verifyBatch returns the decoded blob + digest', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    const res = verifyBatch({ blob, sigs, domain: DOMAIN, onchainSigners: signers, threshold: 2 });
    expect(res.digest).toBe(digest);
    expect(res.blob.records).toHaveLength(1);
    expect(res.quorum.ok).toBe(true);
  });
});
