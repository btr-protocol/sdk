import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  covCap,
  covLegToll,
  covSwapToll,
  covToll,
  covWalls,
  kappaBps,
  kappaCode,
  packCov,
  packKnee,
  unpackCov,
  unpackKnee,
} from './cov';

// dex-evm `tools/covlaw.py` writes the vectors (column-major decimal strings); the Solidity
// `CovLaw.t.sol` replays the same file. Absent sibling checkout = skipped, never a green no-op in CI
// (the SDK build clones dex-evm next to it).
const path = join(import.meta.dir, '../../../dex-evm/test/proto/cov_vectors.json');
const have = existsSync(path);
type Col = string[];
const V = have ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Col[]>) : {};
const rows = (t: string): bigint[][] => {
  const cols = V[t] as Col[];
  return (cols[0] as Col).map((_, i) => cols.map((c) => BigInt(c[i] as string)));
};

describe.skipIf(!have)('cov_vectors.json replay (bit-exact)', () => {
  test('toll', () => {
    const r = rows('toll');
    expect(r.length).toBeGreaterThan(100);
    for (const [b, kb, kn, r0, l, r1, l1, t, w] of r as [bigint, ...bigint[]][]) {
      expect(
        covToll(
          b,
          kb as bigint,
          kn as bigint,
          r0 as bigint,
          l as bigint,
          r1 as bigint,
          l1 as bigint,
        ),
      ).toEqual([t as bigint, w === 1n]);
    }
  });
  test('walls', () => {
    for (const [b, r0, l, r1, l1, w] of rows('walls') as bigint[][]) {
      expect(covWalls(b as bigint, r0 as bigint, l as bigint, r1 as bigint, l1 as bigint)).toBe(
        w === 1n,
      );
    }
  });
  test('cap', () => {
    for (const [b, kb, neg, kn, r0, l, room] of rows('cap') as bigint[][]) {
      expect(
        covCap(b as bigint, kb as bigint, neg === 1n, kn as bigint, r0 as bigint, l as bigint),
      ).toBe(room as bigint);
    }
  });
  test('leg', () => {
    for (const [b, kb, neg, kn, r0, l, amt, t, refused] of rows('leg') as bigint[][]) {
      const got = covLegToll(
        b as bigint,
        kb as bigint,
        neg === 1n,
        kn as bigint,
        r0 as bigint,
        l as bigint,
        amt as bigint,
      );
      expect(got === null ? [0n, true] : [got, false]).toEqual([t as bigint, refused === 1n]);
    }
  });
  test('swap', () => {
    for (const [b, kb, kn, r0, l, g, b2, r2, l2, ai, t, refused] of rows('swap') as bigint[][]) {
      const got = covSwapToll(
        {
          covBits: b as bigint,
          kneeBits: kb as bigint,
          kNeg: kn as bigint,
          r: r0 as bigint,
          l: l as bigint,
        },
        g as bigint,
        { covBits: b2 as bigint, r: r2 as bigint, l: l2 as bigint },
        ai as bigint,
      );
      expect(got === null ? [0n, true] : [got, false]).toEqual([t as bigint, refused === 1n]);
    }
  });
});

describe('codec', () => {
  test('kappa minifloat', () => {
    expect([0, 3, 4, 7, 8, 9, 10, 11, 12, 16, 53].map(kappaBps)).toEqual([
      0, 3, 4, 7, 8, 10, 12, 14, 16, 32, 20_480,
    ]);
    for (let c = 0; c <= 53; c++) expect(kappaCode(kappaBps(c))).toBe(c);
    expect(() => kappaCode(9)).toThrow();
  });
  test('pack/unpack covBits and knee', () => {
    const t = {
      covMinBps: 1000,
      covTargetBps: 10_070,
      covFlatBps: 500,
      covMaxBps: 23_500,
      kappaCovBps: 32,
      kappaPosBps: 14_336,
    };
    expect(unpackCov(packCov(t))).toEqual(t);
    const k = { kneeCovBps: 2000, kappaKneeBps: 64 };
    expect(unpackKnee(packKnee(1000, k))).toEqual(k);
    expect(packKnee(1000, { kneeCovBps: 0, kappaKneeBps: 0 })).toBe(0);
    expect(() => packCov({ ...t, covMinBps: 1100 })).toThrow();
  });
});
