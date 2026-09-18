/** Regenerate `src/abis/solidity.generated.ts` from `dex-evm/abi/constants.json`.
 *
 *   bun run fetch-abis                         # sibling ../dex-evm when present
 *   BTR_DEX_EVM=../dex-evm bun scripts/gen-constants.ts
 *
 * solc keeps neither enum ordinals nor `internal constant` values in an ABI, so this surface
 * cannot ride the getAbi path `fetch-abis.ts` uses. It was hand-maintained instead, and the file
 * said `.generated` while carrying a "MAINTAINED BY HAND" header — eight copies of one flag bit
 * across five repos, found drifting once per audit. dex-evm now publishes them from its own
 * sources (`tools/consts.py`, covered by `tools/abi-gen.py --check`); this reads that file.
 *
 * The OUTPUT IS COMMITTED, unlike `Pool.ts`: a fresh clone (front's Docker build via `SDK_REF`)
 * has no `dex-evm` sibling, and a build that silently emitted no constants would typecheck and
 * ship zeros. Absent the sibling this is a no-op that says so; `test/solidity-mirror.test.ts`
 * is what fails when the committed file has drifted from a checkout that IS present. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dexEvm = process.env.BTR_DEX_EVM ?? join(root, '..', 'dex-evm');
const source = join(dexEvm, 'abi', 'constants.json');
const out = join(root, 'src', 'abis', 'solidity.generated.ts');
const v5Source = join(dexEvm, 'abi', 'ExternalOracleV5.json');
const v5Out = join(root, 'src', 'abis', 'ExternalOracleV5.ts');

if (!existsSync(source)) {
  console.log(`gen-constants: ${source} absent — keeping the committed mirror`);
  process.exit(0);
}

// The V5 feed ADMIN surface, beside the vendored V4 read surface. Generations are not
// interchangeable here: V4 spells the freeze `pauseFeed`/`FeedPaused` and V5 spells it
// `haltFeed`/`FeedHalted`, and `updateFeed` gained `sigmaFloorPbps`. A caller drives the
// generation its deployment record names — Arc is V4, BNB is V5 — so both ship.
if (existsSync(v5Source)) {
  const abi = readFileSync(v5Source, 'utf8').trimEnd();
  writeFileSync(
    v5Out,
    `// GENERATED from dex-evm/abi/ExternalOracleV5.json by \`bun scripts/gen-constants.ts\`. Do not edit.\n` +
      `/**\n * ExternalOracleV5 - the deployed feed read + admin surface (beacon generation).\n *\n` +
      ` * V4 is the Arc fleet and lives in \`ExternalOracleV4.ts\`; pick by the deployment record's\n` +
      ` * oracle version, never by assuming one. Push paths are decoded from raw calldata\n` +
      ` * (\`oracle/wire.ts\`), never through this ABI.\n */\n` +
      `import type { Abi } from '../eth/abi.js';\n\nexport const EXTERNAL_ORACLE_V5_ABI: Abi = ${abi};\n`,
  );
  console.log('gen-constants: wrote src/abis/ExternalOracleV5.ts');
}

type Consts = {
  enums: Record<string, Record<string, number>>;
  delays: Record<string, Record<string, number>>;
  flags: Record<string, number>;
  pool: Record<string, number>;
  pricing: Record<string, number>;
};
const c: Consts = JSON.parse(readFileSync(source, 'utf8'));

/** Docs are per-enum and live HERE: `constants.json` carries values, not prose. */
const ENUM_DOC: Record<string, string> = {
  OpType:
    'Second arg of `Admin.requestOp` / `execute` / `cancelOp`. Grouped by timelock tier, so a member added to a group SHIFTS every ordinal after it.',
  BatchOp: 'Risk-op selector for `Admin.batchRiskOp`.',
  Resource:
    'Subsystem tag carried by `Err.NotFound` / `Err.FeatureDisabled` and friends. Ordered by MEANING, so ordinals move when a member joins its group.',
  Tier: 'Index into the packed `AccessControl.GOV_DELAYS()` word (3 x uint32 seconds). See `govDelays` in src/governance.',
  Role: 'Key of `AccessControl.pendingRole` and of `queueRole`/`executeRole`/`cancelRole`.',
};

const lines: string[] = [
  '// GENERATED from dex-evm/abi/constants.json by `bun scripts/gen-constants.ts`. Do not edit.',
  '',
  '/**',
  ' * Solidity enum ordinals and internal constants',
  ' * @module @btr-protocol/sdk/abis',
  ' *',
  ' * solc keeps neither in the ABI, so neither can be fetched the way `POOL_ABI` is. dex-evm',
  ' * publishes them from its own sources as `abi/constants.json`; this file is that JSON, typed.',
  ' * `test/solidity-mirror.test.ts` re-parses the declaring `.sol` and fails on any divergence.',
  ' */',
  '',
];

for (const [name, members] of Object.entries(c.enums)) {
  const doc = ENUM_DOC[name];
  if (!doc) throw new Error(`gen-constants: no doc for enum ${name} — add one`);
  lines.push(`/** ${doc} */`);
  lines.push(`export const ${name} = {`);
  for (const [k, v] of Object.entries(members).sort((a, b) => a[1] - b[1])) {
    lines.push(`  ${k}: ${v},`);
  }
  lines.push('} as const;');
  lines.push(`export type ${name} = (typeof ${name})[keyof typeof ${name}];`);
  lines.push('');
}

const group = (title: string, values: Record<string, number>): void => {
  lines.push(`// ${title}`);
  for (const [k, v] of Object.entries(values)) lines.push(`export const ${k} = ${v};`);
  lines.push('');
};
group('`Asset.flags` / `RiskConfig.flags` bits and masks (PoolConstantsLib).', c.flags);
group('Pool wire constants (PoolConstantsLib).', c.pool);
group('Staleness (PricingLib).', c.pricing);

lines.push('/** Packed `ConstantsLib` timelock schedules, seconds per `Tier`. */');
lines.push('export const GOV_DELAYS = {');
for (const [name, tiers] of Object.entries(c.delays)) {
  lines.push(`  ${name}: {`);
  for (const [t, v] of Object.entries(tiers)) lines.push(`    ${t}: ${v},`);
  lines.push('  },');
}
lines.push('} as const;');
lines.push('');
lines.push('/**');
lines.push(' * Ops whose timelock key ignores `subject` (`Admin._keyOf` returns `_key(pool, opId)`). Every');
lines.push(' * other op keys on `(pool, opId, subject)`, so cancelling one with `subject = 0` computes a key');
lines.push(' * nothing was queued under and reverts `NoPending` instead of vetoing.');
lines.push(' */');
lines.push('export const POOL_SCOPED_OPS: readonly OpType[] = [');
for (const op of ['MIGRATE_BASE_TOKEN', 'UPDATE_TREASURY', 'UPDATE_FEES', 'UPDATE_POOL_ADMIN']) {
  if (!(op in c.enums.OpType)) throw new Error(`gen-constants: OpType.${op} is gone`);
  lines.push(`  OpType.${op},`);
}
lines.push('];');

writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`gen-constants: wrote src/abis/solidity.generated.ts from ${source}`);

// Same posture `fetch-abis.ts` takes: the output is committed, so it has to satisfy `biome check`,
// but biome may be absent in a Docker build layer — warn, never throw.
try {
  await $`bunx biome format --write ${[out, v5Out].filter((f) => existsSync(f))}`.cwd(root).quiet();
} catch {
  console.log('gen-constants: biome format skipped (biome unavailable)');
}
