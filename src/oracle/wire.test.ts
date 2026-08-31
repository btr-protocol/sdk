/**
 * Golden-vector parity with the Solidity wire pins:
 *   V2: dex test/unit/ExternalOracleV2.t.sol test_wireFormatPin
 *   V3: dex test/unit/ExternalOracleV3.t.sol test_goldenVector_wireV3
 * A drift in either hash means the TS codec no longer reads what the chain accepted.
 */

import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256 } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { type Eip712Domain, recoverSigners, verifyQuorum } from './verify';
import { decodeBlobV2, decodeBlobV3, decodeLane, encodeLane, pushDigest, tsFromDs } from './wire';

const E18 = 10n ** 18n;

// ── byte builders (mirror the .t.sol helpers) ────────────────────────────────

function beBytes(v: bigint | number, len: number): Uint8Array {
  let x = BigInt(v);
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** V2 test blob: header(9) + one slot record(100), exactly `_blob` in the .t.sol. */
function v2Blob(
  seq: number,
  sourceTsDs: number,
  slotId: number,
  pw: bigint,
  sw: bigint,
  cw: bigint,
): Uint8Array {
  return cat(
    beBytes(2, 1),
    beBytes(seq, 4),
    beBytes(sourceTsDs, 4),
    beBytes(slotId, 4),
    beBytes(pw, 32),
    beBytes(sw, 32),
    beBytes(cw, 32),
  );
}

describe('V2 wire (28-bit lanes, 100B records)', () => {
  const l0 = BigInt(encodeLane(2500n * E18, 43, 'v2'));
  const l1 = BigInt(encodeLane(95000n * E18, 48, 'v2'));
  const pw = l0 | (l1 << 28n);
  const sw = 10_000n | (20_000n << 32n);
  const cw = 5n | (7n << 16n);
  const blob = v2Blob(7, 12340, 0, pw, sw, cw);

  it('reproduces the frozen Solidity golden hash', () => {
    expect(keccak256(blob)).toBe(
      '0x9aa00cc5418c7bc642d25ceef126abd520d5ccad8f9cdf88816a1adabf96671b',
    );
  });

  it('decodes header, lanes, sigma and conf', () => {
    const d = decodeBlobV2(blob);
    expect(d.version).toBe(2);
    expect(d.seq).toBe(7);
    expect(d.sourceTsDs).toBe(12340);
    expect(d.records).toHaveLength(1);
    const r = d.records[0];
    expect(r.slotId).toBe(0);
    expect(r.lanes[0].gi).toBe(0);
    expect(r.lanes[0].sigmaPbps).toBe(10_000);
    expect(r.lanes[1].sigmaPbps).toBe(20_000);
    expect(r.lanes[0].confBps).toBe(5);
    expect(r.lanes[1].confBps).toBe(7);
    // lane decode error is bounded by the 23-bit mantissa grid (< 0.25 bps here)
    const m0 = decodeLane(r.lanes[0].lane, 43, 'v2');
    const m1 = decodeLane(r.lanes[1].lane, 48, 'v2');
    expect(Number(m0) / 1e18).toBeCloseTo(2500, 0);
    expect(Number(m1) / 1e18).toBeCloseTo(95000, -1);
    // sentinel lane (all zero) decodes to 0n, never a price
    expect(decodeLane(r.lanes[2].lane, 43, 'v2')).toBe(0n);
  });

  it('fails closed on version and stride', () => {
    const bad = Uint8Array.from(blob);
    bad[0] = 1;
    expect(() => decodeBlobV2(bad)).toThrow(/version/);
    expect(() => decodeBlobV2(blob.slice(0, blob.length - 1))).toThrow(/record/);
  });
});

describe('V3 wire (v4 diff blobs, 22-bit lanes)', () => {
  // Frozen bytes from test_goldenVector_wireV3: hdr(ver 4, seq 1, tsDs 100, 2p/1s/1c),
  // gi0 lane 0x2e1e19 (2500e18 @ bias43), gi1 lane 0x2b37fe (1900e18 @ bias43),
  // sigma gi0 = 100000, conf gi1 = 9.
  const blob = hexToBytes(
    '04' +
      '00000001' +
      '00000064' +
      '02' +
      '01' +
      '01' +
      '00' +
      '2e1e19' +
      '01' +
      '2b37fe' +
      '00' +
      '000186a0' +
      '01' +
      '0009',
  );

  it('reproduces the frozen Solidity golden hash', () => {
    expect(keccak256(blob)).toBe(
      '0x452332cbcfb019acdfa1e7218ec13cfeb454a71cb139e1fe8602781f84e33f88',
    );
  });

  it('encodes the golden lanes byte-for-byte', () => {
    expect(encodeLane(2500n * E18, 43, 'v3')).toBe(0x2e1e19);
    expect(encodeLane(1900n * E18, 43, 'v3')).toBe(0x2b37fe);
  });

  it('decodes sections + lane roundtrip within the 18-bit grid', () => {
    const d = decodeBlobV3(blob);
    expect(d.version).toBe(4);
    expect(d.seq).toBe(1);
    expect(d.sourceTsDs).toBe(100);
    expect(d.prices).toEqual([
      { gi: 0, lane: 0x2e1e19 },
      { gi: 1, lane: 0x2b37fe },
    ]);
    expect(d.sigmas).toEqual([{ gi: 0, sigmaPbps: 100_000 }]);
    expect(d.confs).toEqual([{ gi: 1, confBps: 9 }]);
    expect(Number(decodeLane(0x2e1e19, 43, 'v3')) / 1e18).toBeCloseTo(2500, 1);
    expect(Number(decodeLane(0x2b37fe, 43, 'v3')) / 1e18).toBeCloseTo(1900, 1);
  });

  it('fails closed on a section/length mismatch', () => {
    const bad = Uint8Array.from(blob);
    bad[9] = 3; // claim 3 price entries, length says 2
    expect(() => decodeBlobV3(bad)).toThrow(/sections/);
  });

  it('tsFromDs maps slot deciseconds onto the EPOCH clock', () => {
    expect(tsFromDs(1_800_000_000, 100)).toBe(1_800_000_000_000 + 10_000);
  });
});

describe('push digest + signature recovery (V2/V3 EIP-712 domains)', () => {
  const KEYS = [
    '0x0000000000000000000000000000000000000000000000000000000000000a11',
    '0x0000000000000000000000000000000000000000000000000000000000000b22',
  ] as const;
  const addrOf = (priv: Hex): Address =>
    checksumAddress(
      `0x${keccak256(`0x${bytesToHex(secp256k1.getPublicKey(hexToBytes(priv.slice(2)), false).slice(1))}`).slice(-40)}`,
    );
  // prehash: false - the digest is already keccak256 (see verify.test.ts).
  const sign = (digest: Hex, priv: Hex): Uint8Array => {
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
  };

  const blob = hexToBytes('040000000100000064010000002e1e19');
  const domainV3: Eip712Domain = {
    name: 'BTR ExternalOracleV3',
    version: '1',
    chainId: 5042002,
    verifyingContract: '0x0bef57B54631004Efc83636678cd95884C772ad4',
  };

  it('recovered quorum passes against the signing set, and the wires never cross', () => {
    const digest = pushDigest(blob, domainV3, 'v3');
    const signers = KEYS.map(addrOf);
    const sorted = [...KEYS].sort((a, b) => (BigInt(addrOf(a)) < BigInt(addrOf(b)) ? -1 : 1));
    const sigs = cat(...sorted.map((k) => sign(digest, k)));
    const q = verifyQuorum(recoverSigners(digest, sigs), signers, 2);
    expect(q.ok).toBe(true);
    expect(q.k).toBe(2);
    // Same blob under the V2 typehash/domain is a DIFFERENT digest: a V2 quorum can never
    // be replayed as a V3 one.
    const v2digest = pushDigest(blob, { ...domainV3, name: 'BTR ExternalOracleV2' }, 'v2');
    expect(v2digest).not.toBe(digest);
    expect(verifyQuorum(recoverSigners(v2digest, sigs), signers, 2).ok).toBe(false);
  });
});
