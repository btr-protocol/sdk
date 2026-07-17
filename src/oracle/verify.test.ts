/**
 * Signed-quote verify helpers — round-trip + fixed-vector tests.
 *
 * The digest/record/signature contract is locked against ExternalOracle.sol
 * (dex/ORACLE_SIGNED_PUSH_SPEC.md). Fixed private keys give deterministic signer
 * addresses so recovery is asserted exactly, not just round-tripped.
 */

import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
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

function sign(digest: Hex, priv: Hex): Uint8Array {
  const sig = secp256k1.sign(hexToBytes(digest.slice(2)), hexToBytes(priv.slice(2)));
  const out = new Uint8Array(65);
  out.set(sig.toCompactRawBytes(), 0);
  out[64] = 27 + (sig as unknown as { recovery: number }).recovery;
  return out;
}

/** Build a 24-byte record big-endian: idx u16 | price u64 | sigma u32 | conf u16 | sourceTs u64. */
function record(
  idx: number,
  priceB64: bigint,
  sigma: number,
  conf: number,
  sourceTs: bigint,
): Uint8Array {
  const b = new Uint8Array(24);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, idx);
  dv.setBigUint64(2, priceB64);
  dv.setUint32(10, sigma);
  dv.setUint16(14, conf);
  dv.setBigUint64(16, sourceTs);
  return b;
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
    const blob = record(3, priceB64, 4200, 15, 1_700_000_000_000n);
    const [r] = decodeBlob(blob);
    expect(r.idx).toBe(3);
    expect(r.priceB64).toBe(priceB64);
    expect(r.mark1e18).toBe(decodeB64(priceB64, 18));
    expect(r.sigma).toBe(4200);
    expect(r.confidence).toBe(15);
    expect(r.sourceTs).toBe(1_700_000_000_000n);
  });

  it('decodes multi-record blobs and rejects misaligned length', () => {
    const blob = new Uint8Array([
      ...record(0, encodeB64(10n ** 18n, 18), 1, 2, 1n),
      ...record(1, encodeB64(2n * 10n ** 18n, 18), 3, 4, 2n),
    ]);
    expect(decodeBlob(blob)).toHaveLength(2);
    expect(() => decodeBlob(new Uint8Array(23))).toThrow();
    expect(() => decodeBlob(new Uint8Array(0))).toThrow();
  });
});

describe('batchDigest', () => {
  it('is deterministic and domain-sensitive', () => {
    const blob = record(0, encodeB64(10n ** 18n, 18), 1, 2, 1n);
    const d1 = batchDigest(blob, DOMAIN);
    expect(d1).toBe(batchDigest(blob, DOMAIN));
    expect(d1).not.toBe(batchDigest(blob, { ...DOMAIN, chainId: 56 }));
    expect(d1).toHaveLength(66); // 0x + 32 bytes
  });
});

describe('recoverSigners + verifyQuorum', () => {
  const signers = KEYS.map(addrOf);
  const blob = record(0, encodeB64(10n ** 18n, 18), 100, 5, 42n);
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
    const tampered = record(0, encodeB64(2n * 10n ** 18n, 18), 100, 5, 42n); // different mark
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

  it('verifyBatch returns decoded records + digest', () => {
    const sigs = quorumSigs(digest, [KEYS[0], KEYS[1]]);
    const res = verifyBatch({ blob, sigs, domain: DOMAIN, onchainSigners: signers, threshold: 2 });
    expect(res.digest).toBe(digest);
    expect(res.records).toHaveLength(1);
    expect(res.quorum.ok).toBe(true);
  });
});
