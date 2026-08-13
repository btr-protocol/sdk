/**
 * The contract manifest: the ONE place that says which Solidity artifact backs which SDK export.
 *
 * `scripts/gen.ts` (writer) and `test/abi-freshness.test.ts` (guard) both import this. They used to
 * carry separate hand-copied copies of the same table, which is the drift this file exists to end:
 * a contract added to one and not the other is generated-but-unchecked, or checked-but-unwritten.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Sibling repo holding `evm/out`. Periphery singletons live in `shared`, the DEX in `dex`. */
export type Root = 'dex' | 'shared';

export const EVM_ROOTS: Record<Root, string> = {
  dex: resolve(import.meta.dir, '../../dex/evm'),
  shared: resolve(import.meta.dir, '../../shared/evm'),
};

export interface ContractSpec {
  /** Forge contract name ⇒ `out/<contract>.sol/<contract>.json`. */
  contract: string;
  /** Generated file under `src/abis/`. */
  file: string;
  /** Exported const. */
  constName: string;
  root?: Root;
  blurb: string;
  /**
   * Extra artifacts whose EVENT entries merge in, deduped by name. solc does not attribute an
   * event to a contract that merely calls the library emitting it, so a library-emitted event is
   * absent from the caller's own ABI. Pool's swap/liquidity events all hit this.
   * Spec is `Contract` (⇒ `out/Contract.sol/Contract.json`) or `File.sol/Contract`.
   */
  mergeEventsFrom?: string[];
  /**
   * Same for ERROR entries. The swap path reverts from libraries, and solc keeps library-thrown
   * errors out of the caller's ABI, so decoding a revert against POOL_ABI needs them merged —
   * that is how `venues/router.ts` tells a deliberate halt from an RPC blink.
   */
  mergeErrorsFrom?: string[];
}

/**
 * Deployed set: Pool, PoolConfig, Pricing, PoolLiquidity, Admin (ERC-1967 proxy), PoolFactory
 * (is the beacon), Flash (proxy), LPToken, plus NUQuartic linked into PoolConfig; ExternalOracle
 * deploys separately.
 *
 * PoolConfig / Pricing / PoolLiquidity / NUQuartic are libraries with no external functions — they
 * contribute only events and errors, so they are merged into POOL_ABI (where decoders need them)
 * rather than exported as function-less ABIs of their own.
 */
export const CONTRACTS: ContractSpec[] = [
  {
    contract: 'Admin',
    file: 'Admin.ts',
    constName: 'ADMIN_ABI',
    blurb:
      'Singleton admin entrypoints (ERC-1967 proxy). Pool address is first arg of pool-scoped fns. Governance ops go through the generic `requestOp`/`execute(pool, opType, subject, aux)` pair.',
  },
  {
    contract: 'Pool',
    file: 'Pool.ts',
    constName: 'POOL_ABI',
    blurb:
      'Flat pool surface: swap/deposit/withdraw/view, the per-asset yield-hook surface, and the pool-scoped `admin*` entrypoints the Admin singleton calls into. Events and errors of the pool libraries are merged in so revert data decodes against this one ABI.',
    mergeEventsFrom: ['IPool', 'Pricing', 'PoolLiquidity'],
    mergeErrorsFrom: [
      'Errors.sol/ErrLib',
      'PoolConfig',
      'Pricing',
      'PoolLiquidity',
      'NUQuartic',
    ],
  },
  {
    contract: 'IPoolHooks',
    file: 'IPoolHooks.ts',
    constName: 'POOL_HOOKS_ABI',
    blurb:
      'Per-asset yield-hook callback surface (preOutflow recall + postInflow deploy). Pool→hook direction. Flags: HOOK_PRE_OUTFLOW / HOOK_POST_INFLOW.',
  },
  {
    contract: 'PoolFactory',
    file: 'PoolFactory.ts',
    constName: 'POOL_FACTORY_ABI',
    blurb:
      'EIP-1167 minimal-clone factory for pool instances, and the upgrade beacon itself — clones read `implementation()` from it.',
  },
  {
    contract: 'ExternalOracle',
    file: 'ExternalOracle.ts',
    constName: 'EXTERNAL_ORACLE_ABI',
    blurb:
      'Signed external oracle. batchPushSigned carries NXR-signed (price, sigmaPbps, confidence, sourceTsMs); guardian fast-freeze via pauseFeed/revokeSigner/narrowMaxDeviation/cancelSignerGrant/cancelFeedWiden. updateFeed is TIGHTEN-ONLY: widening maxDeviation/ttl goes requestFeedWiden -> the BASE tier of GOV_DELAYS -> executeFeedWiden (guardian-vetoable).',
  },
  {
    contract: 'Flash',
    file: 'Flash.ts',
    constName: 'FLASH_ABI',
    blurb: 'Singleton flash loan / flash account module (ERC-1967 proxy).',
  },
  {
    contract: 'LPToken',
    file: 'LPToken.ts',
    constName: 'LP_TOKEN_ABI',
    blurb: 'Per-leg ERC-20 liquidity receipt, minted/burned by its Pool (PoolStorage.lpTokens).',
  },
  {
    contract: 'AccessControl',
    root: 'shared',
    file: 'AccessControl.ts',
    constName: 'ACCESS_CONTROL_ABI',
    blurb:
      'Singleton AccessControl: governance SSoT (owner / treasuryOwner / factory / keepers / guardians / risk stewards) plus the immutable per-tier `GOV_DELAYS` schedule set at deploy. Quorum policy: armQuorumPolicy latches ceil(2n/3) on admin principals and guardianQuorumMax on guardians; quorumStatus is the drift monitor.',
  },
];

/**
 * Solidity enums that cross the ABI boundary as bare `uint8`.
 *
 * solc erases the members: the ABI keeps only `internalType: 'enum X.Y'`, so an ordinal is
 * unrecoverable from `out/`. Every consumer therefore used to hand-copy the list, and every
 * consumer drifted — a guardian veto sent `UPDATE_TREASURY` as 6 (`ADD_ASSET`) for as long as
 * `OpType` had been regrouped. These are read straight from the declaring source instead.
 */
export interface EnumSpec {
  /** Generated const/type name. */
  name: string;
  root: Root;
  /** Source path relative to the root's `evm/`. */
  path: string;
  /** Solidity enum name, when it differs from `name`. */
  solName?: string;
  blurb: string;
}

export const ENUMS: EnumSpec[] = [
  {
    name: 'OpType',
    root: 'dex',
    path: 'src/interfaces/IPool.sol',
    blurb:
      'Second arg of `Admin.requestOp` / `execute` / `cancelTimelock`. Grouped by timelock tier, so a member added to a group SHIFTS every ordinal after it.',
  },
  {
    name: 'BatchOp',
    root: 'dex',
    path: 'src/interfaces/IAdmin.sol',
    blurb: 'Risk-op selector for `Admin.batchRiskOp`.',
  },
  {
    name: 'Resource',
    root: 'shared',
    path: 'src/Errors.sol',
    blurb:
      'Subsystem tag carried by `Err.NotFound` / `Err.FeatureDisabled` and friends. Ordered by MEANING, so ordinals move when a member joins its group.',
  },
  {
    name: 'Tier',
    root: 'shared',
    path: 'src/Constants.sol',
    blurb:
      'Index into the packed `AccessControl.GOV_DELAYS()` word (8 x uint32 seconds). See `govDelays` in src/governance.',
  },
  {
    name: 'Role',
    root: 'shared',
    path: 'src/access/AccessControl.sol',
    blurb: 'Key of `AccessControl.pendingRole` and of `queueRole`/`executeRole`/`cancelRole`.',
  },
];

/** Members of a Solidity enum, in declaration order. Comments and trailing commas are stripped. */
export function enumMembers(spec: EnumSpec): string[] {
  const src = readFileSync(resolve(EVM_ROOTS[spec.root], spec.path), 'utf8');
  const name = spec.solName ?? spec.name;
  const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m?.[1]) throw new Error(`enum ${name} not found in ${spec.root}/evm/${spec.path}`);
  const members = m[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!members.length || members.some((s) => !/^[A-Z][A-Z0-9_]*$/.test(s))) {
    throw new Error(`enum ${name} parsed to [${members}] — the declaration shape changed`);
  }
  return members;
}

/**
 * `OpType` members whose timelock key ignores the `subject` argument, read out of the ONE
 * function that derives the key (`Admin._keyOf`): those arms return `_key(pool, ...)`, every
 * other op keys on `(pool, opId, subject)`. A UI that offers a pool-scoped op must pass a
 * subject anyway — it is ignored — but a token-keyed op cancelled with `subject = 0` computes a
 * key nothing was ever queued under and reverts `NoPending`.
 */
export function poolScopedOps(): string[] {
  const src = readFileSync(resolve(EVM_ROOTS.dex, 'src/Admin.sol'), 'utf8');
  const body = /function _keyOf\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/.exec(src)?.[1];
  if (!body) throw new Error('Admin._keyOf not found — the key derivation moved');
  const ops = [...body.matchAll(/OpType\.([A-Z_]+)\)\)\s*return\s+_key\(/g)].map((m) => m[1]!);
  if (!ops.length) throw new Error('Admin._keyOf declares no pool-scoped op — parse is stale');
  return ops;
}

/**
 * Solidity numeric constants consumers must agree with bit-for-bit: flag masks, the confidence
 * halt bound, the staleness grace. `internal`/`private constant` never reaches the ABI, so these
 * were hand-copied too — and back's copy cited a file and a constant name (`FEED_PAUSED_BIT` in
 * `Constants.sol`) that have not existed for some time. Pull only what a consumer reads.
 */
export const CONSTANTS: Array<{ root: Root; path: string; names: string[] }> = [
  {
    root: 'dex',
    path: 'src/libraries/PoolConstantsLib.sol',
    names: [
      'HALT_RISK_BIT',
      'HALT_GUARDIAN_BIT',
      'HALT_MASK',
      'SWAP_ENABLED_BIT',
      'LIABILITY_SWAP_ENABLED_BIT',
      'FLASH_ENABLED_BIT',
      'FEED_HALT_BIT',
      'MAX_CONFIDENCE_HALT_BPS',
      'MAX_DISPERSION_PBPS',
      'HOOK_PRE_OUTFLOW',
      'HOOK_POST_INFLOW',
    ],
  },
  { root: 'dex', path: 'src/libraries/Pricing.sol', names: ['STALE_Z', 'STALE_GRACE_CAP_SECS'] },
];

/** Integer literal | shift | bit-or | reference to a constant already resolved in the same file. */
const CONST_EXPR = /^[\dA-Z_\s()|&<>+*-]+$/;

/** Resolve the named constants of one source file to plain numbers, in declaration order. */
export function constantValues(spec: (typeof CONSTANTS)[number]): Array<[string, number]> {
  const src = readFileSync(resolve(EVM_ROOTS[spec.root], spec.path), 'utf8');
  const seen: Record<string, number> = {};
  const out: Array<[string, number]> = [];
  for (const name of spec.names) {
    const m = new RegExp(
      `\\b(?:internal|private|public)\\s+constant\\s+${name}\\s*=\\s*([^;]+);`,
    ).exec(src);
    if (!m?.[1]) throw new Error(`constant ${name} not found in ${spec.root}/evm/${spec.path}`);
    const expr = m[1].replace(/_(?=\d)/g, '').trim();
    if (!CONST_EXPR.test(expr)) throw new Error(`constant ${name} is not a plain integer: ${expr}`);
    const v = new Function(...Object.keys(seen), `return (${expr});`)(...Object.values(seen));
    if (!Number.isSafeInteger(v)) throw new Error(`constant ${name} did not evaluate: ${expr}`);
    seen[name] = v;
    out.push([name, v]);
  }
  return out;
}

export type AbiItem = Record<string, unknown>;

interface Artifact {
  abi: AbiItem[];
  storageLayout?: {
    storage: Array<{ label: string; slot: string; offset: number; type: string }>;
    types: Record<
      string,
      { label: string; members?: Array<{ label: string; slot: string; offset: number; type: string }> }
    >;
  };
}

/** Load a forge artifact. `spec` is `Contract` (⇒ `out/Contract.sol/Contract.json`) or `File.sol/Contract`. */
export function artifact(root: Root, spec: string): Artifact {
  const rel = spec.includes('/') ? spec : `${spec}.sol/${spec}`;
  return JSON.parse(readFileSync(resolve(EVM_ROOTS[root], `out/${rel}.json`), 'utf8')) as Artifact;
}

/** One contract's ABI, including the library events/errors solc leaves off the calling contract. */
export function resolveAbi(spec: ContractSpec): AbiItem[] {
  const root = spec.root ?? 'dex';
  let abi = artifact(root, spec.contract).abi;
  const merge = (kind: 'event' | 'error', specs?: string[]) => {
    if (!specs?.length) return;
    const have = new Set(abi.filter((e) => e.type === kind).map((e) => e.name as string));
    for (const from of specs) {
      const extra = artifact(root, from).abi.filter(
        (e) => e.type === kind && !have.has(e.name as string),
      );
      for (const e of extra) have.add(e.name as string);
      abi = [...abi, ...extra];
    }
  };
  merge('event', spec.mergeEventsFrom);
  merge('error', spec.mergeErrorsFrom);
  return abi;
}
