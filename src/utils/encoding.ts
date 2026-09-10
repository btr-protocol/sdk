/**
 * Encoding utilities: Hex and Compact Formats
 * Keccak256 is exported from @sdk/eth (uses @noble/hashes)
 */

// ─────────────────────────────────────────────────────────────
// Hex Encoding/Decoding
// ─────────────────────────────────────────────────────────────

export function hexToNumber(hex: string): number {
  return Number.parseInt(hex, 16);
}

export function numberToHex(num: number | bigint): `0x${string}` {
  return `0x${num.toString(16)}`;
}

export function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

export function bigIntToHex(num: bigint): `0x${string}` {
  return `0x${num.toString(16)}`;
}

/**
 * Convert various types to hex string
 */
export function toHex(value: string | number | bigint | boolean | Uint8Array): `0x${string}` {
  if (typeof value === 'string') {
    // Already hex
    if (value.startsWith('0x')) return value as `0x${string}`;
    // UTF-8 string to hex
    return `0x${Array.from(new TextEncoder().encode(value))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return numberToHex(value);
  }
  if (typeof value === 'boolean') {
    return value ? '0x1' : '0x0';
  }
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  throw new Error(`Cannot convert ${typeof value} to hex`);
}

/**
 * Concatenate hex strings or byte arrays
 */
export function concat(values: (`0x${string}` | Uint8Array)[]): `0x${string}` {
  let result = '';
  for (const val of values) {
    if (typeof val === 'string') {
      result += val.slice(2); // Remove 0x prefix
    } else {
      result += Array.from(val)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  }
  return `0x${result}`;
}

/**
 * Pad hex string to specified byte length
 * @param hex - Hex string to pad
 * @param size - Target byte length (default: 32)
 * @param dir - Padding direction: 'left' (default) or 'right'
 */
export function pad(hex: `0x${string}`, size = 32, dir: 'left' | 'right' = 'left'): `0x${string}` {
  const stripped = hex.slice(2);
  const targetLength = size * 2; // 2 hex chars per byte

  if (stripped.length >= targetLength) {
    return hex;
  }

  const padding = '0'.repeat(targetLength - stripped.length);
  return dir === 'left' ? `0x${padding}${stripped}` : `0x${stripped}${padding}`;
}
