/**
 * MITCH instrument ids, and the oracle feed identity derived from them.
 *
 * The oracle's feed identity is migrating from `keccak256(abi.encodePacked(token, USDC))` to the
 * MITCH ticker id, left-padded into a bytes32. keccak names a feed after a PAIR OF ADDRESSES, so
 * the same asset has a different id on every chain, a faucet twin has an id no feed answers to,
 * and nothing about a mark can be joined back to the tape that produced it. The MITCH id is
 * content-derived from the instrument itself: identical on every chain, and the same key the
 * signed NXR record already carries.
 *
 * Layout (u64, MSB first):
 *   63-60 instrument type · 59-56 base class · 55-40 base id
 *   39-36 quote class     · 35-20 quote id   · 19-0  sub type
 *
 * The generated venue table stores these as DECIMAL STRINGS (`tickerIds`) because a u64 does not
 * survive JSON as a number: today's spot ids all happen to be multiples of 2^20 and squeak
 * through a double, but the low 20 bits are a real field, and a sub-typed id rounds into a
 * different, valid-looking instrument. Every entry point here accepts the string.
 */

import type { Hex } from '../eth/types.js';
import { pad } from '../utils/encoding.js';

export interface MitchTicker {
  instrumentType: number;
  baseClass: number;
  baseId: number;
  quoteClass: number;
  quoteId: number;
  subType: number;
}

/** MITCH instrument types (bits 63-60). */
export const MITCH_INSTRUMENT = {
  Spot: 0x0,
  Future: 0x1,
  Forward: 0x2,
  Swap: 0x3,
  Perpetual: 0x4,
  Cfd: 0x5,
  Call: 0x6,
  Put: 0x7,
  Fund: 0xc,
} as const;

const INSTRUMENT_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(MITCH_INSTRUMENT).map(([k, v]) => [v, k]),
);

/** Human name for an instrument type; `Unknown(0xN)` for a type this SDK does not know yet. */
export function mitchInstrumentName(t: number): string {
  return INSTRUMENT_NAMES[t] ?? `Unknown(0x${(t & 0xf).toString(16)})`;
}

/** Widen whatever the caller has - decimal string, number, bigint - to the u64. */
function toU64(id: bigint | string | number): bigint {
  const v = typeof id === 'bigint' ? id : BigInt(id);
  if (v < 0n || v >= 1n << 64n) throw new Error(`not a MITCH ticker id (u64): ${id}`);
  return v;
}

const field = (id: bigint, shift: number, bits: number): number =>
  Number((id >> BigInt(shift)) & ((1n << BigInt(bits)) - 1n));

export function decodeMitchTicker(id: bigint | string | number): MitchTicker {
  const v = toU64(id);
  return {
    instrumentType: field(v, 60, 4),
    baseClass: field(v, 56, 4),
    baseId: field(v, 40, 16),
    quoteClass: field(v, 36, 4),
    quoteId: field(v, 20, 16),
    subType: field(v, 0, 20),
  };
}

export function encodeMitchTicker(t: MitchTicker): bigint {
  const put = (v: number, bits: number, shift: number): bigint => {
    if (!Number.isInteger(v) || v < 0 || v >= 2 ** bits) {
      throw new Error(`MITCH field at bit ${shift} does not fit in ${bits} bits: ${v}`);
    }
    return BigInt(v) << BigInt(shift);
  };
  return (
    put(t.instrumentType, 4, 60) |
    put(t.baseClass, 4, 56) |
    put(t.baseId, 16, 40) |
    put(t.quoteClass, 4, 36) |
    put(t.quoteId, 16, 20) |
    put(t.subType, 20, 0)
  );
}

/** `bytes32(uint256(tickerId))`: the u64 in the low 8 bytes, top 24 bytes zero. */
export function mitchFeedId(id: bigint | string | number): Hex {
  return pad(`0x${toU64(id).toString(16)}`, 32);
}

/**
 * Is this feedId a MITCH id rather than a keccak digest?
 *
 * A keccak digest with 24 leading zero bytes is a 1-in-2^192 event, so the top-bytes test
 * separates the two schemes for as long as both are live. Zero is neither: an unset id.
 */
export function isMitchFeedId(feedId: Hex): boolean {
  return mitchTickerOfFeedId(feedId) !== null;
}

/** The u64 behind a MITCH feedId, or null when `feedId` is not one (keccak, or unset). */
export function mitchTickerOfFeedId(feedId: Hex): bigint | null {
  const h = feedId.slice(2).toLowerCase();
  if (h.length !== 64 || !/^[0-9a-f]+$/.test(h)) return null;
  if (h.slice(0, 48) !== '0'.repeat(48)) return null;
  const low = BigInt(`0x${h.slice(48)}`);
  return low === 0n ? null : low;
}
