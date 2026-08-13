/**
 * Storage-layout freshness: `src/pool/storage.ts` vs the compiled `storageLayout` of dex/evm.
 *
 * Why this file exists: `test/abi-freshness.test.ts` compares the full ABI, but an ABI carries no
 * packing information at all — slot numbers and in-struct byte offsets are invisible to it. The
 * only other harness that read real chain state (`test/quote-parity.test.ts`) is network-gated, so
 * a storage repack (mappings renumbered 3..13 → 4..11, `RiskConfig` collapsed from 7 fields to 4)
 * shipped with every reader silently returning garbage and a green suite.
 *
 * `forge` already emits the authoritative answer: `out/<C>.sol/<C>.json` `storageLayout` gives the
 * slot + offset of every field of every struct it reaches. So this asserts, field by field and
 * with no network, that both SDK tables equal solc's own numbers, and that solc has no field the
 * SDK is missing (a NEW packed member is drift too, even when nothing moved).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POOL_STORAGE, POOL_STRUCTS } from '../src/pool/storage';

const DEX_EVM = resolve(import.meta.dir, '../../dex/evm');
const ARTIFACT = resolve(DEX_EVM, 'out/Pool.sol/Pool.json');

interface Member {
  label: string;
  slot: string;
  offset: number;
  type: string;
}
interface Layout {
  storage: Member[];
  types: Record<string, { label: string; members?: Member[] }>;
}

/** solc's own layout for each struct the SDK decodes, keyed by the struct's short name. */
function solcStructs(): Record<string, Record<string, [number, number]>> {
  const { storageLayout } = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
    storageLayout: Layout;
  };
  const out: Record<string, Record<string, [number, number]>> = {};
  for (const t of Object.values(storageLayout.types)) {
    if (!t.members) continue;
    // `struct IPool.PoolStorage` / `struct NUQuartic.Curve` → `PoolStorage` / `Curve`.
    const short = t.label
      .replace(/^struct\s+/, '')
      .split('.')
      .pop();
    if (!short) continue;
    out[short] = Object.fromEntries(
      t.members.map((m) => [m.label, [Number(m.slot), m.offset] as [number, number]]),
    );
  }
  return out;
}

/** Members of `PoolStorage` the SDK deliberately does not decode field-by-field: the mappings,
 *  which `POOL_STORAGE` pins by slot instead (a mapping has no in-struct byte offset to check). */
const MAPPINGS = [
  'assets',
  'oracleConfigs',
  'curves',
  'protocolFees',
  'assetHooks',
  'invested',
  'lpTokens',
] as const;

describe('PoolStorage layout vs dex/evm compiled storageLayout', () => {
  // Same contract as abi-freshness: `forge build` output is gitignored and dex is a separate repo,
  // so an sdk-only checkout has nothing to compare against. CI checks the sibling out and sets
  // SDK_REQUIRE_ARTIFACTS=1, which turns the skip into a failure — a suite that quietly drops its
  // only layout detector is exactly how this drift shipped.
  const absent = !existsSync(ARTIFACT);
  if (absent && process.env.SDK_REQUIRE_ARTIFACTS === '1') {
    test('dex/evm artifacts present', () => {
      throw new Error(`${ARTIFACT} missing — run (cd ../dex/evm && forge build)`);
    });
  } else if (absent) {
    test.skip('SKIPPED: dex/evm/out absent — run (cd ../dex/evm && forge build)', () => {});
  } else {
    const solc = solcStructs();

    test('every mapping slot in POOL_STORAGE matches solc', () => {
      const ps = solc.PoolStorage;
      expect(ps).toBeDefined();
      for (const name of MAPPINGS) {
        expect({ [name]: POOL_STORAGE[name] }).toEqual({ [name]: BigInt(ps![name]![0]) });
      }
    });

    test('slot-0 scalars carry the slot solc gave them', () => {
      const ps = solc.PoolStorage!;
      for (const [name, [slot]] of Object.entries(POOL_STRUCTS.PoolStorage)) {
        expect({ [name]: POOL_STORAGE[name as keyof typeof POOL_STORAGE] }).toEqual({
          [name]: BigInt(slot),
        });
        expect({ [name]: [slot] }).toEqual({ [name]: [Number(ps[name]![0])] });
      }
    });

    for (const [struct, fields] of Object.entries(POOL_STRUCTS)) {
      test(`${struct} field offsets match solc`, () => {
        const want = solc[struct];
        expect(want).toBeDefined();
        for (const [name, pos] of Object.entries(fields)) {
          expect({ [`${struct}.${name}`]: [...pos] }).toEqual({
            [`${struct}.${name}`]: want![name] as never,
          });
        }
      });

      test(`${struct} has no member the SDK is unaware of`, () => {
        const known = new Set([
          ...Object.keys(fields),
          ...(struct === 'PoolStorage' ? MAPPINGS : []),
        ]);
        expect(Object.keys(solc[struct] ?? {}).filter((k) => !known.has(k))).toEqual([]);
      });
    }
  }
});
