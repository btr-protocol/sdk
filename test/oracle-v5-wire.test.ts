/**
 * Wire v5 (`ExternalOracleV4`) byte-contract pin.
 *
 * The fixture is the SHARED source of truth for all four codecs - Solidity, keeper Rust, NXR Rust
 * and this one - vendored verbatim from `dex-evm/test/fixtures/oracle-v5-wire-golden.json`. Every
 * vector in it is asserted here, including the blob's keccak256: a drift in the hash means the TS
 * codec no longer reads the bytes the chain accepted, which is exactly the failure that a
 * hand-rolled "looks right" decoder hides until a mark is served wrong.
 *
 * Regenerate the fixture only on a deliberate wire change, in dex-evm, then re-copy it here.
 */

import { describe, expect, it } from 'bun:test';
import { keccak256 } from '../src/eth/index';
import type { Hex } from '../src/eth/types';
import {
  V5_BLOB_VERSION,
  V5_DAY_DS,
  V5_HEADER_BYTES,
  V5_LANES_PER_SLOT,
  V5_LANE_MASK,
  decodeBlobV5,
  decodeLane,
  encodeBlobV5,
  encodeLane,
  reconSecsFromDs,
} from '../src/oracle/wire';
import GOLDEN from './fixtures/oracle-v5-wire-golden.json';

interface LaneVector {
  name: string;
  value_1e18: string;
  expBias: number;
  exp: number;
  mant: number;
  lane_bits: number;
  lane_hex: string;
  decoded_1e18: string;
  abs_err: string;
}

const LANES = GOLDEN.lanes as LaneVector[];
const BLOB = GOLDEN.blob;
const BLOB_HEX = BLOB.hex as Hex;
const BLOB_HASH = BLOB.keccak256 as Hex;

const hexToBytes = (h: string): Uint8Array =>
  Uint8Array.from((h.slice(2).match(/../g) ?? []).map((x) => Number.parseInt(x, 16)));
const bytesToHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

// Byte-exact golden, pinned as literals so a regenerated fixture cannot drift silently:
// hex and keccak must BOTH match, or the TS codec no longer reads chain-accepted bytes.
const GOLDEN_HEX =
  '0x050000000104656402010100170f0cf001159bff2f00000186a0010009' as Hex;
const GOLDEN_KECCAK =
  '0x6615180489aad02e35006978fa1ff39fbdd81129e84fa95037374454c5399b35' as Hex;

describe('wire v5 fixture shape', () => {
  it('agrees with the constants the codec is built on', () => {
    expect(GOLDEN.wire_version).toBe(V5_BLOB_VERSION);
    expect(GOLDEN.header_bytes).toBe(V5_HEADER_BYTES);
    expect(GOLDEN.price_entry_bytes).toBe(5);
    expect(GOLDEN.sigma_entry_bytes).toBe(5);
    expect(GOLDEN.conf_entry_bytes).toBe(3);
    expect(GOLDEN.lanes_per_slot).toBe(V5_LANES_PER_SLOT);
    expect(GOLDEN.clock.modulus_ds).toBe(V5_DAY_DS);
    // dayMod is storage-only; the codec must neither emit nor parse it.
    expect(GOLDEN.day_mod.on_the_wire).toBe(false);
  });
});

describe('wire v5 lanes (exp:u4 | mant:u25)', () => {
  for (const v of LANES) {
    it(`encodes ${v.name} to the golden lane bits`, () => {
      const lane = encodeLane(BigInt(v.value_1e18), v.expBias, 'v5');
      expect(lane).toBe(v.lane_bits);
      expect(`0x${lane.toString(16).padStart(8, '0')}`).toBe(v.lane_hex);
      // the fixture's field split is the layout claim: exp at bit 25, 25-bit mantissa
      expect(lane & ((1 << 25) - 1)).toBe(v.mant);
      expect(lane >>> 25).toBe(v.exp);
      expect(lane).toBeLessThanOrEqual(V5_LANE_MASK);
    });

    it(`decodes ${v.name} to the golden mark and error`, () => {
      const got = decodeLane(v.lane_bits, v.expBias, 'v5');
      expect(got).toBe(BigInt(v.decoded_1e18));
      expect(BigInt(v.value_1e18) - got).toBe(BigInt(v.abs_err));
    });

    it(`round-trips ${v.name} through encode -> decode -> encode`, () => {
      const lane = encodeLane(BigInt(v.value_1e18), v.expBias, 'v5');
      expect(encodeLane(decodeLane(lane, v.expBias, 'v5'), v.expBias, 'v5')).toBe(lane);
    });
  }

  it('pins the mantissa boundaries 2^24 and 2^25-1', () => {
    const min = LANES.find((l) => l.name === 'mant_min_2p24');
    const max = LANES.find((l) => l.name === 'mant_max_2p25m1');
    expect(min?.mant).toBe(2 ** 24);
    expect(max?.mant).toBe(2 ** 25 - 1);
    expect(encodeLane(1n << 24n, 0, 'v5')).toBe(0x01000000);
    expect(encodeLane((1n << 25n) - 1n, 0, 'v5')).toBe(0x01ffffff);
  });

  it('pins exp 0 and exp 15 at both mantissa ends', () => {
    expect(LANES.filter((l) => l.exp === 15)).toHaveLength(2);
    expect(encodeLane(BigInt(1 << 24) << 15n, 0, 'v5')).toBe(0x1f000000);
    expect(encodeLane(((1n << 25n) - 1n) << 15n, 0, 'v5')).toBe(0x1fffffff);
    expect(decodeLane(0x1fffffff, 0, 'v5')).toBe(((1n << 25n) - 1n) << 15n);
  });

  it('treats the all-zero lane as the STALE sentinel, both ways', () => {
    expect(decodeLane(0, 36, 'v5')).toBe(0n);
    // any lane with the mantissa MSB clear is not a live price either
    expect(decodeLane(0x00ffffff, 36, 'v5')).toBe(0n);
    const rt = decodeBlobV5(
      encodeBlobV5({ seq: 1, tsDs: 0, prices: [{ gi: 3, lane: 0 }], sigmas: [], confs: [] }),
    );
    expect(rt.prices).toEqual([{ gi: 3, lane: 0 }]);
    expect(decodeLane(rt.prices[0].lane, 36, 'v5')).toBe(0n);
  });

  it('refuses a value no exponent can normalize', () => {
    expect(() => encodeLane(1n, 0, 'v5')).toThrow(/no exponent fits/);
  });

  it('does not disturb the V2/V3 lane geometries', () => {
    expect(encodeLane(2500n * 10n ** 18n, 43, 'v3')).toBe(0x2e1e19);
    expect(encodeLane(2500n * 10n ** 18n, 43, 'v2')).toBe(0x343c33c);
  });
});

describe('wire v5 blob', () => {
  const bytes = hexToBytes(BLOB_HEX);

  it('pins the golden blob length and keccak256', () => {
    expect(BLOB_HEX).toBe(GOLDEN_HEX);
    expect(BLOB_HASH).toBe(GOLDEN_KECCAK);
    expect(bytes.length).toBe(BLOB.length);
    expect(bytes.length).toBe(V5_HEADER_BYTES + 2 * 5 + 1 * 5 + 1 * 3);
    expect(keccak256(bytes)).toBe(GOLDEN_KECCAK);
  });

  it('decodes the golden header and every section', () => {
    const d = decodeBlobV5(bytes);
    expect(d.version).toBe(BLOB.decoded.ver);
    expect(d.seq).toBe(BLOB.decoded.seq);
    expect(d.tsDs).toBe(BLOB.decoded.tsDs);
    expect(d.prices).toHaveLength(BLOB.decoded.nP);
    expect(d.sigmas).toHaveLength(BLOB.decoded.nS);
    expect(d.confs).toHaveLength(BLOB.decoded.nC);
    expect(d.prices).toEqual(BLOB.decoded.prices.map((p) => ({ gi: p.gi, lane: p.lane })));
    expect(d.sigmas).toEqual(BLOB.decoded.sigmas);
    expect(d.confs).toEqual(BLOB.decoded.confs);
    for (const p of BLOB.decoded.prices) {
      expect(decodeLane(p.lane, p.expBias, 'v5')).toBe(BigInt(p.mark1e18));
    }
  });

  it('re-encodes the golden blob byte-for-byte', () => {
    const d = decodeBlobV5(bytes);
    const re = encodeBlobV5(d);
    expect(bytesToHex(re)).toBe(GOLDEN_HEX);
    expect(keccak256(re)).toBe(GOLDEN_KECCAK);
  });

  it('round-trips a multi-magnitude blob (JPYC-scale through WBTC-scale)', () => {
    const wanted = ['JPYC_small', 'KRW1_tiny', 'USDT_near_one', 'WETH', 'WBTC_large', 'PAXG'];
    const picked = wanted.map((n) => LANES.find((l) => l.name === n) as LaneVector);
    const prices = picked.map((v, i) => ({
      gi: i,
      lane: encodeLane(BigInt(v.value_1e18), v.expBias, 'v5'),
    }));
    // gi 6 stays a STALE sentinel, gi 7 spans the next slot boundary
    prices.push({ gi: 6, lane: 0 }, { gi: V5_LANES_PER_SLOT, lane: 0x1fffffff });
    const blob = {
      seq: 4_294_967_295,
      tsDs: V5_DAY_DS - 1,
      prices,
      sigmas: [{ gi: 0, sigmaPbps: 4_294_967_295 }],
      confs: [{ gi: 1, confBps: 65_535 }],
    };
    const d = decodeBlobV5(encodeBlobV5(blob));
    expect(d).toEqual({ version: V5_BLOB_VERSION, ...blob });
    picked.forEach((v, i) => {
      expect(decodeLane(d.prices[i].lane, v.expBias, 'v5')).toBe(BigInt(v.decoded_1e18));
    });
    expect(decodeLane(d.prices[6].lane, 0, 'v5')).toBe(0n);
  });

  it('fails closed on version, tsDs, empty, length, reserved bits and gi order', () => {
    const bad = (mut: (b: Uint8Array) => void): Uint8Array => {
      const c = Uint8Array.from(bytes);
      mut(c);
      return c;
    };
    expect(() => decodeBlobV5(bad((b) => (b[0] = 4)))).toThrow(/version/);
    // tsDs = 864000 = 0x0D2F00, one past the day
    expect(() =>
      decodeBlobV5(
        bad((b) => {
          b[5] = 0x0d;
          b[6] = 0x2f;
          b[7] = 0x00;
        }),
      ),
    ).toThrow(/tsDs/);
    expect(() =>
      decodeBlobV5(
        bad((b) => {
          b[8] = 0;
          b[9] = 0;
          b[10] = 0;
        }),
      ),
    ).toThrow(/no entries/);
    expect(() => decodeBlobV5(bad((b) => (b[8] = 3)))).toThrow(/sections/);
    expect(() => decodeBlobV5(bytes.slice(0, V5_HEADER_BYTES - 1))).toThrow(/shorter than header/);
    // top 3 bits of the u32 lane entry are reserved
    expect(() => decodeBlobV5(bad((b) => (b[12] = 0xff)))).toThrow(/reserved top bit/);
    // second price entry gi 1 -> 0, no longer ascending
    expect(() => decodeBlobV5(bad((b) => (b[16] = 0)))).toThrow(/ascending/);
  });

  it('rejects an out-of-range field at encode rather than truncating it', () => {
    const one = { gi: 0, lane: 0x01000000 };
    expect(() =>
      encodeBlobV5({ seq: 0, tsDs: V5_DAY_DS, prices: [one], sigmas: [], confs: [] }),
    ).toThrow(/tsDs/);
    expect(() =>
      encodeBlobV5({ seq: 0, tsDs: 0, prices: [{ gi: 0, lane: 1 << 29 }], sigmas: [], confs: [] }),
    ).toThrow(/29 bits/);
    expect(() =>
      encodeBlobV5({
        seq: 0,
        tsDs: 0,
        prices: [one, { gi: 0, lane: 0x01000000 }],
        sigmas: [],
        confs: [],
      }),
    ).toThrow(/ascending/);
    expect(() => encodeBlobV5({ seq: 0, tsDs: 0, prices: [], sigmas: [], confs: [] })).toThrow(
      /no entries/,
    );
  });
});

describe('wire v5 cyclic clock', () => {
  it('reconstructs the fixture tsDs against its epoch hint', () => {
    const now = GOLDEN.blob.epoch_hint_secs;
    const recon = reconSecsFromDs(now, BLOB.tsDs);
    expect((recon % 86_400) * 10).toBe(BLOB.tsDs);
    expect(Math.abs(recon - now)).toBeLessThanOrEqual(GOLDEN.clock.max_recon_age_secs);
  });

  it('picks the nearest candidate day across midnight, both directions', () => {
    // 00:00:05 UTC; a mark stamped 23:59:55 belongs to YESTERDAY, 10s back
    const now = 1_800_000_000 - (1_800_000_000 % 86_400) + 5;
    expect(reconSecsFromDs(now, 863_950)).toBe(now - 10);
    // and one stamped 00:00:15 is 10s ahead, same day
    expect(reconSecsFromDs(now, 150)).toBe(now + 10);
  });
});
