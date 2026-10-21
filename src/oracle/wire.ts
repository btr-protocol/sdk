/**
 * EIP-712 push digest for the ExternalOracleV4 push path (`BatchQuoteV4`), the one the P8 verifier
 * in `p8.ts` rebuilds per segment. Signature recovery + k-of-n quorum live in `eip712.ts`
 * (`recoverSigners` / `verifyQuorum`) - one recovery path, no parity drift.
 */

import { keccak256, keccak256Input } from '../eth/index';
import type { Hex } from '../eth/types';
import { concat, numberToHex, pad } from '../utils/encoding';
import { EIP712_DOMAIN_TYPEHASH, type Eip712Domain } from './eip712';

/** keccak256("BatchQuoteV4(bytes32 blobHash)") - the push typehash (ExternalOracleV4). */
const BATCH_TYPEHASH_V4 = keccak256Input('BatchQuoteV4(bytes32 blobHash)');

const toBytes = (b: Hex | Uint8Array): Uint8Array => {
  if (typeof b !== 'string') return b;
  if (!/^0x[0-9a-fA-F]*$/.test(b)) throw new Error('hex blob must be 0x-prefixed hex');
  const h = b.slice(2);
  if (h.length % 2 !== 0) throw new Error(`hex blob odd length ${h.length}: full octets only`);
  return Uint8Array.from((h.match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
};

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
 * `domain.name` must match the wire ("BTR ExternalOracleV4").
 */
export function pushDigest(blob: Hex | Uint8Array, domain: Eip712Domain): Hex {
  const blobHash = keccak256(toBytes(blob));
  const structHash = keccak256(concat([BATCH_TYPEHASH_V4, blobHash]));
  return keccak256(concat(['0x1901', domainSeparator(domain), structHash]));
}
