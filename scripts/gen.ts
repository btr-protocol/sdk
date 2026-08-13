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
  EVM_ROOTS,
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
    // `USDC-USD` and other non-identifier keys must stay quoted or the emitted file will not parse.
    const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
    return `{\n${entries
      .map(([k, val]) => `${padInner}${key(k)}: ${toTs(val, indent + 1)}`)
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

// ── deployed venues ──────────────────────────────────────────────────────────────────────────
/**
 * Per-chain venue facts, read from `dex/evm/deployments/` — the record of what was actually
 * broadcast, not a re-derivation of what a script should have produced.
 *
 * A chain appears here only when it has BOTH a `<chainId>.deploy.json` (tokens + `feed_<SYM>`)
 * and a `<chainId>.pools.json` (contracts + pool addresses). A predicted or dry-run record has
 * neither filename, so a chain that has not really been deployed is ABSENT rather than present
 * with plausible-looking addresses — which is what lets `registry.ts` refuse to resolve it
 * instead of quoting a bot against a chain it is not running on.
 *
 * The consequence is deliberate: the day the Arc ceremony writes `5042002.{deploy,pools}.json`,
 * `bun run gen` picks the chain up with no code edit anywhere in the SDK or the bots.
 */
interface RawVenue {
  chainId: number;
  contracts: Record<string, string>;
  tokens: Record<string, string>;
  feedIds: Record<string, string>;
  pools: Array<{ tag: string; address: string; symbols: string[] }>;
  refFeeds: string[];
}

const DEPLOYMENTS_DIR = resolve(EVM_ROOTS.dex, 'deployments');

/** Contract addresses consumers resolve by name. Pool addresses come through `pools` instead. */
const VENUE_CONTRACTS = [
  'ac',
  'admin',
  'distributor',
  'faucet',
  'flash',
  'govToken',
  'opsTreasuryProxy',
  'oracle',
  'poolFactory',
  'poolImpl',
  'refOracle',
  'staking',
  'treasuryProxy',
] as const;

/** `<class>Pool` key in both the pools record and the risk params ⇒ the router tag it carries. */
const POOL_CLASSES = [
  ['stablePool', 'btr-stable'],
  ['volatilePool', 'btr-volatile'],
  ['fxPool', 'btr-fx'],
] as const;

const isAddress = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v);

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** chainId ⇒ its `<name>-risk-params.json`, which is what names each pool's symbol roster. */
function riskParamsByChain(): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>();
  for (const name of ['sepolia', 'arc']) {
    const rp = readJson(resolve(DEPLOYMENTS_DIR, `${name}-risk-params.json`));
    if (rp && typeof rp.chainId === 'number') out.set(rp.chainId, rp);
  }
  return out;
}

function venues(): RawVenue[] {
  const risks = riskParamsByChain();
  const out: RawVenue[] = [];
  for (const [chainId, risk] of risks) {
    const deploy = readJson(resolve(DEPLOYMENTS_DIR, `${chainId}.deploy.json`));
    const pools = readJson(resolve(DEPLOYMENTS_DIR, `${chainId}.pools.json`));
    // Both halves or nothing: the token/feed record without the pool record describes an oracle
    // with no venue to quote, and either one alone cannot route a swap.
    if (!deploy || !pools) continue;
    for (const [what, rec] of [['deploy', deploy], ['pools', pools]] as const) {
      if (Number(rec.chainId) !== chainId) {
        throw new Error(`${chainId}.${what}.json declares chainId ${String(rec.chainId)}`);
      }
    }

    const symbols = (risk.symbols as string[] | undefined) ?? [];
    const tokens: Record<string, string> = {};
    const feedIds: Record<string, string> = {};
    for (const sym of symbols) {
      const tok = deploy[sym];
      if (!isAddress(tok)) throw new Error(`${chainId}.deploy.json has no token for ${sym}`);
      tokens[sym] = tok;
      const feed = deploy[`feed_${sym}`];
      // The base quotes off the signed USDC/USD reference, not a USDC/USDC identity feed.
      const name = sym === symbols[0] ? `${sym}-USD` : `${sym}-${symbols[0]}`;
      const id = sym === symbols[0] ? deploy[`feed_${sym}-USD`] : feed;
      if (typeof id !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(id)) {
        throw new Error(`${chainId}.deploy.json has no feed id for ${name}`);
      }
      feedIds[name] = id;
    }

    const contracts: Record<string, string> = {};
    for (const key of VENUE_CONTRACTS) {
      const a = pools[key] ?? deploy[key];
      if (isAddress(a)) contracts[key] = a;
    }

    const venuePools: RawVenue['pools'] = [];
    for (const [key, tag] of POOL_CLASSES) {
      const addr = pools[key];
      const roster = (risk[key] as string[] | undefined) ?? [];
      // A pool class that is scripted but not yet broadcast serialises as zero or is absent.
      // Emitting it would hand the router an address that reverts every quote.
      if (!isAddress(addr) || roster.length === 0) continue;
      const missing = roster.filter((s) => !tokens[s]);
      if (missing.length) throw new Error(`${chainId} ${tag} lists untokened ${missing.join(',')}`);
      venuePools.push({ tag, address: addr, symbols: roster });
    }
    if (venuePools.length === 0) throw new Error(`${chainId}.pools.json carries no deployed pool`);

    out.push({
      chainId,
      contracts,
      tokens,
      feedIds,
      pools: venuePools,
      refFeeds: (pools.refFeeds as string[] | undefined) ?? [],
    });
  }
  return out.sort((a, b) => a.chainId - b.chainId);
}

function venuesFile(): string {
  const found = venues();
  const entries = found
    .map((v) => `  ${v.chainId}: ${toTs({ ...v }, 1)},`)
    .join('\n');
  return `${banner('bun scripts/gen.ts')}
/**
 * Deployed BTR venues, keyed by chain id
 * @module @btr-protocol/sdk/venues
 *
 * Source: \`dex/evm/deployments/<chainId>.{deploy,pools}.json\` — the broadcast record — plus the
 * pool rosters in \`<chain>-risk-params.json\`. A chain with no broadcast record is ABSENT, and
 * \`registry.ts\` throws on an absent chain rather than falling back, so a bot pointed at a chain
 * BTR is not deployed on cannot silently quote another chain's addresses.
 *
 * Feed NAMES are keys here; the on-chain \`feedIds[]\` ORDINAL is deliberately not, because the
 * deployment record does not carry it (forge sorts the keys it serialises, and the ordering is
 * split across two scripts). The only authority on an ordinal is the chain itself — see
 * \`keepers/src/oracle/startup.rs\`, which reads \`feedIds(idx)\` and refuses to start on a mismatch.
 */

import type { Address, Hex } from '../eth/types.js';

export interface ChainVenue {
  chainId: number;
  /** Singletons by name — \`oracle\`, \`refOracle\`, \`poolFactory\`, \`faucet\`, … */
  contracts: Record<string, Address>;
  /** Pool asset ERC20s by canonical symbol. First symbol of each roster is the USDC base. */
  tokens: Record<string, Address>;
  /** On-chain feed name (\`USDT-USDC\`, \`USDC-USD\`) ⇒ its \`feedId\`. */
  feedIds: Record<string, Hex>;
  /** Deployed cores with the symbols each one lists. */
  pools: Array<{ tag: string; address: Address; symbols: string[] }>;
  /** Feed names mirrored onto the reference oracle. */
  refFeeds: string[];
}

export const DEPLOYED_VENUES: Record<number, ChainVenue> = {
${entries}
};
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
files.set(resolve(SRC, 'venues', 'deployments.generated.ts'), venuesFile());

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
