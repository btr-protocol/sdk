/** Build-time ABIs: the backend getAbi service is the SSoT, this repo commits no copies.
 *
 *   bun run fetch-abis                       # GET {api}/v1/abis/{Pool,Admin,ExternalOracle}
 *   BTR_API_URL=http://localhost:3000 bun run fetch-abis
 *
 * Source chain per target: backend → sibling checkouts (`../back/abis`, then forge artifacts
 * under `../dex-evm/out`, same bytes the backend bakes) → keep-existing (warns mtime age) →
 * vendored `abis.fallback.ts` (STALE hot-path minimum; keeps a fresh clone building, e.g. front
 * Docker via SDK_REF). Never an empty ABI: every source is integrity-pinned (required fns +
 * selector canary) before write, and a failed refresh that already has artifacts keeps them and
 * exits 0 so a backend blink never breaks a local `bun test`.
 *
 * Runs before every typecheck/test/build (package.json) and on postinstall, so consumers that
 * clone this repo (front via SDK_REF) compile with zero extra steps. Ends with a best-effort
 * `biome format --write` (warns, never throws: biome may be absent in a Docker build layer). */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { $ } from 'bun';
import { ABI_FALLBACKS } from './abis.fallback.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = (process.env.BTR_API_URL ?? 'https://api.btr.markets').replace(/\/$/, '');

const TARGETS = [
  {
    name: 'Pool',
    symbol: 'POOL_ABI',
    file: 'src/abis/Pool.ts',
    doc: 'Flat pool surface (swap/deposit/withdraw/view + pool-scoped admin entrypoints); library events and errors merged in.',
    fns: [
      'swap',
      'deposit',
      'withdraw',
      'withdrawTo',
      'swapLiability',
      'previewWithdraw',
      'getAsset',
      'getSwapQuote',
      'getCoverageRatio',
      'getLPBalance',
    ],
    pins: { 'swap(address,address,uint256,uint256,address,uint256)': '0x9908fc8b' },
  },
  {
    name: 'Admin',
    symbol: 'ADMIN_ABI',
    file: 'src/abis/Admin.ts',
    doc: 'Singleton admin entrypoints (ERC-1967 proxy); governance ops via requestOp/execute.',
    fns: ['requestOp', 'cancelTimelock', 'haltAsset', 'unhaltAsset'],
    pins: { 'requestOp(address,uint8,bytes32,bytes)': '0xf548551a' },
  },
  {
    name: 'ExternalOracle',
    symbol: 'EXTERNAL_ORACLE_ABI',
    file: 'src/abis/ExternalOracle.ts',
    doc: 'Signed external oracle push surface; the deployed read fleet is ExternalOracleV4.',
    fns: ['batchPushSigned', 'getFeed', 'isFeedFresh'],
    pins: { 'getFeed(bytes32)': '0x280aebcf' },
  },
] as const;

type Entry = { type?: unknown; name?: unknown; inputs?: { type: string }[] };

const sigOf = (e: Entry): string => `${e.name}(${(e.inputs ?? []).map((p) => p.type).join(',')})`;

const selectorOf = (sig: string): string =>
  `0x${Buffer.from(keccak_256(new TextEncoder().encode(sig)))
    .toString('hex')
    .slice(0, 8)}`;

/** Required fns present + selector canaries match; throws `integrity:` on mismatch. */
function checkAbi(target: (typeof TARGETS)[number], abi: unknown[]): void {
  const fns = abi.filter((e) => (e as Entry).type === 'function') as Entry[];
  for (const name of target.fns) {
    if (!fns.some((e) => e.name === name))
      throw new Error(`integrity: ${target.name} ABI missing function ${name}`);
  }
  for (const [sig, want] of Object.entries(target.pins)) {
    const e = fns.find((f) => sigOf(f) === sig);
    if (!e) throw new Error(`integrity: ${target.name} ABI missing pinned ${sig}`);
    const got = selectorOf(sig);
    if (got !== want) throw new Error(`integrity: ${target.name} ${sig} -> ${got}, want ${want}`);
  }
}

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

const ageDays = (out: string): string =>
  `, ${((Date.now() - statSync(out).mtimeMs) / 86_400_000).toFixed(1)}d old`;

function write(t: (typeof TARGETS)[number], abi: unknown[], note: string): void {
  checkAbi(t, abi);
  writeFileSync(
    join(root, t.file),
    `// GENERATED — do not edit, do not commit. Rebuild with \`bun run fetch-abis\`.\n// Backend getAbi SSoT (GET {api}/v1/abis/${t.name}). ${t.doc} [${note}]\nimport type { Abi } from '../eth/abi.js';\n\nexport const ${t.symbol}: Abi = ${JSON.stringify(abi, null, 2)};\n`,
  );
}

for (const t of TARGETS) {
  const out = join(root, t.file);
  let done = false;
  try {
    write(t, await fromBackend(t.name), 'backend');
    done = true;
  } catch (e) {
    const err = (e as Error).message;
    if (err.startsWith('integrity:')) throw e;
    try {
      const sib = fromSiblings(t.name);
      if (sib) {
        write(t, sib, 'sibling checkout');
        console.log(`fetch-abis: ${t.name} from sibling checkout (backend unreachable)`);
        done = true;
      }
    } catch (sibErr) {
      throw new Error(`integrity: sibling ${t.name} rejected (${(sibErr as Error).message})`);
    }
    if (!done && existsSync(out)) {
      console.log(`fetch-abis: ${t.name} unreachable (${err}), keeping existing${ageDays(out)}`);
      done = true;
    }
    if (!done) {
      const fb = ABI_FALLBACKS[t.name];
      if (!fb) throw new Error(`fetch-abis: no ${t.name} ABI (backend + siblings unreachable)`);
      write(t, fb, 'STALE vendored fallback');
      console.log(`fetch-abis: ${t.name} from STALE vendored fallback (backend unreachable)`);
      done = true;
    }
  }
}

try {
  await $`bunx biome format --write ${TARGETS.map((t) => t.file)}`.cwd(root).quiet();
} catch {
  console.log('fetch-abis: biome format skipped (biome unavailable)');
}
console.log('fetch-abis: Pool + Admin + ExternalOracle up to date');
