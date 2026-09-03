/** Build-time ABIs: the backend getAbi service is the SSoT, this repo commits no copies.
 *
 *   bun run fetch-abis                       # GET {api}/v1/abis/{Pool,Admin,ExternalOracle}
 *   BTR_API_URL=http://localhost:3000 bun run fetch-abis
 *
 * Backend-first, sibling fallback: an unreachable backend falls back to the sibling checkouts
 * (`../back/abis`, then the forge artifacts under `../dex-evm/out`), which serve the same bytes
 * the backend bakes. A fresh clone with no backend and no siblings is a hard error, never an
 * empty ABI; a failed refresh that already has artifacts keeps them and exits 0 so a backend
 * blink never breaks a local `bun test`.
 *
 * Runs before every typecheck/test/build (package.json) and on postinstall, so consumers that
 * clone this repo (front via SDK_REF) compile with zero extra steps. Ends with
 * `biome format --write` so the output stays `biome check`-clean under regeneration. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = (process.env.BTR_API_URL ?? 'https://api.btr.markets').replace(/\/$/, '');

const TARGETS = [
  {
    name: 'Pool',
    symbol: 'POOL_ABI',
    file: 'src/abis/Pool.ts',
    doc: 'Flat pool surface (swap/deposit/withdraw/view + pool-scoped admin entrypoints); library events and errors merged in.',
  },
  {
    name: 'Admin',
    symbol: 'ADMIN_ABI',
    file: 'src/abis/Admin.ts',
    doc: 'Singleton admin entrypoints (ERC-1967 proxy); governance ops via requestOp/execute.',
  },
  {
    name: 'ExternalOracle',
    symbol: 'EXTERNAL_ORACLE_ABI',
    file: 'src/abis/ExternalOracle.ts',
    doc: 'Signed external oracle push surface; the deployed read fleet is ExternalOracleV4.',
  },
] as const;

/** Backend serves the lean array; forge artifacts wrap it under `abi`. Both accepted. */
function unwrap(v: unknown): unknown[] {
  const abi = Array.isArray(v) ? v : (v as { abi?: unknown }).abi;
  if (!Array.isArray(abi)) throw new Error('bad artifact: no abi array');
  return abi;
}

async function fromBackend(name: string): Promise<unknown[]> {
  const res = await fetch(`${api}/v1/abis/${name}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`BTR API ${res.status} /v1/abis/${name}`);
  return unwrap(await res.json());
}

function fromSiblings(name: string): unknown[] | null {
  const paths = [
    join(root, '..', 'back', 'abis', `${name}.json`),
    join(root, '..', 'dex-evm', 'out', `${name}.sol`, `${name}.json`),
  ];
  for (const p of paths) {
    if (existsSync(p)) return unwrap(JSON.parse(readFileSync(p, 'utf8')));
  }
  return null;
}

for (const t of TARGETS) {
  const out = join(root, t.file);
  let abi: unknown[] | null = null;
  try {
    abi = await fromBackend(t.name);
  } catch (e) {
    abi = fromSiblings(t.name);
    if (!abi) {
      if (existsSync(out)) {
        console.log(
          `fetch-abis: ${t.name} unreachable (${(e as Error).message}), keeping existing`,
        );
        continue;
      }
      throw new Error(`fetch-abis: no ${t.name} ABI (backend + siblings unreachable)`);
    }
    console.log(`fetch-abis: ${t.name} from sibling checkout (backend unreachable)`);
  }
  writeFileSync(
    out,
    `// GENERATED — do not edit, do not commit. Rebuild with \`bun run fetch-abis\`.\n// Backend getAbi SSoT (GET {api}/v1/abis/${t.name}). ${t.doc}\nimport type { Abi } from '../eth/abi.js';\n\nexport const ${t.symbol}: Abi = ${JSON.stringify(abi, null, 2)};\n`,
  );
}

await $`bunx biome format --write ${TARGETS.map((t) => t.file)}`.cwd(root).quiet();
console.log('fetch-abis: Pool + Admin + ExternalOracle up to date');
