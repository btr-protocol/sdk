/** Build-time ABIs: the backend getAbi service is the SSoT, and `abis/<Name>.json` is the snapshot
 * of it this repo was reviewed against.
 *
 *   bun run fetch-abis                       # committed snapshot, else GET {api}/v1/abis/{Pool,Admin}
 *   BTR_API_URL=http://localhost:3000 bun run fetch-abis
 *
 * Source chain per target: the committed snapshot → backend → the sibling `../back/abis` checkout
 * (the bytes the backend bakes) → keep-existing → vendored `abis.fallback.ts` (STALE hot-path
 * minimum; keeps a fresh clone building, e.g. front Docker via SDK_REF).
 *
 * THE SNAPSHOT IS READ FIRST SO A BUILD NEVER DEPENDS ON THE LIVE API SERVING THE RELEASE IT IS
 * BUILDING. A contract release that re-pins the lock before the backend redeploys — or a front
 * rollback that moves `SDK_REF` back after the backend moved on — failed the pin on every
 * `bun install`, so no front hotfix could be built during the incident that needed one. The pin
 * itself is unchanged: the snapshot carries it like any other source, and misses it the same way.
 *
 * A forge artifact carries the contract's own entries only: the events and errors raised inside
 * a linked library (`Pricing.ThresholdViolation`, `PoolLiquidity.Swapped`) are missing, and revert
 * data from one decodes to nothing. So a re-pin against a contract release reads the checkout
 * EXPLICITLY and merges the linked libraries' entries — the surface the backend bakes:
 *
 *   BTR_DEX_EVM=../dex-evm BTR_ABI_UPDATE=1 bun run fetch-abis   # after `forge build` there
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
/** A built dex-evm checkout; when set it is the ONLY source (the release being pinned). */
const DEX_EVM = process.env.BTR_DEX_EVM;
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

/** The reviewed snapshot, committed beside the lock it hashes to. */
function fromCommitted(name: string): unknown[] | null {
  const p = join(root, 'abis', `${name}.json`);
  return existsSync(p) ? unwrap(JSON.parse(readFileSync(p, 'utf8'))) : null;
}

function fromSiblings(name: string): unknown[] | null {
  const p = join(root, '..', 'back', 'abis', `${name}.json`);
  return existsSync(p) ? unwrap(JSON.parse(readFileSync(p, 'utf8'))) : null;
}

/** Contract artifact ∪ the events and errors of every library it links, transitively. */
function fromDexEvm(name: string): unknown[] {
  const artifact = (file: string) =>
    JSON.parse(readFileSync(join(DEX_EVM as string, 'out', file), 'utf8')) as {
      abi: Entry[];
      bytecode: { linkReferences?: Record<string, Record<string, unknown>> };
    };
  const abi: Entry[] = [];
  const seen = new Set<string>();
  const add = (e: Entry) => {
    const k = `${e.type}:${sigOf(e)}`;
    if (!seen.has(k)) {
      seen.add(k);
      abi.push(e);
    }
  };
  const walk = (file: string, own: boolean) => {
    const a = artifact(file);
    for (const e of a.abi) if (own || e.type === 'event' || e.type === 'error') add(e);
    for (const [src, libs] of Object.entries(a.bytecode.linkReferences ?? {}))
      for (const lib of Object.keys(libs)) walk(`${src.split('/').pop()}/${lib}.json`, false);
  };
  walk(`${name}.sol/${name}.json`, true);
  return abi;
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
  const sources: { note: string; load: () => Promise<unknown[] | null> }[] = DEX_EVM
    ? [{ note: 'dex-evm checkout', load: async () => fromDexEvm(t.name) }]
    : [
        // Skipped on a re-pin: `BTR_ABI_UPDATE=1` exists to read the live surface, not the snapshot.
        ...(REPIN ? [] : [{ note: 'committed snapshot', load: async () => fromCommitted(t.name) }]),
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
    // Named on every path: which source answered is the fact an operator needs during a release
    // or rollback window, and with the snapshot read first the happy path is no longer the
    // backend, so a silent success hid which ABI the build actually compiled against.
    console.log(`fetch-abis: ${t.name} from ${s.note}${tried.length ? ` (${tried[0]})` : ''}`);
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
