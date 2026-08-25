/**
 * Differential guard for `readCurve`'s hand-decoded bit packing.
 *
 * Why this file exists: `test/storage-layout.test.ts` pins every SDK slot/offset table against
 * solc's `storageLayout`, but solc reports `NUQuartic.Curve` as `header:uint256 + segs:uint256[28]`.
 * The real layout — `m | 14×uint16 boundaries | dispRef@232 | flags@248` in the header, and
 * `c0|c1|c2|c3` / `c4|S` as signed lanes in the segment words — is packed BY HAND inside
 * `NUQuartic.set`, so it is invisible to `storageLayout` and the layout test cannot cover it. That
 * is the same blind spot that let the `presetId` off-by-4 ship, with every shaped quote reading a
 * bogus curve behind a green suite.
 *
 * The guard is differential, not a re-implementation: `test/fixtures/curve-storage.json` holds the
 * RAW STORAGE WORDS `NUQuartic.set` wrote for a deliberately awkward curve, together with the
 * library's OWN `rangeQ`/`evalQ`/`areaQ` readings of them. This serves those words to the real
 * `readCurve` over a fake provider and asserts the SDK recovers exactly what Solidity put in — so a
 * decoder that drifts fails even if it drifts consistently. Regenerate with
 * `test/fixtures/gen-curve-storage.sh` (reproducible: it archives dex at a named revision).
 */

import { describe, expect, test } from 'bun:test';
import { areaQ, evalQ } from '../src/amm/aimm';
import type { Address, Eip1193Provider, Hex } from '../src/eth/types';
import { CURVE_SEG_SLOTS, readCurve } from '../src/pool/storage';
import FIXTURE from './fixtures/curve-storage.json';

const POOL = '0x00000000000000000000000000000000000000aa' as Address;
const PRESET_ID = 7;

interface Fixture {
  dispRef: number;
  flags: number;
  interior: number[];
  wQ: string[];
  y0: string;
  span: string;
  words: string[];
  evalQ: [number, string | number][];
  areaQ: [number, number, string | number][];
}
const fx = FIXTURE as unknown as Fixture;

/**
 * Serves the dumped words as if they were `curves[PRESET_ID]`. The base slot is taken from the
 * FIRST slot `readCurve` asks for, so this fixes the packing under test without also re-asserting
 * the mapping slot arithmetic (which `storage-layout.test.ts` owns).
 */
function wordProvider(words: string[] = fx.words): Eip1193Provider & { reads: bigint[] } {
  const reads: bigint[] = [];
  let base: bigint | null = null;
  return {
    reads,
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method !== 'eth_getStorageAt') throw new Error(`unexpected ${method}`);
      const slot = BigInt((params as [Address, Hex, string])[1]);
      reads.push(slot);
      if (base === null) base = slot;
      const i = Number(slot - base);
      return (words[i] ?? `0x${'0'.repeat(64)}`) as Hex;
    },
  } as Eip1193Provider & { reads: bigint[] };
}

const read = () => readCurve(wordProvider(), POOL, PRESET_ID);

describe('readCurve decodes the words NUQuartic.set actually wrote', () => {
  test('header fields: m, the uint16 boundary directory, dispRef@232, flags@248', async () => {
    const c = (await read()) as NonNullable<Awaited<ReturnType<typeof readCurve>>>;
    expect(c).not.toBeNull();
    // m = interior + 1 spans for a clamped quartic; the directory's last edge is always BPS.
    expect(c.m).toBe(fx.interior.length + 1);
    expect(c.boundaries).toEqual([...fx.interior, 10_000]);
    expect(c.dispRef).toBe(fx.dispRef);
    expect(c.flags).toBe(fx.flags);
  });

  test('segment lanes: evalQ over the dumped grid matches Solidity exactly', async () => {
    const c = (await read()) as NonNullable<Awaited<ReturnType<typeof readCurve>>>;
    expect(fx.evalQ.length).toBeGreaterThan(50);
    for (const [x, y] of fx.evalQ) expect(`${evalQ(c, x)}`).toBe(`${y}`);
  });

  test('the int128 prefix integral: areaQ over the dumped windows matches Solidity exactly', async () => {
    const c = (await read()) as NonNullable<Awaited<ReturnType<typeof readCurve>>>;
    expect(fx.areaQ.length).toBeGreaterThan(5);
    for (const [x1, x2, a] of fx.areaQ) expect(`${areaQ(c, x1, x2)}`).toBe(`${a}`);
  });

  test('rangeQ: the clamped ends are the CENTRED control weights, exactly', async () => {
    const c = (await read()) as NonNullable<Awaited<ReturnType<typeof readCurve>>>;
    // Solidity's own rangeQ.
    expect(`${evalQ(c, 0)}`).toBe(fx.y0);
    expect(`${evalQ(c, 10_000) - evalQ(c, 0)}`).toBe(fx.span);
    // `NUQuartic.set` is external, so its `memory` params are ABI-decoded copies: `_centre` shifts
    // them in the callee only and the fixture records the polygon as SUBMITTED. Re-apply the same
    // shift here — `(wQ[0] + wQ[n-1]) >> 1`, arithmetic shift as in Solidity — so this still
    // asserts the stored ends against the centred weights rather than against the raw input.
    const first = BigInt(fx.wQ[0]!);
    const last = BigInt(fx.wQ[fx.wQ.length - 1]!);
    const shift = (first + last) >> 1n;
    expect(`${evalQ(c, 0)}`).toBe(`${first - shift}`);
    expect(`${evalQ(c, 10_000)}`).toBe(`${last - shift}`);
  });

  test('one speculative sweep of header + the fixed 28-slot block - one round trip, no more', async () => {
    const p = wordProvider();
    const c = (await readCurve(p, POOL, PRESET_ID)) as NonNullable<
      Awaited<ReturnType<typeof readCurve>>
    >;
    // eth_getStorageAt cannot ride Multicall3 aggregate3 (raw storage, no view getter by
    // policy), so batching means ONE coalesced JSON-RPC batch: header + the whole fixed
    // uint256[28] segment block fetched speculatively - never a second dependent round trip.
    expect(p.reads.length).toBe(1 + CURVE_SEG_SLOTS);
    // Only the live 2m words are decoded; the speculative tail is ignored.
    expect(c.m).toBeGreaterThan(0);
  });

  test('an unset preset (header 0) reads as null, not as an m=0 curve', async () => {
    const zero = await readCurve(wordProvider([`0x${'0'.repeat(64)}`]), POOL, PRESET_ID);
    expect(zero).toBeNull();
  });

  // Perturbation: every lane the decoder reads must be load-bearing. Flip one bit in each
  // packed field of the storage words and require the decode to change — a lane that survives a
  // flip is a lane the guard is not actually covering.
  test('perturbation: flipping any packed lane changes the decode', async () => {
    const base = (await read()) as NonNullable<Awaited<ReturnType<typeof readCurve>>>;
    // header bit 0 (m), 8 (boundary b1), 232 (dispRef), 248 (flags); then, in the first two
    // segment words, bit 0 (c0), 64 (c1), 128 (c2), 192 (c3) and bit 0 (c4), 64 (S).
    const targets: [word: number, bit: bigint][] = [
      [0, 0n],
      [0, 8n],
      [0, 232n],
      [0, 248n],
      [1, 0n],
      [1, 64n],
      [1, 128n],
      [1, 192n],
      [2, 0n],
      [2, 64n],
    ];
    for (const [w, bit] of targets) {
      const words = [...fx.words];
      const flipped = BigInt(words[w]) ^ (1n << bit);
      words[w] = `0x${flipped.toString(16).padStart(64, '0')}`;
      const c = await readCurve(wordProvider(words), POOL, PRESET_ID);
      expect(
        JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? `${v}` : v)),
        `word ${w} bit ${bit}`,
      ).not.toBe(JSON.stringify(base, (_k, v) => (typeof v === 'bigint' ? `${v}` : v)));
    }
  });
});
