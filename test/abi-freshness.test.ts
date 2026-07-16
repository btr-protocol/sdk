/**
 * ABI freshness test, Phase 42H.D · Round 4 · G16
 *
 * For each ABI in src/abis/, load the compiled artifact from dex/evm/out or
 * shared/evm/out (forge build @ pinned commit) and assert ABI parity. Catches
 * drift when Solidity sources change without ABI regen.
 *
 * Comparison is structural (function/event/error/constructor selectors + types).
 * Param `name` fields and `internalType` strings are stripped before compare -
 * these are cosmetic and do NOT affect on-wire ABI encoding. Anything else
 * (added/removed/renamed function, changed type, changed mutability) → fail.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCESS_CONTROL_ABI,
  ADMIN_ABI,
  BRIDGEABLE_ERC20_ABI,
  BRIDGE_ABI,
  DISTRIBUTOR_ABI,
  EXTERNAL_ORACLE_ABI,
  FLASH_ABI,
  GOV_TOKEN_ABI,
  GOV_TREASURY_ABI,
  OPS_TREASURY_ABI,
  POOL_ABI,
  POOL_AUX_ABI,
  POOL_FACTORY_ABI,
  POOL_HOOKS_ABI,
  STAKED_ASSET_ABI,
  STAKING_ABI,
} from '../src/abis/index.js';

const EVM_ROOTS = {
  dex: resolve(import.meta.dir, '../../dex/evm'),
  shared: resolve(import.meta.dir, '../../shared/evm'),
} as const;

/** Map of (sdk ABI const) → (forge contract name). `root` picks the sibling repo holding the
 *  artifact (periphery singletons moved to shared/evm). `mergeEventsFrom` mirrors
 *  scripts/regen-dex-abis.ts: events declared on an interface but only ever EMITTED from a
 *  library aren't in the implementing contract's own artifact (solc doesn't attribute a
 *  library-emitted event to the caller unless it `is` the declaring interface) — GATE-06. */
const ABI_MAP: Array<{
  name: string;
  ts: readonly unknown[];
  contract: string;
  root?: keyof typeof EVM_ROOTS;
  mergeEventsFrom?: string[];
}> = [
  { name: 'AccessControl', ts: ACCESS_CONTROL_ABI, contract: 'AccessControl', root: 'shared' },
  { name: 'Admin', ts: ADMIN_ABI, contract: 'Admin' },
  { name: 'Bridge', ts: BRIDGE_ABI, contract: 'Bridge', root: 'shared' },
  {
    name: 'BridgeableERC20',
    ts: BRIDGEABLE_ERC20_ABI,
    contract: 'BridgeableERC20',
    root: 'shared',
  },
  { name: 'Distributor', ts: DISTRIBUTOR_ABI, contract: 'Distributor', root: 'shared' },
  { name: 'ExternalOracle', ts: EXTERNAL_ORACLE_ABI, contract: 'ExternalOracle' },
  { name: 'Flash', ts: FLASH_ABI, contract: 'Flash' },
  { name: 'GovToken', ts: GOV_TOKEN_ABI, contract: 'GovToken', root: 'shared' },
  { name: 'GovTreasury', ts: GOV_TREASURY_ABI, contract: 'GovTreasury', root: 'shared' },
  { name: 'OpsTreasury', ts: OPS_TREASURY_ABI, contract: 'OpsTreasury', root: 'shared' },
  { name: 'Pool', ts: POOL_ABI, contract: 'Pool', mergeEventsFrom: ['IPool'] },
  { name: 'PoolAux', ts: POOL_AUX_ABI, contract: 'PoolAux' },
  { name: 'IPoolHooks', ts: POOL_HOOKS_ABI, contract: 'IPoolHooks' },
  { name: 'PoolFactory', ts: POOL_FACTORY_ABI, contract: 'PoolFactory' },
  { name: 'StakedAsset', ts: STAKED_ASSET_ABI, contract: 'StakedAsset', root: 'shared' },
  { name: 'Staking', ts: STAKING_ABI, contract: 'Staking', root: 'shared' },
];

type AbiItem = Record<string, unknown> & {
  type: string;
  inputs?: AbiItem[];
  outputs?: AbiItem[];
  components?: AbiItem[];
};

function loadForgeAbi(
  contract: string,
  root: keyof typeof EVM_ROOTS = 'dex',
  mergeEventsFrom?: string[],
): AbiItem[] {
  const artifactPath = resolve(EVM_ROOTS[root], `out/${contract}.sol/${contract}.json`);
  const raw = readFileSync(artifactPath, 'utf8');
  let abi = (JSON.parse(raw) as { abi: AbiItem[] }).abi;
  if (mergeEventsFrom?.length) {
    const have = new Set(abi.filter((e) => e.type === 'event').map((e) => e.name as string));
    for (const ifaceName of mergeEventsFrom) {
      const ifacePath = resolve(EVM_ROOTS[root], `out/${ifaceName}.sol/${ifaceName}.json`);
      const iface = (JSON.parse(readFileSync(ifacePath, 'utf8')) as { abi: AbiItem[] }).abi;
      const missing = iface.filter((e) => e.type === 'event' && !have.has(e.name as string));
      for (const e of missing) have.add(e.name as string);
      abi = [...abi, ...missing];
    }
  }
  return abi;
}

/**
 * Strip cosmetic fields (`name`, `internalType`) from a parsed ABI so structural
 * compare ignores parameter naming and Solidity-internal type strings (e.g.
 * `struct Foo` vs `tuple`). Recursive over inputs/outputs/components.
 *
 * Top-level entries keep their `name` (function/event identity) but parameter-
 * level names are erased.
 */
function normalize(abi: readonly unknown[]): AbiItem[] {
  const stripParams = (items?: AbiItem[]): AbiItem[] | undefined => {
    if (!items) return items;
    return items.map((it) => {
      const { name: _n, internalType: _it, components, ...rest } = it;
      const out: AbiItem = { ...rest } as AbiItem;
      if (components) out.components = stripParams(components as AbiItem[]);
      return out;
    });
  };

  return (abi as AbiItem[]).map((entry) => {
    const { internalType: _it, ...rest } = entry;
    const out: AbiItem = { ...rest };
    if (entry.inputs) out.inputs = stripParams(entry.inputs);
    if (entry.outputs) out.outputs = stripParams(entry.outputs);
    return out;
  });
}

/** Stable canonical JSON (sorted keys at every depth) for byte-equal compare. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

describe('ABI freshness vs dex/evm + shared/evm sources', () => {
  const rootsExist = existsSync(EVM_ROOTS.dex) && existsSync(EVM_ROOTS.shared);

  test('dex/evm + shared/evm sibling repos are reachable', () => {
    expect(rootsExist).toBe(true);
  });

  if (!rootsExist) return;

  for (const { name, ts, contract, root, mergeEventsFrom } of ABI_MAP) {
    test(`${name} ABI matches ${root ?? 'dex'}/evm compiled artifact`, () => {
      const onChain = loadForgeAbi(contract, root, mergeEventsFrom);
      const a = canonical(normalize(onChain));
      const b = canonical(normalize(ts));
      if (a !== b) {
        const sig = (abi: AbiItem[]) =>
          abi
            .filter((e) => ['function', 'event', 'error'].includes(e.type))
            .map((e) => `${e.type} ${e.name as string}`)
            .sort();
        const onSet = new Set(sig(normalize(onChain)));
        const tsSet = new Set(sig(normalize(ts as readonly unknown[])));
        const missing = [...onSet].filter((s) => !tsSet.has(s));
        const extra = [...tsSet].filter((s) => !onSet.has(s));
        const hint =
          missing.length || extra.length
            ? `\nmissing in TS: ${missing.join(', ') || '(none)'}\nextra in TS:   ${extra.join(', ') || '(none)'}`
            : '\n(structural drift in input/output types or mutability)';
        throw new Error(`${name} ABI drift detected.${hint}`);
      }
    });
  }
});
