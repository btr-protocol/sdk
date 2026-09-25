/**
 * Binary tick codec, shared between Bun WS server (encode) and front Worker (decode).
 *
 * Wire format (28 bytes, little-endian):
 *   offset  size  field          notes
 *   ─────────────────────────────────────────────────────────
 *      0     8    ts             u64 unix-ms timestamp
 *      8     2    sid            u16 symbol id (registry index)
 *     10     8    bid            f64 best bid
 *     18     8    ask            f64 best ask
 *     26     1    flags          u8  bit0=stale bit1=halted bit2=synth
 *     27     1    conf           u8  confidence 0..255 (TDWAP weight)
 *
 * mid = (bid + ask) / 2 (client-computed, zero wire cost)
 * spread_bps = (ask - bid) / mid · 10000 (client-computed)
 *
 * Choice rationale:
 *   - Fixed 28B = 1 MTU friendly, no parsing branches
 *   - ts first → enables cheap monotonic sort + chunked replay
 *   - f64 bid/ask → no precision loss for sub-pip FX/crypto px (mantissa ~15 digits)
 *   - u16 sid → 65k syms ceiling, ample
 *   - permessage-deflate ON at WS layer compresses runs of similar prices ~3-5x further
 */

const TICK_FRAME_BYTES = 28;

interface TickWire {
  ts: number; // unix ms
  sid: number; // u16 symbol id
  bid: number;
  ask: number;
  flags: number; // u8
  conf: number; // u8
}

/** Decode a 28-byte tick frame starting at `offset`. */
function decodeTick(buf: Uint8Array | ArrayBuffer, offset = 0): TickWire {
  const view =
    buf instanceof ArrayBuffer
      ? new DataView(buf, offset, TICK_FRAME_BYTES)
      : new DataView(buf.buffer, buf.byteOffset + offset, TICK_FRAME_BYTES);
  return {
    ts: Number(view.getBigUint64(0, true)),
    sid: view.getUint16(8, true),
    bid: view.getFloat64(10, true),
    ask: view.getFloat64(18, true),
    flags: view.getUint8(26),
    conf: view.getUint8(27),
  };
}

/** Decode a batched buffer of N ticks (28·N bytes). Iterator yields each TickWire. */
export function* decodeTickBatch(buf: Uint8Array | ArrayBuffer): Generator<TickWire> {
  const byteLength = buf instanceof ArrayBuffer ? buf.byteLength : buf.byteLength;
  const n = (byteLength / TICK_FRAME_BYTES) | 0;
  for (let i = 0; i < n; i++) yield decodeTick(buf, i * TICK_FRAME_BYTES);
}
