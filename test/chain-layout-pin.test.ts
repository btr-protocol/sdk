/**
 * Chain-truth pin: `src/abis/Pool.ts` + `src/pool/storage.ts` vs the pool that is actually DEPLOYED.
 *
 * `test/abi-freshness.test.ts` and `test/storage-layout.test.ts` both compare the SDK against
 * `dex/evm/out`, i.e. against the SOURCE. Neither can see a pool whose bytecode predates that
 * source, and on 2026-08-12 exactly that shipped: the SDK was regenerated against the repacked
 * `IPool` (Asset 13 fields, mappings 4..11) while Sepolia still runs the pre-repack impl
 * (Asset 19 fields, mappings 3..13). Every reader returned garbage, `readCurve` returned null and
 * the UI drew a fallback band, and both artifact tests stayed green because the artifact agreed
 * with the SDK. Only the chain disagreed.
 *
 * So this asserts the same two tables against `eth_call` / `eth_getStorageAt` on the live pool.
 * Deliberately independent of `dex/evm/out`: an artifact cannot witness what is deployed.
 *
 * Gated twice, and both gates SKIP rather than fail: without `ORACLE_RPC_URL`
 * (`source ~/Work/btr/keepers/.env.sepolia`), and when `SEPOLIA_BTR.volatilePool` carries no code
 * on that RPC. The second gate is what lets this live in the suite across a fleet swap — between
 * tearing the old deployment down and recording the new one there is nothing to pin, and a red
 * suite for that reason trains people to ignore it. A red here always means real drift.
 *
 * The cost of a skip is a silent gap, so it prints why. Run it deliberately after every deploy.
 */

import { describe, expect, test } from 'bun:test';
import { POOL_ABI } from '../src/abis/Pool';
import { encodeFn } from '../src/eth/abi';
import { createHttpProvider } from '../src/eth/client';
import type { Address, Hex } from '../src/eth/types';
import {
  POOL_STORAGE,
  POOL_STRUCTS,
  addressAt,
  getStorageAt,
  mappingBaseU16,
} from '../src/pool/storage';
import { SEPOLIA_BTR, SEPOLIA_TOKENS } from '../src/venues/sepolia';

const RPC = process.env.ORACLE_RPC_URL ?? '';
const POOL = SEPOLIA_BTR.volatilePool;

/** Is a pool actually deployed at the recorded address? Any RPC trouble counts as "no fleet": the
 *  point of this file is to witness a live pool, and it cannot witness one it never reached. */
const deployed = await (async () => {
  if (!RPC) return false;
  try {
    const code = await createHttpProvider(RPC).request({
      method: 'eth_getCode',
      params: [POOL, 'latest'],
    });
    return typeof code === 'string' && code.length > 2;
  } catch {
    return false;
  }
})();

if (!deployed) {
  console.warn(
    `chain-layout-pin: SKIPPED — ${RPC ? `no code at ${POOL} (fleet not deployed yet?)` : 'ORACLE_RPC_URL unset'}. The SDK's ABI and storage tables are unverified against any live pool.`,
  );
}

/** Field count solc will ABI-encode for `getAsset` — every member is static, so words == fields. */
const GET_ASSET_FIELDS = (() => {
  const fn = POOL_ABI.find((e) => 'name' in e && e.name === 'getAsset') as {
    outputs: [{ components: readonly unknown[] }];
  };
  return fn.outputs[0].components.length;
})();

const tokenAddress = (symbol: string): Address => {
  const a = SEPOLIA_TOKENS[symbol];
  if (!a) throw new Error(`no sepolia token ${symbol}`);
  return a;
};

describe.skipIf(!deployed)('deployed-pool layout pin (Sepolia)', () => {
  const provider = createHttpProvider(RPC);

  test('getAsset returns exactly as many words as POOL_ABI declares fields', async () => {
    const data = (await provider.request({
      method: 'eth_call',
      params: [
        {
          to: POOL,
          data: encodeFn({ abi: POOL_ABI, functionName: 'getAsset', args: [tokenAddress('WETH')] }),
        },
        'latest',
      ],
    })) as Hex;
    // A mismatch means every field after the first divergence decodes off-by-N. Silent, not a throw.
    expect((data.length - 2) / 64).toBe(GET_ASSET_FIELDS);
  });

  test('POOL_STORAGE.wnative and .factory hold the addresses the deployment recorded', async () => {
    const w = POOL_STRUCTS.PoolStorage.wnative;
    const f = POOL_STRUCTS.PoolStorage.factory;
    const [wnative, packed] = await Promise.all([
      getStorageAt(provider, POOL, BigInt(w[0])),
      getStorageAt(provider, POOL, BigInt(f[0])),
    ]);
    // Two independently-placed scalars: together they pin the head of the struct AND the slot the
    // mapping block is counted from, which is what a repack moves.
    expect(addressAt(wnative, w[1]).toLowerCase()).toBe(tokenAddress('WETH').toLowerCase());
    expect(addressAt(packed, f[1]).toLowerCase()).toBe(SEPOLIA_BTR.poolFactory.toLowerCase());
  });

  test('POOL_STORAGE.curves resolves to a populated preset table, not a zero slot', async () => {
    // Every listed leg points at a preset, so at least one of 1..5 must carry a non-zero header.
    // A slot-off-by-one reads an unrelated (and here: permanently zero) word, which `readCurve`
    // reports as "no preset" and the UI silently replaces with a linear fallback band.
    const headers = await Promise.all(
      [1, 2, 3, 4, 5].map((id) =>
        getStorageAt(provider, POOL, mappingBaseU16(id, POOL_STORAGE.curves)),
      ),
    );
    expect(headers.some((h) => BigInt(h) !== 0n)).toBe(true);
  });
});
