/**
 * Unified Client for Ethereum interactions
 * Supports both injected wallets (browser) and private key wallets (backend)
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { keccak256 } from './index';
import { rlpEncode } from './rlp';
import {
  estimateGas,
  ethCall,
  getChainId,
  getGasPrice,
  getNonce,
  sendTransaction as rpcSendTransaction,
} from './rpc';
import { type TransportOpts, httpTransport } from './transport';
import type { Address, Eip1193Provider, Hex, TransactionRequest } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Client {
  provider: Eip1193Provider;
  account?: Address;
  call: (to: Address, data: Hex) => Promise<Hex>;
  sendTransaction: (tx: Omit<TransactionRequest, 'from'>) => Promise<Hex>;
  estimateGas: (tx: Omit<TransactionRequest, 'from'>) => Promise<bigint>;
}

// ─────────────────────────────────────────────────────────────
// Injected Wallet Client (Browser)
// ─────────────────────────────────────────────────────────────

/**
 * Create a client from an injected wallet provider
 * Requires user approval for transactions
 */
export function createWalletClient(provider: Eip1193Provider, account: Address): Client {
  return {
    provider,
    account,
    call: async (to: Address, data: Hex) => {
      return ethCall(provider, to, data);
    },
    sendTransaction: async (tx: Omit<TransactionRequest, 'from'>) => {
      return rpcSendTransaction(provider, { ...tx, from: account } as TransactionRequest);
    },
    estimateGas: async (tx: Omit<TransactionRequest, 'from'>) => {
      return estimateGas(provider, { ...tx, from: account } as TransactionRequest);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Private Key Client (Backend)
// ─────────────────────────────────────────────────────────────

/**
 * Create an HTTP provider (backend or public read fallback).
 * Resilient transport: timeout, retry+backoff, multi-RPC failover, typed errors,
 * and tick-batched request coalescing (many eth_calls -> one round-trip).
 * Pass an array of URLs to enable failover.
 */
export function createHttpProvider(
  rpcUrl: string | readonly string[],
  opts?: TransportOpts,
): Eip1193Provider {
  return httpTransport(rpcUrl, opts);
}

/**
 * Derive address from private key
 */
export function privateKeyToAddress(privateKey: Hex): Address {
  const privKeyBytes = hexToBytes(privateKey.slice(2));
  const publicKey = secp256k1.getPublicKey(privKeyBytes, false); // Uncompressed

  // Take keccak256 of uncompressed public key (without 0x04 prefix)
  const pubKeyHash = keccak256(`0x${bytesToHex(publicKey.slice(1))}`);

  // Take last 20 bytes as address
  return `0x${pubKeyHash.slice(-40)}` as Address;
}

/**
 * Sign an already-keccak256'd 32-byte digest, returning the parsed r/s/recovery.
 *
 * `prehash: false` is load-bearing: noble-curves v2 sha256-hashes the message by default, so
 * omitting it produces a well-formed signature that recovers to the WRONG address.
 */
export function signDigest(digest: Hex, privateKey: Hex) {
  return secp256k1.Signature.fromBytes(
    secp256k1.sign(hexToBytes(digest.slice(2)), hexToBytes(privateKey.slice(2)), {
      prehash: false,
      format: 'recovered',
    }),
    'recovered',
  );
}

/** EIP-1559/2930 `accessList` when there is none. An RLP LIST, so it encodes 0xc0. */
const EMPTY_ACCESS_LIST: readonly never[] = [];

/** Serialised nonce allocation per (provider, sender).
 *
 *  `eth_getTransactionCount` is in the transport's DEDUPE set, so two `signTransaction` calls in
 *  the same tick share ONE reply and sign the SAME nonce: the second transaction replaces the
 *  first instead of following it. Even undeduped, two reads before either send returns the same
 *  count. So the allocation is serialised here and monotone per sender: each caller waits for the
 *  previous one, and the issued nonce is `max(chainCount, lastIssued + 1)`.
 *
 *  A nonce whose transaction never reached a mempool (estimate or raw-tx send failed) is RELEASED,
 *  and the lowest released nonce at or above the chain count is issued before the tip advances.
 *  The tip is monotone, so without that the hole was permanent and every later transaction from
 *  the sender queued behind it (A-925, a regression of the A-637 lock). */
type NonceLane = { tip: Promise<bigint | undefined>; free: Set<bigint> };
const NONCE_LANES = new WeakMap<object, Map<string, NonceLane>>();

function laneOf(provider: Eip1193Provider, from: Address): NonceLane {
  let byAccount = NONCE_LANES.get(provider);
  if (!byAccount) {
    byAccount = new Map();
    NONCE_LANES.set(provider, byAccount);
  }
  const key = from.toLowerCase();
  let lane = byAccount.get(key);
  if (!lane) {
    lane = { tip: Promise.resolve(undefined), free: new Set() };
    byAccount.set(key, lane);
  }
  return lane;
}

function nextNonce(provider: Eip1193Provider, from: Address): Promise<bigint> {
  const lane = laneOf(provider, from);
  const prev = lane.tip;
  const issued = (async () => {
    const last = await prev;
    const onChain = BigInt(await getNonce(provider, from));
    let reuse: bigint | undefined;
    for (const n of lane.free) {
      if (n < onChain) lane.free.delete(n);
      else if (reuse === undefined || n < reuse) reuse = n;
    }
    if (reuse !== undefined) {
      lane.free.delete(reuse);
      return { nonce: reuse, tip: last };
    }
    const nonce = last !== undefined && last + 1n > onChain ? last + 1n : onChain;
    return { nonce, tip: nonce };
  })();
  lane.tip = issued.then(
    (r) => r.tip,
    () => prev,
  );
  return issued.then((r) => r.nonce);
}

/** Return a nonce to its lane after the transaction signed for it never reached a mempool. The tip
 *  does not move; the next allocation reissues the lowest free nonce at or above the chain count,
 *  so a failed estimate or send heals the lane instead of stranding every later send (A-925). */
export function releaseNonce(provider: Eip1193Provider, from: Address, nonce: bigint): void {
  laneOf(provider, from).free.add(nonce);
}

/**
 * Sign a transaction with a private key, returning the raw signed transaction.
 *
 * Exported so the encoder is testable without a network: `test/tx-vectors.test.ts` signs the
 * EIP-155 spec vector and asserts the bytes. Nothing pinned this before, which is how the
 * EIP-1559 `accessList` shipped as `0x80` instead of `0xc0`.
 */
export async function signTransaction(
  provider: Eip1193Provider,
  tx: TransactionRequest,
  privateKey: Hex,
  /** Refuse to build the preimage unless the endpoint reports THIS chain. The signed tx embeds the
   *  chain id the endpoint claimed, so a mismatched endpoint yields a valid transaction for a
   *  chain the caller never meant. Checked HERE, at the preimage, so an endpoint that rotates
   *  underneath a client cannot slip past a cached outer check. */
  expectedChainId?: number,
): Promise<Hex> {
  const chainId = await getChainId(provider);
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`chain mismatch: endpoint reports ${chainId}, expected ${expectedChainId}`);
  }
  if (tx.chainId !== undefined && BigInt(tx.chainId) !== BigInt(chainId)) {
    throw new Error(
      `chain mismatch: tx requests ${BigInt(tx.chainId)}, endpoint reports ${chainId}`,
    );
  }
  const nonce = tx.nonce ?? (await nextNonce(provider, tx.from as Address));
  const gasLimit = tx.gas ?? (await estimateGas(provider, tx));

  // Quantity fields arrive as JSON-RPC hex strings (often odd-nibble like 0x0 / 0x5).
  // Normalize to bigint at the tx boundary so RLP scalar encoding is canonical.
  const q = (v: Hex | bigint | number | undefined, fallback: bigint) =>
    v === undefined ? fallback : BigInt(v);
  const q0 = (v: Hex | bigint | number | undefined) => q(v, 0n);

  // EIP-1559 (Type 2)
  if (tx.maxFeePerGas && tx.maxPriorityFeePerGas) {
    const txData = [
      chainId,
      q(nonce, 0n),
      q(tx.maxPriorityFeePerGas, 0n),
      q(tx.maxFeePerGas, 0n),
      q(gasLimit, 0n),
      tx.to || '0x',
      q0(tx.value),
      tx.data || '0x',
      // accessList: an EMPTY LIST (0xc0), never the empty string (0x80). EIP-1559 signs over a
      // list here, so `'0x'` produced a different preimage and every signed tx was rejected.
      EMPTY_ACCESS_LIST,
    ];

    // Hash the transaction
    const txHash = keccak256(new Uint8Array([0x02, ...rlpEncode(txData)]));

    // Sign
    const signature = signDigest(txHash, privateKey);
    const r = signature.r;
    const s = signature.s;
    // Type-2 txs carry yParity (0/1) instead of legacy EIP-155 v.
    const yParity = BigInt(signature.recovery as number);

    // Encode signed transaction
    const signedTx = [
      chainId,
      q(nonce, 0n),
      q(tx.maxPriorityFeePerGas, 0n),
      q(tx.maxFeePerGas, 0n),
      q(gasLimit, 0n),
      tx.to || '0x',
      q0(tx.value),
      tx.data || '0x',
      EMPTY_ACCESS_LIST,
      yParity,
      r,
      s,
    ];

    return `0x02${bytesToHex(rlpEncode(signedTx))}` as Hex;
  }

  // Legacy (Type 0)
  const gasPrice = tx.gasPrice ?? (await getGasPrice(provider));

  const txData = [
    q(nonce, 0n),
    q(gasPrice, 0n),
    q(gasLimit, 0n),
    tx.to || '0x',
    q0(tx.value),
    tx.data || '0x',
    chainId,
    0n,
    0n,
  ];

  // Hash the transaction
  const txHash = keccak256(rlpEncode(txData));

  // Sign
  const signature = signDigest(txHash, privateKey);
  const r = signature.r;
  const s = signature.s;
  const v = BigInt(signature.recovery as number) + BigInt(chainId) * 2n + 35n;

  // Encode signed transaction
  const signedTx = [
    q(nonce, 0n),
    q(gasPrice, 0n),
    q(gasLimit, 0n),
    tx.to || '0x',
    q0(tx.value),
    tx.data || '0x',
    v,
    r,
    s,
  ];

  return `0x${bytesToHex(rlpEncode(signedTx))}` as Hex;
}

/**
 * Create a client from a private key (for backend use)
 * Can sign transactions without user approval
 */
export function createPrivateKeyClient(
  rpcUrl: string,
  privateKey: Hex,
  /** Refuse to sign anything unless the endpoint reports THIS chain. The signing preimage carries
   *  the chain id the endpoint claims, so an endpoint on the wrong (or a forked) chain silently
   *  produces a valid transaction for a chain the caller never meant to touch. Enforced inside
   *  `signTransaction` at the preimage; omit only for a caller that genuinely does not know. */
  expectedChainId?: number,
): Client {
  // The same chain pins the transport: reads refuse a wrong-chain endpoint too, not only signing.
  const provider = createHttpProvider(rpcUrl, { chainId: expectedChainId });
  const account = privateKeyToAddress(privateKey);

  return {
    provider,
    account,
    call: async (to: Address, data: Hex) => {
      return ethCall(provider, to, data);
    },
    sendTransaction: async (tx: Omit<TransactionRequest, 'from'>) => {
      // Allocate here, not inside signTransaction, so a failure at ANY step between allocation and
      // broadcast (estimateGas, signing, the raw-tx send) returns the nonce to the lane. Left at
      // the tip, one such failure stranded every later send behind a hole that never healed (A-925).
      const explicit = tx.nonce !== undefined;
      const nonce = tx.nonce !== undefined ? BigInt(tx.nonce) : await nextNonce(provider, account);
      try {
        const signedTx = await signTransaction(
          provider,
          { ...tx, from: account, nonce: `0x${nonce.toString(16)}` as Hex } as TransactionRequest,
          privateKey,
          expectedChainId,
        );
        return (await provider.request({
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        })) as Hex;
      } catch (e) {
        if (!explicit) releaseNonce(provider, account, nonce);
        throw e;
      }
    },
    estimateGas: async (tx: Omit<TransactionRequest, 'from'>) => {
      return estimateGas(provider, { ...tx, from: account } as TransactionRequest);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Public Client (Read-only)
// ─────────────────────────────────────────────────────────────

/**
 * Create a read-only client (no account required)
 */
export function createPublicClient(provider: Eip1193Provider | string): Client {
  const actualProvider = typeof provider === 'string' ? createHttpProvider(provider) : provider;

  return {
    provider: actualProvider,
    call: async (to: Address, data: Hex) => {
      return ethCall(actualProvider, to, data);
    },
    sendTransaction: async () => {
      throw new Error('Cannot send transactions with read-only client');
    },
    estimateGas: async (tx: Omit<TransactionRequest, 'from'>) => {
      return estimateGas(actualProvider, tx as TransactionRequest);
    },
  };
}
