import type { Hex } from '../src/eth/types';

export const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.slice(2).match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
export const bytesToHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
/** A copy of `src` with `mut` applied: one corrupted field per fail-closed case. */
export const mutated = (src: Uint8Array, mut: (b: Uint8Array) => void): Uint8Array => {
  const c = Uint8Array.from(src);
  mut(c);
  return c;
};
