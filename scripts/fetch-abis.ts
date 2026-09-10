/** Build-time ABIs: the backend getAbi service is the SSoT, this repo commits no copies.
 *
 *   bun run fetch-abis                       # GET {api}/v1/abis/{Pool,Admin}
 *   BTR_API_URL=http://localhost:3000 bun run fetch-abis
 *
 * Source chain per target: backend → the sibling `../back/abis` checkout (the bytes the backend
 * bakes) → keep-existing → vendored `abis.fallback.ts` (STALE hot-path minimum; keeps a fresh
 * clone building, e.g. front Docker via SDK_REF).
 *
 * ! `../dex-evm/out/<name>.sol/<name>.json` was in that chain, documented as "same bytes the
 * backend bakes". It is not: the forge artifact carries the contract's own entries only, so Pool
 * is 74 entries against the backend's 97 — the library events and errors the backend merges in are
 * missing, and revert data logged by a library decodes to nothing. Only the shape check stood
 * between that and a release; the content pin below rejects it, so the path is gone.
 *
 * INTEGRITY IS A CONTENT PIN, NOT A SHAPE CHECK. `abis.lock.json` holds a normalised keccak of
 * each ABI (see `src/abis/hash.ts`) and NOTHING is written that misses its pin — not the backend's
 * answer, not a sibling artifact, not the file already on disk. The old check recomputed
 * `keccak(pinnedSignature)` and compared it to the constant it had just hashed, so a hostile
 * `/v1/abis` payload carrying the required signatures plus altered outputs, altered mutability or
 * extra entries passed unchanged; and a failed refresh kept a stale artifact and exited 0.
 *
 *   BTR_ABI_UPDATE=1 bun run fetch-abis   # re-pin after a deliberate contract release; REVIEW the
 *                                         # abis.lock.json diff, it is the whole trust anchor
 *   BTR_ABI_ALLOW_STALE=1 ...             # let the vendored STALE fallback through (offline build)
 *
 * Runs before every typecheck/test/build (package.json) and on postinstall, so consumers that
 * clone this repo (front via SDK_REF) compile with zero extra steps. Ends with a best-effort
 * `biome format --write` (warns, never throws: biome may be absent in a Docker build layer). */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { $ } from 'bun';
import { abiHash } from '../src/abis/hash.js';
import { ABI_FALLBACKS } from './abis.fallback.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = (process.env.BTR_API_URL ?? 'https://api.btr.markets').replace(/\/$/, '');
const lockPath = join(root, 'abis.lock.json');
const REPIN = process.env.BTR_ABI_UPDATE === '1';
const ALLOW_STALE = process.env.BTR_ABI_ALLOW_STALE === '1';

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
] as const;

type Target = (typeof TARGETS)[number];
type Entry = { type?: unknown; name?: unknown; inputs?: { type: string }[] };

const sigOf = (e: Entry): string => `${e.name}(${(e.inputs ?? []).map((p) => p.type).join(',')})`;

const selectorOf = (sig: string): string =>
  `0x${Buffer.from(keccak_256(new TextEncoder().encode(sig)))
    .toString('hex')
    .slice(0, 8)}`;

const lock: Record<string, string> = existsSync(lockPath)
  ? JSON.parse(readFileSync(lockPath, 'utf8'))
  : {};
const repinned: Record<string, string> = {};

/** Required fns present + selector canaries match; throws `integrity:` on mismatch.
 *  Cheap and shape-only — it exists to give a readable error, and to keep `BTR_ABI_UPDATE=1` from
 *  pinning something that is not the contract at all. The pin below is what actually decides. */
function checkShape(target: Target, abi: unknown[]): void {
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

/** The content pin. Every accepted ABI passes through here, whatever served it. */
function checkPin(target: Target, abi: unknown[]): void {
  const got = abiHash(abi);
  if (REPIN) {
    repinned[target.name] = got;
    if (lock[target.name] && lock[target.name] !== got) {
      console.log(`fetch-abis: RE-PIN ${target.name} ${lock[target.name]} -> ${got}`);
    }
    return;
  }
  const want = lock[target.name];
  if (!want) {
    throw new Error(
      `integrity: ${target.name} has no pin in abis.lock.json — run BTR_ABI_UPDATE=1 and review the diff`,
    );
  }
  if (got !== want) {
    throw new Error(`integrity: ${target.name} content hash ${got}, pinned ${want}`);
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
  const p = join(root, '..', 'back', 'abis', `${name}.json`);
  return existsSync(p) ? unwrap(JSON.parse(readFileSync(p, 'utf8'))) : null;
}

/** The artifact already on disk, read back through its own export so what is checked is exactly
 *  what the SDK will import. A previous run's output is not trusted for being a previous run's
 *  output; it carries the pin or it is not kept. */
async function fromExisting(t: Target): Promise<unknown[] | null> {
  const out = join(root, t.file);
  if (!existsSync(out)) return null;
  const mod = (await import(pathToFileURL(out).href)) as Record<string, unknown>;
  const abi = mod[t.symbol];
  return Array.isArray(abi) ? abi : null;
}

function write(t: Target, abi: unknown[], note: string): void {
  checkShape(t, abi);
  checkPin(t, abi);
  writeFileSync(
    join(root, t.file),
    `// GENERATED — do not edit, do not commit. Rebuild with \`bun run fetch-abis\`.\n// Backend getAbi SSoT (GET {api}/v1/abis/${t.name}). ${t.doc} [${note}]\nimport type { Abi } from '../eth/abi.js';\n\nexport const ${t.symbol}: Abi = ${JSON.stringify(abi, null, 2)};\n`,
  );
}

/** Ordered sources. Each is tried in turn and each must clear the pin; the first that does wins.
 *  A source that fails the PIN is not a transport failure — it is the case this script exists for,
 *  so it stops the build instead of falling through to the next source. */
for (const t of TARGETS) {
  const sources: { note: string; load: () => Promise<unknown[] | null> }[] = [
    { note: 'backend', load: () => fromBackend(t.name) },
    { note: 'sibling checkout', load: async () => fromSiblings(t.name) },
    { note: 'existing artifact', load: () => fromExisting(t) },
  ];

  let done = false;
  const tried: string[] = [];
  for (const s of sources) {
    let abi: unknown[] | null;
    try {
      abi = await s.load();
    } catch (e) {
      tried.push(`${s.note}: ${(e as Error).message}`);
      continue;
    }
    if (!abi) {
      tried.push(`${s.note}: absent`);
      continue;
    }
    // Reached here with bytes in hand: a pin failure is a real integrity failure, not a blink.
    write(t, abi, s.note);
    if (s.note !== 'backend') console.log(`fetch-abis: ${t.name} from ${s.note} (${tried[0]})`);
    done = true;
    break;
  }

  if (done) continue;

  const fb = ABI_FALLBACKS[t.name];
  if (!fb) throw new Error(`fetch-abis: no ${t.name} ABI (${tried.join('; ')})`);
  if (!ALLOW_STALE && !REPIN) {
    // The vendored fallback is a hot-path MINIMUM, so it cannot carry the pin of the real ABI.
    // Silently writing it is how a build produced a working binary against an ABI nobody reviewed.
    throw new Error(
      `fetch-abis: ${t.name} unavailable (${tried.join('; ')}) and the vendored fallback is STALE — ` +
        'set BTR_ABI_ALLOW_STALE=1 to build against it deliberately',
    );
  }
  checkShape(t, fb as unknown[]);
  writeFileSync(
    join(root, t.file),
    `// GENERATED — do not edit, do not commit. Rebuild with \`bun run fetch-abis\`.\n// Backend getAbi SSoT (GET {api}/v1/abis/${t.name}). ${t.doc} [STALE vendored fallback]\nimport type { Abi } from '../eth/abi.js';\n\nexport const ${t.symbol}: Abi = ${JSON.stringify(fb, null, 2)};\n`,
  );
  console.warn(
    `fetch-abis: ${t.name} from STALE vendored fallback — NOT pinned (${tried.join('; ')})`,
  );
}

if (REPIN) {
  writeFileSync(lockPath, `${JSON.stringify({ ...lock, ...repinned }, null, 2)}\n`);
  console.log(`fetch-abis: abis.lock.json re-pinned — REVIEW THE DIFF before committing`);
}

try {
  await $`bunx biome format --write ${TARGETS.map((t) => t.file)}`.cwd(root).quiet();
} catch {
  console.log('fetch-abis: biome format skipped (biome unavailable)');
}
console.log(`fetch-abis: ${TARGETS.map((t) => t.name).join(' + ')} up to date`);
