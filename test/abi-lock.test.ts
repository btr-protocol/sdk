/** r2 C-M-8: only the four fetched ABIs were content-pinned; the committed static ones (Router,
 *  Flash, LPToken, IPoolHooks, both MarkStore wires, ExternalOracleV4) could change in any commit
 *  with nothing noticing. Every exported ABI now carries a pin in `abis.lock.json`, and the two
 *  with a dex-evm artifact must equal it. Re-pin: edit the ABI, run this test, review the diff. */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { abiHash } from '../src/abis/hash';
import * as ABIS from '../src/abis/index';

const repo = join(import.meta.dir, '..');
const lock: Record<string, string> = JSON.parse(readFileSync(join(repo, 'abis.lock.json'), 'utf8'));
const PINNED: Record<string, keyof typeof ABIS> = {
  Pool: 'POOL_ABI',
  Admin: 'ADMIN_ABI',
  PoolFactory: 'POOL_FACTORY_ABI',
  AccessControl: 'ACCESS_CONTROL_ABI',
  Router: 'ROUTER_ABI',
  Flash: 'FLASH_ABI',
  LPToken: 'LP_TOKEN_ABI',
  IPoolHooks: 'POOL_HOOKS_ABI',
  MarkStore: 'MARK_STORE_ABI',
  MarkStoreV2: 'MARK_STORE_ABI_V2',
  ExternalOracleV4: 'EXTERNAL_ORACLE_V4_ABI',
};

test('every exported ABI has a content pin and matches it', () => {
  const exported = Object.keys(ABIS).filter(
    (k) => /_ABI(_V\d+)?$/.test(k) && Array.isArray(ABIS[k as keyof typeof ABIS]),
  );
  expect(exported.sort()).toEqual(Object.values(PINNED).sort());
  for (const [name, sym] of Object.entries(PINNED))
    expect([name, abiHash(ABIS[sym] as unknown as unknown[])]).toEqual([name, lock[name]]);
});

const DEX = join(repo, '..', 'dex-evm', 'abi');
// The sdk ships both mark-store wires; the dex-evm checkout (CI pins one commit) is one of them.
test('Router and MarkStore equal the dex-evm artifacts', () => {
  if (!existsSync(DEX))
    throw new Error('abi-lock.test.ts needs ../dex-evm/abi (CI pins and clones it)');
  const dex = (n: string) => {
    const j = JSON.parse(readFileSync(join(DEX, `${n}.json`), 'utf8'));
    return (Array.isArray(j) ? j : j.abi) as unknown[];
  };
  expect(abiHash(dex('Router'))).toBe(lock.Router);
  expect([lock.MarkStore, lock.MarkStoreV2]).toContain(abiHash(dex('MarkStoreP8')));
});
