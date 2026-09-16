/** The ABI supply chain: what `bun run fetch-abis` will and will not write.
 *
 *  The old build-time check recomputed `keccak(pinnedSignature)` and compared it to the constant
 *  it had just hashed — a tautology that only ever proved keccak works. A hostile `/v1/abis/Pool`
 *  carrying the required signatures plus altered outputs passed it, and a failed refresh kept
 *  whatever was on disk and exited 0. Both are asserted here against the real script.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POOL_FACTORY_ABI } from '../src/abis/PoolFactory';
import { abiHash } from '../src/abis/hash';

const repo = join(import.meta.dir, '..');
const POOL_ABI_JSON = JSON.parse(
  readFileSync(join(repo, '..', 'back', 'abis', 'Pool.json'), 'utf8'),
);
const POOL_ABI = (Array.isArray(POOL_ABI_JSON) ? POOL_ABI_JSON : POOL_ABI_JSON.abi) as unknown[];
const POOL_FACTORY_ABI_JSON = JSON.parse(
  readFileSync(join(repo, '..', 'back', 'abis', 'PoolFactory.json'), 'utf8'),
);
const POOL_FACTORY_BACK = (
  Array.isArray(POOL_FACTORY_ABI_JSON) ? POOL_FACTORY_ABI_JSON : POOL_FACTORY_ABI_JSON.abi
) as unknown[];

// ── the hash itself ──────────────────────────────────────────────────────────

describe('abiHash pins content, not shape', () => {
  test('entry order does not change the hash', () => {
    expect(abiHash([...POOL_ABI].reverse())).toBe(abiHash(POOL_ABI));
  });

  test('an added entry changes the hash', () => {
    const extra = [
      ...POOL_ABI,
      { type: 'function', name: 'sweep', inputs: [], outputs: [], stateMutability: 'nonpayable' },
    ];
    expect(abiHash(extra)).not.toBe(abiHash(POOL_ABI));
  });

  test('altered outputs on an existing function change the hash', () => {
    // Same name, same inputs, same selector — the shape check could not see this.
    const tampered = POOL_ABI.map((e) => {
      const f = e as { name?: string; type?: string };
      return f.type === 'function' && f.name === 'getSwapQuote'
        ? { ...(e as object), outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }] }
        : e;
    });
    expect(abiHash(tampered)).not.toBe(abiHash(POOL_ABI));
  });

  test('altered mutability changes the hash', () => {
    const tampered = POOL_ABI.map((e) => {
      const f = e as { name?: string; type?: string };
      return f.type === 'function' && f.name === 'getSwapQuote'
        ? { ...(e as object), stateMutability: 'nonpayable' }
        : e;
    });
    expect(abiHash(tampered)).not.toBe(abiHash(POOL_ABI));
  });

  test('the committed lock matches what the backend bakes', () => {
    const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8'));
    expect(lock.Pool).toBe(abiHash(POOL_ABI));
  });
});

// The committed snapshot is what every build reads FIRST, so it carries the same pin the backend
// answer must: drift from the lock stops the build rather than shipping an unreviewed ABI.
describe('the committed ABI snapshot is pinned', () => {
  const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8'));

  for (const name of ['Pool', 'Admin']) {
    test(`abis/${name}.json hashes to the lock`, () => {
      const raw = JSON.parse(readFileSync(join(repo, 'abis', `${name}.json`), 'utf8'));
      expect(abiHash(Array.isArray(raw) ? raw : raw.abi)).toBe(lock[name]);
    });
  }
});

// A-1131: PoolFactory is a consumer surface too, and it drifted once already (pinned without
// `executeOfficial`/`cancelOfficial`, still carrying the removed `setProtocolDeployer`). The
// committed SDK snapshot, the backend's `back/abis/PoolFactory.json` and the lock must agree, and
// the official-grant surface must be the current one.
describe('PoolFactory parity is pinned across repos', () => {
  const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8'));

  test('the lock pins the committed SDK snapshot', () => {
    expect(lock.PoolFactory).toBe(abiHash(POOL_FACTORY_ABI));
  });

  test('the backend ABI is the same surface as the SDK snapshot', () => {
    expect(abiHash(POOL_FACTORY_BACK)).toBe(lock.PoolFactory);
  });

  test('the official-grant surface is present and setProtocolDeployer is gone', () => {
    const names = new Set(
      (POOL_FACTORY_ABI as { type?: string; name?: string }[])
        .filter((e) => e.type === 'function')
        .map((e) => e.name),
    );
    for (const fn of ['setOfficial', 'executeOfficial', 'cancelOfficial', 'syncOfficial']) {
      expect(names.has(fn)).toBe(true);
    }
    expect(names.has('setProtocolDeployer')).toBe(false);
  });
});

// ── the script ───────────────────────────────────────────────────────────────

/** A minimal checkout: everything the script reads, and no `../back/abis` sibling above it. */
const sandbox = join(tmpdir(), 'btr-sdk-abi-pin');
function makeSandbox(): string {
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(join(sandbox, 'repo', 'src', 'abis'), { recursive: true });
  mkdirSync(join(sandbox, 'repo', 'src', 'eth'), { recursive: true });
  const r = join(sandbox, 'repo');
  cpSync(join(repo, 'scripts'), join(r, 'scripts'), { recursive: true });
  cpSync(join(repo, 'src', 'abis', 'hash.ts'), join(r, 'src', 'abis', 'hash.ts'));
  cpSync(join(repo, 'src', 'eth', 'abi.ts'), join(r, 'src', 'eth', 'abi.ts'));
  cpSync(join(repo, 'src', 'eth', 'types.ts'), join(r, 'src', 'eth', 'types.ts'));
  cpSync(join(repo, 'abis.lock.json'), join(r, 'abis.lock.json'));
  symlinkSync(join(repo, 'node_modules'), join(r, 'node_modules'), 'dir');
  return r;
}
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function runScript(
  cwd: string,
  env: Record<string, string>,
): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['bun', join(cwd, 'scripts', 'fetch-abis.ts')], {
    cwd,
    // The sandbox exercises the backend chain; a BTR_DEX_EVM override in the caller's shell must not leak in.
    env: { ...process.env, BTR_DEX_EVM: '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, out: out + err };
}

describe('fetch-abis refuses what it cannot pin', () => {
  test('a hostile /v1/abis payload that passes the shape check is rejected', async () => {
    // Every required function, the pinned selector intact, one extra entry: exactly the payload
    // the old tautological check waved through.
    const hostile = [
      ...POOL_ABI,
      {
        type: 'function',
        name: 'sweepTo',
        inputs: [{ name: 'to', type: 'address', internalType: 'address' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ];
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(JSON.stringify(hostile), { headers: { 'content-type': 'application/json' } }),
    });
    try {
      const r = await runScript(makeSandbox(), { BTR_API_URL: `http://127.0.0.1:${server.port}` });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain('integrity: Pool content hash');
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test('backend unreachable with nothing pinned to fall back on FAILS the build', async () => {
    // Port 1 is not listening; the sandbox has no `../back/abis` and no existing artifact, so the
    // only thing left is the vendored STALE fallback. It used to be written with an exit 0.
    const r = await runScript(makeSandbox(), { BTR_API_URL: 'http://127.0.0.1:1' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('STALE');
    expect(existsSync(join(sandbox, 'repo', 'src', 'abis', 'Pool.ts'))).toBe(false);
  }, 30_000);

  test('a dead backend is survivable: the committed snapshot builds on its own', async () => {
    // The release/rollback window this exists for: the API serves a different release than the
    // lock pins, or is down. The snapshot is pinned, so the build proceeds on it and never
    // reaches the STALE fallback.
    const r = makeSandbox();
    cpSync(join(repo, 'abis'), join(r, 'abis'), { recursive: true });
    const out = await runScript(r, { BTR_API_URL: 'http://127.0.0.1:1' });
    expect(out.code).toBe(0);
    expect(out.out).toContain('committed snapshot');
    expect(out.out).not.toContain('STALE');
    expect(existsSync(join(r, 'src', 'abis', 'Pool.ts'))).toBe(true);
  }, 30_000);

  test('...unless the stale build is asked for explicitly', async () => {
    const r = await runScript(makeSandbox(), {
      BTR_API_URL: 'http://127.0.0.1:1',
      BTR_ABI_ALLOW_STALE: '1',
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('NOT pinned');
    expect(existsSync(join(sandbox, 'repo', 'src', 'abis', 'Pool.ts'))).toBe(true);
  }, 30_000);
});
