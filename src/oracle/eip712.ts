/**
 * EIP-712 domain + secp256k1 recovery and k-of-n quorum checks for oracle pushes.
 *
 * The domain-hash shape is solady's (`name, version, chainId, verifyingContract`) and the
 * signature stride is a fixed 65 bytes (r || s || v), matching the on-chain
 * `ExternalOracleV4` verifier. The push digest itself is built per wire in `wire.ts`.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { checksumAddress, keccak256, keccak256Input } from '../eth/index';
import type { Address, Hex } from '../eth/types';

/** solady EIP712 domain typehash (no salt: ExternalOracleV4 overrides only name+version). */
export const EIP712_DOMAIN_TYPEHASH = keccak256Input(
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
);

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

const SIG_STRIDE = 65;

const toBytes = (b: Hex | Uint8Array): Uint8Array =>
  typeof b === 'string' ? hexToBytes(b.slice(2)) : b;

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
 * `sigs` MUST be a multiple of 65 (fixed stride, no EIP-2098): the count is the quorum claim.
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
 * Check k-of-n quorum exactly as the push verifier does: every recovered signer must be a granted
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

/**
 * `MarkStore.tierVerifier(t)`: tier `t`'s EIP-712 `verifyingContract`. Tier 1 (primary) is the
 * `PoolFactory`; tier 2 (reference) is `address(keccak256(factory ++ uint8(2)))`, a key-less
 * address, so a signature never crosses tiers even when the rosters overlap.
 */
export function tierVerifier(factory: Address, tier: 1 | 2): Address {
  if (tier === 1) return checksumAddress(factory);
  const h = keccak256(`0x${factory.slice(2).toLowerCase()}${tier.toString(16).padStart(2, '0')}`);
  return checksumAddress(`0x${h.slice(-40)}` as Address);
}

/**
 * The unsigned tail `MarkStore.push` checks against the tier's committed roster:
 * `nSigners u8 | signers | k u8 | nRelayers u8 | relayers` (addresses 20 B, signers ascending).
 * `keccak256` of it is the tier's auth word.
 */
export function encodeRoster(signers: Address[], k: number, relayers: Address[]): Hex {
  const a = (x: Address) => x.slice(2).toLowerCase();
  const b = (n: number) => n.toString(16).padStart(2, '0');
  return `0x${b(signers.length)}${signers.map(a).join('')}${b(k)}${b(relayers.length)}${relayers
    .map(a)
    .join('')}` as Hex;
}
