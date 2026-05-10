/**
 * ABI freshness test — Phase 42H.D · Round 4 · G16
 *
 * For each ABI in src/abis/, run `forge inspect <Contract> abi --json` against
 * the canonical source repo (dex/evm) and assert ABI parity. Catches drift when
 * Solidity sources change without ABI regen.
 *
 * Comparison is structural (function/event/error/constructor selectors + types).
 * Param `name` fields and `internalType` strings are stripped before compare —
 * these are cosmetic and do NOT affect on-wire ABI encoding. Anything else
 * (added/removed/renamed function, changed type, changed mutability) → fail.
 */

import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ADMIN_ABI,
  BRIDGE_ABI,
  BRIDGEABLE_ERC20_ABI,
  DISTRIBUTOR_ABI,
  FLASH_ABI,
  GOV_TOKEN_ABI,
  POOL_ABI,
  POOL_FACTORY_ABI,
  ROUTER_ABI,
  STAKED_GOV_ABI,
  STAKED_LP_ABI,
  STAKING_ABI,
  TREASURY_ABI,
} from '../src/abis/index.js';

const DEX_EVM = resolve(import.meta.dir, '../../dex/evm');

/** Map of (sdk ABI const) → (forge contract name). */
const ABI_MAP: Array<{ name: string; ts: readonly unknown[]; contract: string }> = [
  { name: 'Admin', ts: ADMIN_ABI, contract: 'Admin' },
  { name: 'Bridge', ts: BRIDGE_ABI, contract: 'Bridge' },
  { name: 'BridgeableERC20', ts: BRIDGEABLE_ERC20_ABI, contract: 'BridgeableERC20' },
  { name: 'Distributor', ts: DISTRIBUTOR_ABI, contract: 'Distributor' },
  { name: 'Flash', ts: FLASH_ABI, contract: 'Flash' },
  { name: 'GovToken', ts: GOV_TOKEN_ABI, contract: 'GovToken' },
  { name: 'Pool', ts: POOL_ABI, contract: 'Pool' },
  { name: 'PoolFactory', ts: POOL_FACTORY_ABI, contract: 'PoolFactory' },
  { name: 'Router', ts: ROUTER_ABI, contract: 'Router' },
  { name: 'StakedGov', ts: STAKED_GOV_ABI, contract: 'StakedGov' },
  { name: 'StakedLP', ts: STAKED_LP_ABI, contract: 'StakedLP' },
  { name: 'Staking', ts: STAKING_ABI, contract: 'Staking' },
  { name: 'Treasury', ts: TREASURY_ABI, contract: 'Treasury' },
];

type AbiItem = Record<string, unknown> & {
  type: string;
  inputs?: AbiItem[];
  outputs?: AbiItem[];
  components?: AbiItem[];
};

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

describe('ABI freshness vs dex/evm sources', () => {
  const dexExists = existsSync(DEX_EVM);

  test('dex/evm sibling repo is reachable', () => {
    expect(dexExists).toBe(true);
  });

  if (!dexExists) return;

  for (const { name, ts, contract } of ABI_MAP) {
    test(`${name} ABI matches forge inspect output`, () => {
      const raw = execSync(`forge inspect ${contract} abi --json`, {
        cwd: DEX_EVM,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const onChain = JSON.parse(raw);
      const a = canonical(normalize(onChain));
      const b = canonical(normalize(ts));
      if (a !== b) {
        // Tighter diff hint: surface signature-only sets so failures localise.
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
