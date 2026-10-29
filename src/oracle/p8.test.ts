import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { privateKeyToAddress } from '../eth/client';
import type { Hex } from '../eth/types';
import { verifyPushP8, verifyPushP8At } from './p8';

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

// Real Monad wire 2 push (p8.v2.test.ts): the same bytes under the v10 dispatch must not verify.
const W2 =
  '0x013b6436016abe148000000000000000107f220280845b03310751cb9a7465a4c39f97a942b8ba09c467e21382072f290cf83f354015e0214b11a86ce004a737c570421d6755cb4099d21c84afbfbd17410f121c0202b1ea5d344fc5f4ce77a9f931a8eda0f5803c5e7c47e1c98589a5981fc907567816c598944dfe074a2102248a7d1e439cacd2cdbc3f8aa7aedd0eb470d5fa419da638e026787d7cf73759528a77aa9b8d6a1dfb8bdb1b03bf7096b12d4aa74ed1a8f6f4f7e4536a4a1cccb06907eb8efc91f341b732b4979180d34abdf53ce840ec374822f5896ace204e8e84bd71ccfb326de4ca925a799a1ccef0ccb95d1d24f1128d2587724639a31c' as Hex;
const W2_FACTORY = '0xbBBbBBBb323D7f7E51976b8A8DF2Bb4B4608d9B3' as const;
const W2_AUTH = 0xff46fcd2685aea76cbd1fc3788d4f942e67c3b9759a605d2d087570be44106e5n;
const w2ctx = { factory: W2_FACTORY, chainId: 143, auth: W2_AUTH };

describe('version dispatch', () => {
  test('wire 2 push verifies under v5..9, wire 3 push under v10', () => {
    for (const v of [5, 9]) {
      const r = verifyPushP8At(v, W2, w2ctx);
      expect(r.wire).toBe(2);
      expect(r.segments.map((s) => s.ok)).toEqual([true]);
    }
    const r3 = verifyPushP8At(10, G.calldataHex, ctx);
    expect(r3.wire).toBe(3);
    expect(r3.segments.map((s) => s.ok)).toEqual([true, true]);
  });

  test('a mismatched wire or storage version is refused', () => {
    // wire 3 bytes read as wire 2 and the reverse: never ok (digest domain version differs).
    const asV2 = (() => {
      try {
        return verifyPushP8At(5, G.calldataHex, { ...ctx, auth: W2_AUTH }).segments.some(
          (s) => s.ok,
        );
      } catch {
        return false;
      }
    })();
    expect(asV2).toBe(false);
    const asV3 = (() => {
      try {
        return verifyPushP8At(10, W2, { ...w2ctx, signers }).segments.some((s) => s.ok);
      } catch {
        return false;
      }
    })();
    expect(asV3).toBe(false);
    // wire 3 without the stored signers, and versions with no P8 store, throw
    expect(() => verifyPushP8At(10, G.calldataHex, { ...ctx, signers: undefined })).toThrow();
    for (const v of [4, 11]) expect(() => verifyPushP8At(v, W2, w2ctx)).toThrow();
  });
});
