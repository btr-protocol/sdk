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
import type { Hex } from '../src/eth/types';
import {
  V6_BLOB_VERSION,
  V6_EXP_OFFSET,
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

// Byte-exact golden: the hex is pinned as a literal so a regenerated fixture cannot drift silently.
const GOLDEN_HEX = '0x0600000001046564020102007f0f0cf0017d9bff2f00000186a0000007010009' as Hex;

describe('wire v6 fixture shape', () => {
  it('agrees with the constants the codec is built on', () => {
    expect(GOLDEN.wire).toBe(V6_BLOB_VERSION);
    expect(GOLDEN.header.version).toBe(V6_BLOB_VERSION);
    expect(GOLDEN.header.nPrice).toBe(GOLDEN.header.nConf); // nC == nP lockstep
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
    expect(BLOB_HEX).toBe(GOLDEN_HEX);
    expect(bytesToHex(BLOB_BYTES)).toBe(GOLDEN_HEX);
    const d = decodeBlobV6(BLOB_BYTES);
    expect(d.version).toBe(6);
    expect(d.seq).toBe(GOLDEN.header.seq);
    expect(d.tsDs).toBe(GOLDEN.header.sourceTsDs);
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
    top.set([0xff, 0x0f, 0x0c, 0xf0], 12); // price gi0 lane: exp7 = 127
    expect(() => decodeBlobV6(top)).not.toThrow();
  });

  it('keeps a nonzero MSB-clear lane: the sentinel-write the chain SKIPS, never reverts', () => {
    const skipped = Uint8Array.from(BLOB_BYTES);
    skipped.set([0x00, 0x00, 0x00, 0x01], 12); // nonzero, mantissa MSB clear
    const d = decodeBlobV6(skipped);
    expect(d.prices[0].lane).toBe(1);
    expect(decodeLane(d.prices[0].lane, 0, 'v6')).toBe(0n);
  });

  it('fails closed on version, tsDs, empty, length, gi order, nC and price/conf lockstep', () => {
    const bad = (mut: (b: Uint8Array) => void): Uint8Array => {
      const c = Uint8Array.from(BLOB_BYTES);
      mut(c);
      return c;
    };
    expect(() => decodeBlobV6(bad((b) => (b[0] = 5)))).toThrow(/version/);
    // tsDs = 864000 = 0x0D2F00, one past the day
    expect(() =>
      decodeBlobV6(
        bad((b) => {
          b[5] = 0x0d;
          b[6] = 0x2f;
          b[7] = 0x00;
        }),
      ),
    ).toThrow(/tsDs/);
    expect(() =>
      decodeBlobV6(
        bad((b) => {
          b[8] = 0;
          b[9] = 0;
          b[10] = 0;
        }),
      ),
    ).toThrow(/no entries/);
    // nC (2) -> 1 while nP stays 2
    expect(() => decodeBlobV6(bad((b) => (b[10] = 1)))).toThrow(/nC/);
    // nS -> 2 with the body unchanged: section length disagrees
    expect(() => decodeBlobV6(bad((b) => (b[9] = 2)))).toThrow(/sections/);
    expect(() => decodeBlobV6(BLOB_BYTES.slice(0, 10))).toThrow(/shorter than header/);
    // second price gi 1 -> 0, no longer ascending
    expect(() => decodeBlobV6(bad((b) => (b[16] = 0)))).toThrow(/ascending/);
    // nC == nP == 2 but the conf gi sequence is (0, 2) against price (0, 1)
    const mismatch = hexToBytes(
      '0x0600000001046564020102007f0f0cf0017d9bff2f00000186a0000007020009',
    );
    expect(() => decodeBlobV6(mismatch)).toThrow(/price\/conf gi mismatch/);
  });
});
