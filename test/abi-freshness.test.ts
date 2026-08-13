/**
 * ABI freshness: every generated ABI vs the sibling forge artifacts.
 *
 * The generator (`scripts/gen.ts`) and this guard read the SAME table (`scripts/manifest.ts`), so a
 * contract cannot be generated-but-unchecked. Comparison is structural: parameter `name` and
 * `internalType` are stripped, since neither affects on-wire encoding. Anything else — added,
 * removed or renamed function/event/error, changed type, changed mutability — fails.
 *
 * `bun run gen:check` is the stricter sibling: it compares generated files byte-for-byte, so it
 * also catches cosmetic drift and a stale barrel. This test survives when only the ABI moved.
 */

import { describe, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import * as ABIS from '../src/abis/index.js';
import { CONTRACTS, EVM_ROOTS, resolveAbi } from '../scripts/manifest.js';

type AbiItem = Record<string, unknown> & {
  type: string;
  inputs?: AbiItem[];
  outputs?: AbiItem[];
  components?: AbiItem[];
};

/** Drop `name`/`internalType` from parameters so the compare ignores cosmetics. Top-level entries
 *  keep their own `name` — that is function/event identity. */
function normalize(abi: readonly unknown[]): AbiItem[] {
  const stripParams = (items?: AbiItem[]): AbiItem[] | undefined =>
    items?.map((it) => {
      const { name: _n, internalType: _it, components, ...rest } = it;
      const out = { ...rest } as AbiItem;
      if (components) out.components = stripParams(components as AbiItem[]);
      return out;
    });
  return (abi as AbiItem[]).map((entry) => {
    const { internalType: _it, ...rest } = entry;
    const out: AbiItem = { ...rest };
    if (entry.inputs) out.inputs = stripParams(entry.inputs);
    if (entry.outputs) out.outputs = stripParams(entry.outputs);
    return out;
  });
}

/** Stable canonical JSON (sorted keys at every depth) for a byte-equal compare. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

describe('ABI freshness vs dex/evm + shared/evm sources', () => {
  // `forge build` output is gitignored and the siblings are separate repos, so an sdk-only checkout
  // has nothing to compare against. Each case then SKIPS WITH A REASON rather than vanishing — a
  // suite that quietly drops its only drift detector reports green on stale ABIs. CI checks the
  // siblings out and sets SDK_REQUIRE_ARTIFACTS=1, which turns the skip into a failure.
  const missingRoots = (Object.keys(EVM_ROOTS) as Array<keyof typeof EVM_ROOTS>).filter(
    (r) => !existsSync(resolve(EVM_ROOTS[r], 'out')),
  );
  const why = `${missingRoots.join(' + ')}/evm/out absent — run (cd ../<repo>/evm && forge build)`;
  if (missingRoots.length && process.env.SDK_REQUIRE_ARTIFACTS === '1') {
    test('sibling forge artifacts present', () => {
      throw new Error(why);
    });
  }

  for (const spec of CONTRACTS) {
    const label = `${spec.contract} ABI matches ${spec.root ?? 'dex'}/evm compiled artifact`;
    if (missingRoots.length) {
      test.skip(`${label} — SKIPPED: ${why}`, () => {});
      continue;
    }
    test(label, () => {
      const ts = (ABIS as Record<string, readonly unknown[]>)[spec.constName];
      if (!ts) throw new Error(`${spec.constName} is not exported from src/abis — run bun run gen`);
      const onChain = resolveAbi(spec);
      if (canonical(normalize(onChain)) === canonical(normalize(ts))) return;
      const sig = (abi: AbiItem[]) =>
        abi
          .filter((e) => ['function', 'event', 'error'].includes(e.type))
          .map((e) => `${e.type} ${e.name as string}`)
          .sort();
      const onSet = new Set(sig(normalize(onChain)));
      const tsSet = new Set(sig(normalize(ts)));
      const missing = [...onSet].filter((s) => !tsSet.has(s));
      const extra = [...tsSet].filter((s) => !onSet.has(s));
      const hint =
        missing.length || extra.length
          ? `\nmissing in TS: ${missing.join(', ') || '(none)'}\nextra in TS:   ${extra.join(', ') || '(none)'}`
          : '\n(structural drift in input/output types or mutability)';
      throw new Error(`${spec.contract} ABI drift detected.${hint}`);
    });
  }
});
