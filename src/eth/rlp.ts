/**
 * Lean RLP (Recursive Length Prefix) Encoding
 * Ethereum's serialization format for transactions
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ─────────────────────────────────────────────────────────────
// RLP Encoding
// ─────────────────────────────────────────────────────────────

/**
 * Encode a single item (string, number, bigint, or Uint8Array)
 */
/** One RLP-encodable scalar. */
export type RlpItem = string | number | bigint | Uint8Array;

function encodeItem(input: RlpItem): Uint8Array {
  // Convert to bytes
  let bytes: Uint8Array;

  if (typeof input === 'string') {
    if (input.startsWith('0x')) {
      const h = input.slice(2);
      bytes = hexToBytes(h.length % 2 ? `0${h}` : h);
    } else {
      bytes = new TextEncoder().encode(input);
    }
  } else if (typeof input === 'number' || typeof input === 'bigint') {
    const bn = BigInt(input);
    if (bn === 0n) {
      bytes = new Uint8Array(0);
    } else {
      const hex = bn.toString(16);
      bytes = hexToBytes(hex.length % 2 ? `0${hex}` : hex);
    }
  } else {
    bytes = input;
  }

  // Empty string
  if (bytes.length === 0) {
    return new Uint8Array([0x80]);
  }

  // Single byte < 0x80
  if (bytes.length === 1 && bytes[0] < 0x80) {
    return bytes;
  }

  // Short string (0-55 bytes)
  if (bytes.length <= 55) {
    return new Uint8Array([0x80 + bytes.length, ...bytes]);
  }

  // Long string (>55 bytes)
  const lengthBytes = encodeLength(bytes.length);
  return new Uint8Array([0xb7 + lengthBytes.length, ...lengthBytes, ...bytes]);
}

/**
 * Encode a list of items
 */
function encodeList(items: readonly RlpItem[]): Uint8Array {
  const encoded = items.map(encodeItem);
  const totalLength = encoded.reduce((sum, item) => sum + item.length, 0);
  const payload = new Uint8Array(totalLength);

  let offset = 0;
  for (const item of encoded) {
    payload.set(item, offset);
    offset += item.length;
  }

  // Short list (0-55 bytes)
  if (totalLength <= 55) {
    return new Uint8Array([0xc0 + totalLength, ...payload]);
  }

  // Long list (>55 bytes)
  const lengthBytes = encodeLength(totalLength);
  return new Uint8Array([0xf7 + lengthBytes.length, ...lengthBytes, ...payload]);
}

/**
 * Encode length as bytes (for long strings/lists)
 */
function encodeLength(length: number): Uint8Array {
  const hex = length.toString(16);
  return hexToBytes(hex.length % 2 ? `0${hex}` : hex);
}

/**
 * Main RLP encode function. A top-level array encodes as an RLP list; its items
 * are scalars (an empty array is the one nested shape callers pass, the empty
 * accessList, and encodes as the empty string `0x80`, as before).
 */
export function rlpEncode(input: RlpItem | readonly RlpItem[]): Uint8Array {
  if (Array.isArray(input)) {
    return encodeList(input as readonly RlpItem[]);
  }
  return encodeItem(input as RlpItem);
}

/**
 * RLP encode and return hex string
 */
export function rlpEncodeHex(input: RlpItem | readonly RlpItem[]): `0x${string}` {
  return `0x${bytesToHex(rlpEncode(input))}`;
}
