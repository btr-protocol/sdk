/**
 * Cross-check solc's two independent descriptions of the same structs.
 *
 * `src/pool/layout.generated.ts` is generated FROM `storageLayout`, so asserting it back against
 * `storageLayout` proves nothing — `bun run gen:check` is what pins the generated file to the
 * artifacts, and `src/pool/storage.test.ts` is the hand-written offline pin.
 *
 * What is still worth asserting is that the ABI and the storage layout agree. They are produced by
 * different parts of solc and consumed by different halves of the SDK: `getAsset` decodes by ABI
 * component, `readRiskConfig` reads the same fields by slot and byte offset. A struct edit that
 * lands in one view and not the other would let those two halves disagree about what a field is
 * called or where it sits, which no single-view test can see.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTRACTS, EVM_ROOTS, artifact, resolveAbi } from '../scripts/manifest.js';
import { POOL_MAPPINGS, POOL_STRUCTS } from '../src/pool/layout.generated.js';

const ARTIFACT = resolve(EVM_ROOTS.dex, 'out/Pool.sol/Pool.json');

describe('Pool ABI vs compiled storageLayout', () => {
  const absent = !existsSync(ARTIFACT);
  if (absent && process.env.SDK_REQUIRE_ARTIFACTS === '1') {
    test('dex-evm artifacts present', () => {
      throw new Error(`${ARTIFACT} missing — run (cd ../dex-evm && forge build)`);
    });
    return;
  }
  if (absent) {
    test.skip('SKIPPED: dex-evm/out absent — run (cd ../dex-evm && forge build)', () => {});
    return;
  }

  /** Field names of each `IPool` struct as the ABI declares them. */
  const abiStructs = (() => {
    const out: Record<string, string[]> = {};
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      const it = n.internalType;
      if (typeof it === 'string' && it.startsWith('struct ') && Array.isArray(n.components)) {
        const short = it
          .replace(/^struct\s+/, '')
          .split('.')
          .pop()!;
        out[short] ??= (n.components as Array<{ name: string }>).map((c) => c.name);
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(resolveAbi(CONTRACTS.find((c) => c.contract === 'Pool')!));
    return out;
  })();

  // PoolStorage is internal — it has no ABI surface, so only the mapping-free structs cross-check.
  for (const name of ['Asset', 'OracleConfig', 'HookSlot'] as const) {
    test(`${name}: ABI components and storage members are the same fields, in order`, () => {
      expect({ [name]: abiStructs[name] }).toEqual({
        [name]: Object.keys(POOL_STRUCTS[name]),
      });
    });
  }

  test('PoolStorage mappings are exactly the members with no packed offset', () => {
    const { storageLayout } = artifact('dex', 'Pool');
    const ps = Object.values(storageLayout!.types).find(
      (t) => t.label === 'struct IPool.PoolStorage',
    );
    expect(ps).toBeDefined();
    const mappings = ps!.members!.filter((m) => m.type.startsWith('t_mapping')).map((m) => m.label);
    expect([...POOL_MAPPINGS]).toEqual(mappings);
    // Every non-mapping member must be decoded; a new packed field is drift the SDK must see.
    const scalars = ps!.members!.filter((m) => !m.type.startsWith('t_mapping')).map((m) => m.label);
    expect(Object.keys(POOL_STRUCTS.PoolStorage)).toEqual(scalars);
  });
});
