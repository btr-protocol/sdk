/**
 * Wire v6 (`ExternalOracleV5`) byte-contract pin.
 *
 * The fixture is the SHARED source of truth for the Solidity (`ExternalOracleV5.t.sol`) and
 * keeper-Rust (`signed_v6.rs`) codecs, vendored verbatim from
 * `dex-evm/test/fixtures/oracle-v6-wire-golden.json`. Every vector is asserted, including each
 * expected mark through the self-describing `exp7` lane: a drift in the geometry means the TS
 * codec no longer reads the bytes the chain accepted, which is exactly the failure a hand-rolled
 * "looks right" decoder hides until a mark is served wrong.
 *
 * Regenerate the fixture only on a deliberate wire change, in dex-evm, then re-copy it here.
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hex } from '../src/eth/types';
import {
  V6_BLOB_VERSION,
  V6_EXP_OFFSET,
  V6_HEADER_BYTES,
  V6_MAX_SOURCE_AGE_SECS,
  V6_SOURCE_TS_FUTURE_SKEW_SECS,
  decodeBlobV6,
  decodeLane,
  encodeLane,
} from '../src/oracle/wire';
import GOLDEN from './fixtures/oracle-v6-wire-golden.json';

const BLOB_HEX = GOLDEN.blobHex as Hex;
const BLOB_HASHED = BLOB_HEX.slice(2);
const BLOB_BYTES = Uint8Array.from(
  (BLOB_HASHED.match(/../g) ?? []).map((x) => Number.parseInt(x, 16)),
);

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.slice(2).match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
const bytesToHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

// Byte-exact golden. The fixture is vendored from dex-evm, so the whole of it is pinned by digest
// rather than one literal: a re-copy that moves ANY byte — a lane, an expected mark, the blob —
// moves this hash, which a hand-copied hex constant beside an unread file cannot notice.
const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'oracle-v6-wire-golden.json');
const FIXTURE_SHA256 = '52cd23b3d0f66406d4d8b4a49fc03e231c1a2838b5276bcf05cd66f98e9722ee';

describe('wire v6 fixture shape', () => {
  it('agrees with the constants the codec is built on', () => {
    expect(GOLDEN.wire).toBe(V6_BLOB_VERSION);
    expect(GOLDEN.header.version).toBe(V6_BLOB_VERSION);
    expect(GOLDEN.header.nPrice).toBe(GOLDEN.header.nConf); // nC == nP lockstep
    expect(V6_HEADER_BYTES).toBe(12);
    expect(V6_EXP_OFFSET).toBe(16);
    expect(GOLDEN.batchTypehash).toBe('BatchQuoteV4(bytes32 blobHash)');
  });
});

describe('wire v6 self-describing lanes (exp7:u7 | mant:u25)', () => {
  it('decodes each golden lane to the recorded mark and round-trips the encode', () => {
    const d = decodeBlobV6(BLOB_HEX);
    expect(d.prices).toHaveLength(GOLDEN.expects.length);
    d.prices.forEach((p, i) => {
      const exp = GOLDEN.expects[i];
      expect(p.gi).toBe(exp.gi);
      expect(decodeLane(p.lane, 0, 'v6')).toBe(BigInt(exp.mark1e18));
      // exp7 is absolute: a caller-supplied bias is ignored, never added.
      expect(decodeLane(p.lane, 99, 'v6')).toBe(BigInt(exp.mark1e18));
      // The encoder recovers the exact lane from the golden mark.
      expect(encodeLane(BigInt(exp.mark1e18), 0, 'v6')).toBe(p.lane);
    });
    // 0x7f0f0cf0 -> exp7 63 -> mant << (63-16); the fixture's mantissa/exp split.
    expect(decodeLane(0x7f0f0cf0, 0, 'v6')).toBe(2_499_999_944_549_077_090_304n);
    expect(decodeLane(0x7d9bff2f, 0, 'v6')).toBe(1_899_999_932_524_550_684_672n);
  });

  it('treats the all-zero and any mantissa-MSB-clear lane as the STALE sentinel', () => {
    expect(decodeLane(0, 0, 'v6')).toBe(0n);
    expect(decodeLane(0x00ffffff, 0, 'v6')).toBe(0n);
  });
});

describe('wire v6 blob', () => {
  it('pins the golden bytes and decodes every section', () => {
    expect(createHash('sha256').update(readFileSync(FIXTURE_PATH)).digest('hex')).toBe(
      FIXTURE_SHA256,
    );
    expect(bytesToHex(BLOB_BYTES)).toBe(BLOB_HEX);
    const d = decodeBlobV6(BLOB_BYTES);
    expect(d.version).toBe(6);
    expect(d.seq).toBe(GOLDEN.header.seq);
    expect(d.srcSecs).toBe(GOLDEN.header.srcSecs);
    expect(BigInt(GOLDEN.expects[0].obsSecs)).toBe(BigInt(d.srcSecs));
    expect(d.prices).toEqual([
      { gi: 0, lane: 0x7f0f0cf0 },
      { gi: 1, lane: 0x7d9bff2f },
    ]);
    expect(d.sigmas).toEqual([{ gi: 0, sigmaPbps: 100_000 }]);
    // conf is walked in lockstep: one per price entry, same gi.
    expect(d.confs).toEqual([
      { gi: 0, confBps: 7 },
      { gi: 1, confBps: 9 },
    ]);
  });

  it('accepts an exp7 lane that sets the whole u32 (no reserved top bits)', () => {
    const top = Uint8Array.from(BLOB_BYTES);
    top.set([0xff, 0x0f, 0x0c, 0xf0], 13); // price gi0 lane: exp7 = 127
    expect(() => decodeBlobV6(top)).not.toThrow();
  });

  it('keeps a nonzero MSB-clear lane: the sentinel-write the chain SKIPS, never reverts', () => {
    const skipped = Uint8Array.from(BLOB_BYTES);
    skipped.set([0x00, 0x00, 0x00, 0x01], 13); // nonzero, mantissa MSB clear
    const d = decodeBlobV6(skipped);
    expect(d.prices[0].lane).toBe(1);
    expect(decodeLane(d.prices[0].lane, 0, 'v6')).toBe(0n);
  });

  it('applies the chain Future/Stale bounds on srcSecs only when given the block time', () => {
    const src = GOLDEN.header.srcSecs;
    expect(() => decodeBlobV6(BLOB_BYTES)).not.toThrow();
    expect(() => decodeBlobV6(BLOB_BYTES, src - V6_SOURCE_TS_FUTURE_SKEW_SECS)).not.toThrow();
    expect(() => decodeBlobV6(BLOB_BYTES, src - V6_SOURCE_TS_FUTURE_SKEW_SECS - 1)).toThrow(
      /future/,
    );
    expect(() => decodeBlobV6(BLOB_BYTES, src + V6_MAX_SOURCE_AGE_SECS)).not.toThrow();
    expect(() => decodeBlobV6(BLOB_BYTES, src + V6_MAX_SOURCE_AGE_SECS + 1)).toThrow(/stale/);
  });

  it('fails closed on version, nP == 0, length, gi order, nC and price/conf lockstep', () => {
    const bad = (mut: (b: Uint8Array) => void): Uint8Array => {
      const c = Uint8Array.from(BLOB_BYTES);
      mut(c);
      return c;
    };
    expect(() => decodeBlobV6(bad((b) => (b[0] = 5)))).toThrow(/version/);
    // _checkHeader: nP == 0 reverts even with sigma entries present
    expect(() =>
      decodeBlobV6(
        bad((b) => {
          b[9] = 0;
          b[11] = 0;
        }),
      ),
    ).toThrow(/no entries/);
    // nC (2) -> 1 while nP stays 2
    expect(() => decodeBlobV6(bad((b) => (b[11] = 1)))).toThrow(/nC/);
    // nS -> 2 with the body unchanged: section length disagrees
    expect(() => decodeBlobV6(bad((b) => (b[10] = 2)))).toThrow(/sections/);
    expect(() => decodeBlobV6(BLOB_BYTES.slice(0, 11))).toThrow(/shorter than header/);
    // second price gi 1 -> 0, no longer ascending
    expect(() => decodeBlobV6(bad((b) => (b[17] = 0)))).toThrow(/ascending/);
    // nC == nP == 2 but the conf gi sequence is (0, 2) against price (0, 1)
    const mismatch = hexToBytes(
      '0x06000000016b49d20a020102007f0f0cf0017d9bff2f00000186a0000007020009',
    );
    expect(() => decodeBlobV6(mismatch)).toThrow(/price\/conf gi mismatch/);
  });
});
