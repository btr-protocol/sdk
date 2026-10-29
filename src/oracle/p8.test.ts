import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { privateKeyToAddress } from '../eth/client';
import type { Hex } from '../eth/types';
import { verifyPushP8 } from './p8';

// dex-evm's wire 3 golden push (two segments, k = 2 of 3 per tier, test keys only), landed on a
// live store by `MarkStoreP8Golden.t.sol`. Vendored as test/fixtures so a fresh clone runs it.
const G = JSON.parse(
  readFileSync(new URL('../../test/fixtures/oracle-p8-push-golden.json', import.meta.url), 'utf8'),
) as {
  chainId: number;
  factory: `0x${string}`;
  calldataHex: Hex;
  segments: { signerBitmap: number; pks: string[] }[];
};
const word = (a: string): Hex => `0x${a.slice(2).padStart(64, '0')}`;
/** The store's roster for a tier: signer addresses ascending, as `setAuth` seats them. */
const rosterOf = (pks: string[]): Hex[] =>
  pks
    .map((pk) => privateKeyToAddress(`0x${pk.slice(2).padStart(64, '0')}` as Hex).toLowerCase())
    .sort()
    .map(word);
const signers = { 1: rosterOf(G.segments[0].pks), 2: rosterOf(G.segments[1].pks) };
// AUTH: tier t at bit 32 (t - 1): n = 3 | k = 2 << 8 | 1 relayer << 16.
const tierCfg = 3n | (2n << 8n) | (1n << 16n);
const AUTH = tierCfg | (tierCfg << 32n);
const ctx = { factory: G.factory, chainId: G.chainId, auth: AUTH, signers };

describe('publishMarks verification (wire 3)', () => {
  test('both segments verify against the stored roster', () => {
    const segs = verifyPushP8(G.calldataHex, ctx);
    expect(
      segs.map((s) => ({ tier: s.tier, bitmap: s.bitmap, k: s.k, lanes: s.lanes, ok: s.ok })),
    ).toEqual([
      { tier: 1, bitmap: 0b011, k: 2, lanes: 12, ok: true },
      { tier: 2, bitmap: 0b101, k: 2, lanes: 5, ok: true },
    ]);
    expect(segs[0].srcMs).toBe(1790000000250);
  });

  test('a disabled signer, another chain or a tampered signature fails the quorum', () => {
    const dis = { ...signers, 1: [...signers[1]] };
    dis[1][0] = word(`0x${(BigInt(dis[1][0]) | (1n << 160n)).toString(16)}`);
    expect(verifyPushP8(G.calldataHex, { ...ctx, signers: dis })[0].quorum).toBe(false);
    expect(verifyPushP8(G.calldataHex, { ...ctx, chainId: 1 })[0].quorum).toBe(false);
    // Flip a nibble inside the first segment's first signature's s: v stays valid.
    const at = 2 + 2 * (4 + 15 + 12 * 5 + 2) + 80;
    const f = G.calldataHex[at] === '0' ? '1' : '0';
    const bad = `${G.calldataHex.slice(0, at)}${f}${G.calldataHex.slice(at + 1)}` as Hex;
    expect(verifyPushP8(bad, ctx)[0].ok).toBe(false);
  });

  test('a bitmap bit at or above the stored n fails', () => {
    const n2 = 2n | (2n << 8n) | (1n << 16n);
    const segs = verifyPushP8(G.calldataHex, { ...ctx, auth: tierCfg | (n2 << 32n) });
    expect(segs.map((s) => s.ok)).toEqual([true, false]);
  });

  test('a recovery byte the contract would reject throws', () => {
    const cd = G.calldataHex;
    const idx = cd.indexOf('0201a0c4506cfa'); // tier 2 header
    const v0 = `${cd.slice(0, idx - 2)}00${cd.slice(idx)}` as Hex;
    expect(() => verifyPushP8(v0, ctx)).toThrow('recovery byte');
  });

  test('truncated or foreign calldata throws instead of verifying', () => {
    expect(() => verifyPushP8(G.calldataHex.slice(0, 120) as Hex, ctx)).toThrow();
    expect(() => verifyPushP8('0xdeadbeef', ctx)).toThrow('not a publishMarks call');
  });
});
