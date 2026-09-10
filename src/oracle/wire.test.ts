/**
 * Golden-vector parity with the Solidity wire pin:
 *   dex-evm/test/fixtures/oracle-v5-wire-golden.json
 * A drift in the hash means the TS codec no longer reads what the chain accepted.
 */

import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256 } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { type Eip712Domain, recoverSigners, verifyQuorum } from './eip712';
import { decodeBlobV5, decodeLane, encodeBlobV5, encodeLane, pushDigest } from './wire';

const E18 = 10n ** 18n;

// hdr(ver 5, seq 1, tsDs 288100, 2p/1s/1c), gi0 lane 0x170f0cf0, gi1 lane 0x159bff2f,
// sigma gi0 = 100000, conf gi1 = 9.
const BLOB = hexToBytes('050000000104656402010100170f0cf001159bff2f00000186a0010009');

describe('V5 wire (29-bit lanes, 11B header, DIFF sections)', () => {
  it('reproduces the frozen golden hash', () => {
    expect(keccak256(BLOB)).toBe(
      '0x6615180489aad02e35006978fa1ff39fbdd81129e84fa95037374454c5399b35',
    );
  });

  it('decodes header + sections', () => {
    const d = decodeBlobV5(BLOB);
    expect(d.version).toBe(5);
    expect(d.seq).toBe(1);
    expect(d.tsDs).toBe(288100);
    expect(d.prices).toEqual([
      { gi: 0, lane: 0x170f0cf0 },
      { gi: 1, lane: 0x159bff2f },
    ]);
    expect(d.sigmas).toEqual([{ gi: 0, sigmaPbps: 100_000 }]);
    expect(d.confs).toEqual([{ gi: 1, confBps: 9 }]);
  });

  it('decodes + encodes the golden lanes within the 25-bit grid', () => {
    expect(Number(decodeLane(0x170f0cf0, 36, 'v5')) / 1e18).toBeCloseTo(2500, 0);
    expect(Number(decodeLane(0x159bff2f, 36, 'v5')) / 1e18).toBeCloseTo(1900, 0);
    expect(encodeLane(2500n * E18, 36, 'v5')).toBe(0x170f0cf0);
    expect(encodeLane(1900n * E18, 36, 'v5')).toBe(0x159bff2f);
  });

  it('encodeBlobV5 is the byte-exact inverse', () => {
    const d = decodeBlobV5(BLOB);
    const re = encodeBlobV5({
      seq: d.seq,
      tsDs: d.tsDs,
      prices: d.prices,
      sigmas: d.sigmas,
      confs: d.confs,
    });
    expect(bytesToHex(re)).toBe(bytesToHex(BLOB));
  });

  it('fails closed on version, tsDs, reserved bits, sentinel and section mismatch', () => {
    const badVer = Uint8Array.from(BLOB);
    badVer[0] = 4;
    expect(() => decodeBlobV5(badVer)).toThrow(/version/);

    const badTs = Uint8Array.from(BLOB);
    badTs.set([0x0d, 0x2f, 0x00], 5); // 864000, outside [0, 864000)
    expect(() => decodeBlobV5(badTs)).toThrow(/tsDs/);

    const reserved = Uint8Array.from(BLOB);
    reserved.set([0xe0, 0x00, 0x00, 0x00], 12); // lane gi0 sets a reserved top bit
    expect(() => decodeBlobV5(reserved)).toThrow(/reserved/);

    const sentinel = Uint8Array.from(BLOB);
    sentinel.set([0x00, 0x00, 0x00, 0x01], 12); // nonzero, mantissa MSB clear
    expect(() => decodeBlobV5(sentinel)).toThrow(/sentinel/);

    const mismatch = Uint8Array.from(BLOB);
    mismatch[8] = 3; // claim 3 price entries, bytes say 2
    expect(() => decodeBlobV5(mismatch)).toThrow(/sections/);
  });
});

describe('push digest + signature recovery (V4 domain)', () => {
  const KEYS = [
    '0x0000000000000000000000000000000000000000000000000000000000000a11',
    '0x0000000000000000000000000000000000000000000000000000000000000b22',
  ] as const;
  const addrOf = (priv: Hex): Address =>
    checksumAddress(
      `0x${keccak256(`0x${bytesToHex(secp256k1.getPublicKey(hexToBytes(priv.slice(2)), false).slice(1))}`).slice(-40)}`,
    );
  // prehash: false - the digest is already keccak256 (see eip712.ts).
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
  const cat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  const domain: Eip712Domain = {
    name: 'BTR ExternalOracleV4',
    version: '1',
    chainId: 5042002,
    verifyingContract: '0x842c2736F072A8A7b523D23bd3Ef21F21AC24d5C',
  };

  it('recovers a valid quorum and binds the domain name', () => {
    const digest = pushDigest(BLOB, domain);
    const signers = KEYS.map(addrOf);
    const sorted = [...KEYS].sort((a, b) => (BigInt(addrOf(a)) < BigInt(addrOf(b)) ? -1 : 1));
    const sigs = cat(...sorted.map((k) => sign(digest, k)));
    const q = verifyQuorum(recoverSigners(digest, sigs), signers, 2);
    expect(q.ok).toBe(true);
    expect(q.k).toBe(2);
    // A different domain name is a different digest: a V2/V3 quorum can never be replayed here.
    const other = pushDigest(BLOB, { ...domain, name: 'BTR ExternalOracleV3' });
    expect(other).not.toBe(digest);
    expect(verifyQuorum(recoverSigners(other, sigs), signers, 2).ok).toBe(false);
  });
});
