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
import { ACCESS_CONTROL_ABI } from '../src/abis/AccessControl';
import { POOL_FACTORY_ABI } from '../src/abis/PoolFactory';
import { ABI_GENERATION } from '../src/abis/generation';
import { abiHash } from '../src/abis/hash';

const repo = join(import.meta.dir, '..');
const readAbi = (p: string): unknown[] => {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return (Array.isArray(j) ? j : j.abi) as unknown[];
};
const POOL_ABI = readAbi(join(repo, 'abis', 'Pool.json'));
// The backend's served copy lives in the sibling checkout; CI has none, so those checks skip.
const backAbis = join(repo, '..', 'back', 'abis/generations/pool-v2-s12e');
const hasBack = existsSync(join(backAbis, 'Pool.json'));

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
});

// The committed snapshot is what every build reads FIRST, so it carries the same pin the backend
// answer must: drift from the lock stops the build rather than shipping an unreviewed ABI.
describe('the committed ABI snapshot is pinned', () => {
  const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8')).bundled.pins;

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
  const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8')).bundled.pins;

  test('the lock pins the committed SDK snapshot', () => {
    expect(lock.PoolFactory).toBe(abiHash(POOL_FACTORY_ABI));
  });

  test('the lock pins the committed AccessControl snapshot', () => {
    expect(lock.AccessControl).toBe(abiHash(ACCESS_CONTROL_ABI));
  });

  test('the official-grant surface is present and setProtocolDeployer is gone', () => {
    const names = new Set(
      (POOL_FACTORY_ABI as { type?: string; name?: string }[])
        .filter((e) => e.type === 'function')
        .map((e) => e.name),
    );
    for (const fn of ['requestOfficial', 'executeOfficial', 'cancelOfficial', 'syncOfficial']) {
      expect(names.has(fn)).toBe(true);
    }
    expect(names.has('setProtocolDeployer')).toBe(false);
  });
});

// The backend serves its own copy of each ABI; both must equal the lock.
describe.skipIf(!hasBack)('the backend bakes the pinned surface', () => {
  const lock = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8')).chains['143'].pins;
  test('back/abis/PoolFactory.json hashes to the lock', () => {
    expect(abiHash(readAbi(join(backAbis, 'PoolFactory.json')))).toBe(lock.PoolFactory);
  });
  test('back/abis/Pool.json hashes to the lock', () => {
    expect(abiHash(readAbi(join(backAbis, 'Pool.json')))).toBe(lock.Pool);
  });
});

// The guardian/safety ABIs come from the bundle, hash-verified, never the wire. A
// backend-served PoolFactory/AccessControl could suppress a pending upgrade from view, so
// `fetchAbi` must answer these names without a request. Failing `fetch` proves no request.
describe('fetchAbi serves the pinned guardian ABIs from the bundle', () => {
  test('PoolFactory and AccessControl resolve to the bundled, lock-pinned copies', async () => {
    const failFetch = () => {
      throw new Error('fetchAbi went to the wire for a pinned ABI');
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = failFetch as unknown as typeof fetch;
    try {
      const { fetchAbi, resetFetchAbiCacheForTest } = await import('../src/abis/fetch');
      resetFetchAbiCacheForTest();
      expect(await fetchAbi('PoolFactory')).toEqual(
        readAbi(join(repo, 'abis/generations/pool-v2-s12e/PoolFactory.json')),
      );
      expect(await fetchAbi('accesscontrol')).toEqual(
        readAbi(join(repo, 'abis/generations/pool-v2-s12e/AccessControl.json')),
      );
      expect(await fetchAbi('pool')).toEqual(
        readAbi(join(repo, 'abis/generations/pool-v2-s12e/Pool.json')),
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('fetchAbi serves the retired v1 generation on request', () => {
  test('chain 143 pool-v1-s7 resolves to the bundled v1 files, default stays v2', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('fetchAbi went to the wire for a bundled ABI');
    }) as unknown as typeof fetch;
    try {
      const { fetchAbi, resetFetchAbiCacheForTest } = await import('../src/abis/fetch');
      resetFetchAbiCacheForTest();
      const v1 = readAbi(join(repo, 'abis/generations/pool-v1-s7/Pool.json'));
      const v2 = readAbi(join(repo, 'abis/generations/pool-v2-s12e/Pool.json'));
      expect(await fetchAbi('Pool', 143, 'pool-v1-s7')).toEqual(v1);
      expect(await fetchAbi('Pool', 143)).toEqual(v2);
      expect(abiHash(v1)).not.toBe(abiHash(v2));
      await expect(fetchAbi('Pool', 143, 'pool-v0')).rejects.toThrow('differs from chain pin');
    } finally {
      globalThis.fetch = origFetch;
    }
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
  cpSync(join(repo, 'src', 'abis', 'generation.ts'), join(r, 'src', 'abis', 'generation.ts'));
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
        new Response(JSON.stringify(hostile), {
          headers: { 'content-type': 'application/json', 'x-btr-abi-generation': ABI_GENERATION },
        }),
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

// The revert decoder reads the root snapshot, chain 143 reads the generation file: one error set.
test('pool-v2-s12e Pool carries the same errors as the root snapshot', () => {
  const sig = (abi: unknown[]) =>
    (abi as { type: string; name: string; inputs: { type: string }[] }[])
      .filter((e) => e.type === 'error')
      .map((e) => `${e.name}(${e.inputs.map((i) => i.type).join(',')})`)
      .sort();
  const s12 = readAbi(join(repo, 'abis/generations/pool-v2-s12e/Pool.json'));
  expect(sig(s12)).toEqual(sig(POOL_ABI));
});

// ── explicit generation (offline: every fetch is stubbed or served from a local port) ──────────

describe('the SDK is pinned to one explicit ABI generation', () => {
  const lockJson = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8'));
  const body = JSON.stringify(POOL_ABI);

  test('lock generation and Pool pin equal the constant and the bundled build-head Pool', () => {
    expect(ABI_GENERATION).toBe('pool-v2-s12e');
    expect(lockJson.chains['143'].generation).toBe(ABI_GENERATION);
    expect(lockJson.chains['143'].pins.Pool).toBe(lockJson.bundled.pins.Pool);
    expect(lockJson.chains['143'].pins.Pool).toBe(abiHash(POOL_ABI));
  });

  test('the postinstall request names the generation and rejects a mismatching header', async () => {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        seen.push(new URL(req.url).search);
        return new Response(body, { headers: { 'x-btr-abi-generation': 'pool-v2-s12' } });
      },
    });
    try {
      const r = await runScript(makeSandbox(), { BTR_API_URL: `http://127.0.0.1:${server.port}` });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(`backend generation differs from ${ABI_GENERATION}`);
      expect(seen[0]).toBe(`?chain_id=143&generation=${ABI_GENERATION}`);
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test('the postinstall script accepts a matching header and the pinned bytes', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(body, { headers: { 'x-btr-abi-generation': ABI_GENERATION } }),
    });
    try {
      const r = await runScript(makeSandbox(), {
        BTR_API_URL: `http://127.0.0.1:${server.port}`,
        BTR_ABI_ALLOW_STALE: '',
      });
      // Admin has no stub here, so only Pool's path is asserted.
      expect(r.out).toContain('fetch-abis: Pool from backend');
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test('runtime: the URL carries the generation, 400 unknown_generation is a typed error', async () => {
    const { fetchAbi, getAbiUrl, resetFetchAbiCacheForTest, AbiUnknownGenerationError } =
      await import('../src/abis/fetch');
    expect(getAbiUrl('Router', 143)).toContain(`generation=${ABI_GENERATION}`);
    const orig = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      urls.push(String(u));
      return Response.json({ error: 'unknown_generation' }, { status: 400 });
    }) as unknown as typeof fetch;
    try {
      resetFetchAbiCacheForTest();
      const err = await fetchAbi('Router', 143).catch((e) => e);
      expect(err).toBeInstanceOf(AbiUnknownGenerationError);
      expect(err).toMatchObject({
        code: 'unknown_generation',
        status: 400,
        generation: ABI_GENERATION,
      });
      expect(urls[0]).toContain(`generation=${ABI_GENERATION}`);
      // A 400 with another body stays a plain error.
      globalThis.fetch = (async () =>
        Response.json({ error: 'bad' }, { status: 400 })) as unknown as typeof fetch;
      const plain = await fetchAbi('Router', 143).catch((e) => e);
      expect(plain).not.toBeInstanceOf(AbiUnknownGenerationError);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
