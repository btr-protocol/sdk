/**
 * Generate every artifact-derived file in the SDK from the sibling forge builds.
 *
 * Writes `src/abis/*.ts` (+ its barrel + the enum and struct-field tables) and
 * `src/pool/layout.generated.ts`. Nothing it writes may
 * be hand-edited: it is overwritten wholesale, and `--check` fails when the working tree differs
 * from what the current artifacts produce. Wire `--check` into CI/build so a contract change that
 * skips regeneration breaks the build instead of shipping a stale wire format.
 *
 *   bun scripts/gen.ts            # write
 *   bun scripts/gen.ts --check    # verify only, non-zero exit on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  artifact,
  CONTRACTS,
  CONSTANTS,
  ENUMS,
  constantValues,
  enumMembers,
  poolScopedOps,
  resolveAbi,
} from './manifest.js';

const SRC = resolve(import.meta.dir, '../src');
const CHECK = process.argv.includes('--check');

/** Pretty-print JSON as a TS object literal (single-quoted strings, unquoted keys). */
function toTs(v: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    // Primitive-only arrays (slot/offset pairs, name lists) read better on one line.
    if (v.every((e) => e === null || typeof e !== 'object')) {
      return `[${v.map((e) => toTs(e, indent)).join(', ')}]`;
    }
    return `[\n${v.map((e) => `${padInner}${toTs(e, indent + 1)}`).join(',\n')},\n${pad}]`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, val]) => `${padInner}${k}: ${toTs(val, indent + 1)}`)
      .join(',\n')},\n${pad}}`;
  }
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(v);
}

// ── storage layout ───────────────────────────────────────────────────────────────────────────
type Member = { label: string; slot: string; offset: number; type: string };

/** Structs whose packed field positions the SDK decodes by hand (see src/pool/storage.ts). */
const DECODED_STRUCTS = ['PoolStorage', 'Asset', 'OracleConfig', 'HookSlot'] as const;

function layoutFile(): string {
  const { storageLayout } = artifact('dex', 'Pool');
  if (!storageLayout) throw new Error('Pool artifact carries no storageLayout');
  const byShort: Record<string, Member[]> = {};
  for (const t of Object.values(storageLayout.types)) {
    if (!t.members) continue;
    const short = t.label.replace(/^struct\s+/, '').split('.').pop();
    if (short) byShort[short] = t.members;
  }
  const ps = byShort.PoolStorage;
  if (!ps) throw new Error('PoolStorage absent from storageLayout');

  const isMapping = (m: Member) => m.type.startsWith('t_mapping');
  const poolStorage = Object.fromEntries(ps.map((m) => [m.label, `${m.slot}n`]));
  const structs: Record<string, Record<string, [number, number]>> = {};
  for (const name of DECODED_STRUCTS) {
    const members = byShort[name];
    if (!members) throw new Error(`${name} absent from storageLayout`);
    structs[name] = Object.fromEntries(
      members
        .filter((m) => name !== 'PoolStorage' || !isMapping(m))
        .map((m) => [m.label, [Number(m.slot), m.offset]]),
    );
  }
  const mappings = ps.filter(isMapping).map((m) => m.label);

  return `${banner('bun scripts/gen.ts')}
/** Absolute slots of every \`IPool.PoolStorage\` field, mappings included. */
export const POOL_STORAGE = ${toTs(poolStorage).replace(/'(\d+n)'/g, '$1')} as const;

/** \`PoolStorage\` members that are mappings — pinned by slot only; a mapping has no byte offset. */
export const POOL_MAPPINGS = ${toTs(mappings)} as const;

/**
 * In-struct field position as \`[slot, byteOffset]\`, LSB-aligned exactly as solc packs it.
 * \`slot\` is relative to the struct's own base (the mapping-entry base for a mapping value).
 */
export const POOL_STRUCTS = ${toTs(structs)} as const satisfies Record<
  string,
  Record<string, readonly [number, number]>
>;
`;
}

/**
 * Field-name unions for every struct the SDK mirrors as a hand-written, documented interface.
 *
 * The interfaces stay hand-written because their doc comments carry meaning solc has no room for;
 * these unions are what makes them safe. Each mirror asserts its keys against one, so a Solidity
 * field rename is a typecheck failure naming the field instead of a silently `undefined` read —
 * which is exactly how `Asset.vega`→`vegaBps` and `FeedData.sigma`→`sigmaPbps` both slipped
 * through, the second one all the way into a deployed indexer that reported every feed stale.
 */
function structFieldsFile(): string {
  const found = new Map<string, string[]>();
  const owner = new Map<string, string>();
  const walk = (node: unknown, from: string): void => {
    if (Array.isArray(node)) return void node.forEach((e) => walk(e, from));
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const it = n.internalType;
    if (typeof it === 'string' && it.startsWith('struct ') && Array.isArray(n.components)) {
      const short = it.replace(/^struct\s+/, '').split('.').pop()!;
      const fields = (n.components as Array<{ name: string }>).map((c) => c.name);
      const prev = found.get(short);
      // Two ABIs declaring one struct name with different members would make the union depend on
      // iteration order, i.e. on nothing. Fail rather than pick.
      if (prev && prev.join() !== fields.join()) {
        throw new Error(
          `struct ${short} differs between ${owner.get(short)} and ${from}: [${prev}] vs [${fields}]`,
        );
      }
      if (!prev) {
        found.set(short, fields);
        owner.set(short, from);
      }
    }
    for (const v of Object.values(n)) walk(v, from);
  };
  for (const spec of CONTRACTS) walk(resolveAbi(spec), spec.contract);
  const body = [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, fields]) =>
        `export type ${name}Fields =\n${fields.map((f) => `  | '${f}'`).join('\n')};`,
    )
    .join('\n\n');
  return `${banner('bun scripts/gen.ts')}
/** Exact field names of each ABI struct, as the ABI declares them. */
${body}

/**
 * Compile-time equality of an interface's keys with a generated field union. Resolves to \`true\`
 * only on an exact match; otherwise to an object naming the offending keys, so \`Assert\` fails the
 * typecheck with a message that says which field drifted. It must NOT resolve to \`never\` on
 * mismatch: \`never\` satisfies every constraint, so the assertion would be silently inert.
 */
export type FieldsMatch<T, K extends string> = [Exclude<keyof T, K>] extends [never]
  ? [Exclude<K, keyof T>] extends [never]
    ? true
    : { missingFromInterface: Exclude<K, keyof T> }
  : { notInAbi: Exclude<keyof T, K> };

/** Forces the check: only \`true\` satisfies the constraint. */
export type Assert<T extends true> = T;
`;
}

// ── what solc erases ─────────────────────────────────────────────────────────────────────────
/**
 * Enum ordinals and `internal`/`private constant` values, read from the declaring `.sol` source.
 *
 * These cannot come from `out/`: the ABI records `internalType: 'enum X.Y'` and nothing at all
 * for a constant, so an artifact-only generator has no value to check and a hand-copied table is
 * unfalsifiable. Source is therefore the input, and `--check` is what makes it stay true.
 */
function solidityFile(): string {
  const blocks = ENUMS.map((spec) => {
    const members = enumMembers(spec);
    const entries = members.map((m, i) => `  ${m}: ${i},`).join('\n');
    return `/** ${spec.blurb}
 *  Source: ${spec.root}/evm/${spec.path} */
export const ${spec.name} = {
${entries}
} as const;
export type ${spec.name} = (typeof ${spec.name})[keyof typeof ${spec.name}];`;
  }).join('\n\n');

  const consts = CONSTANTS.map((spec) => {
    const body = constantValues(spec)
      .map(([n, v]) => `export const ${n} = ${v};`)
      .join('\n');
    return `// ${spec.root}/evm/${spec.path}\n${body}`;
  }).join('\n\n');

  return `${banner('bun scripts/gen.ts')}
/**
 * Solidity enum ordinals and internal constants
 * @module @btr-protocol/sdk/abis
 *
 * solc keeps neither in the ABI, so both are parsed out of the declaring \`.sol\` file. Never
 * hand-write an ordinal: \`OpType\` is grouped by timelock tier and \`Resource\` by meaning, so both
 * renumber whenever a member joins a group.
 */

${blocks}

${consts}

/**
 * Ops whose timelock key ignores \`subject\` (\`Admin._keyOf\` returns \`_key(pool, opId)\`). Every
 * other op keys on \`(pool, opId, subject)\`, so cancelling one with \`subject = 0\` computes a key
 * nothing was queued under and reverts \`NoPending\` instead of vetoing.
 */
export const POOL_SCOPED_OPS: readonly OpType[] = [
${poolScopedOps()
  .map((o) => `  OpType.${o},`)
  .join('\n')}
];
`;
}

// ── emit ─────────────────────────────────────────────────────────────────────────────────────
function banner(cmd: string): string {
  return `// Generated by \`${cmd}\` from the sibling dex/shared checkouts. Do not edit by hand —
// \`bun run gen:check\` fails the build when this file and the contracts disagree.
`;
}

/** Run generated source through biome so the output is formatted exactly as a hand-written file
 *  would be — otherwise `bun run lint` flags every file this script writes. */
function formatted(path: string, src: string): string {
  const r = Bun.spawnSync(['bunx', 'biome', 'format', `--stdin-file-path=${path}`], {
    stdin: Buffer.from(src),
  });
  if (r.exitCode !== 0) throw new Error(`biome format failed for ${path}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

const files = new Map<string, string>();

for (const spec of CONTRACTS) {
  const abi = resolveAbi(spec);
  files.set(
    resolve(SRC, 'abis', spec.file),
    `${banner('bun scripts/gen.ts')}/**
 * ${spec.contract}
 * @module @btr-protocol/sdk/abis
 *
 * ${spec.blurb}
 * Source: ${spec.root ?? 'dex'}/evm out/${spec.contract}.sol/${spec.contract}.json
 */

export const ${spec.constName} = ${toTs(abi)};
`,
  );
}

files.set(
  resolve(SRC, 'abis', 'index.ts'),
  `${banner('bun scripts/gen.ts')}/**
 * Contract ABIs
 * @module @btr-protocol/sdk/abis
 *
 * The deployed DEX surface. Library events and errors are merged into POOL_ABI so revert data and
 * logs decode against one ABI; see scripts/manifest.ts for which artifact backs which export.
 */

${[
  ...CONTRACTS.map((c) => `export * from './${c.file.replace(/\.ts$/, '.js')}';`),
  `export * from './solidity.generated.js';`,
  `export * from './structs.generated.js';`,
].sort().join('\n')}
`,
);

files.set(resolve(SRC, 'abis', 'solidity.generated.ts'), solidityFile());
files.set(resolve(SRC, 'abis', 'structs.generated.ts'), structFieldsFile());
files.set(resolve(SRC, 'pool', 'layout.generated.ts'), layoutFile());

let drift = 0;
for (const [path, raw] of files) {
  const want = formatted(path, raw);
  const have = (() => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  })();
  if (have === want) continue;
  drift++;
  if (CHECK) console.error(`drift: ${path.replace(`${SRC}/`, 'src/')}`);
  else {
    writeFileSync(path, want);
    console.log(`wrote ${path.replace(`${SRC}/`, 'src/')}`);
  }
}

if (CHECK && drift) {
  console.error(`\n${drift} generated file(s) stale — run \`bun run gen\` and commit the result.`);
  process.exit(1);
}
if (CHECK) console.log(`generated files match the artifacts (${files.size} checked)`);
