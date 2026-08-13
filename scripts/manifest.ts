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
