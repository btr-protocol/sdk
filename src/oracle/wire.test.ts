/**
 * Push digest + quorum recovery over the V5 golden blob. The blob codec itself is pinned in
 * test/oracle-v5-wire.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256 } from '../eth/index';
import type { Address, Hex } from '../eth/types';
import { type Eip712Domain, recoverSigners, verifyQuorum } from './eip712';
import { pushDigest } from './wire';

// hdr(ver 5, seq 1, tsDs 288100, 2p/1s/1c), gi0 lane 0x170f0cf0, gi1 lane 0x159bff2f,
// sigma gi0 = 100000, conf gi1 = 9.
const BLOB = hexToBytes('050000000104656402010100170f0cf001159bff2f00000186a0010009');

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
