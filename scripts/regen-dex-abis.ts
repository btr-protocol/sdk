/**
 * One-shot: extract ABIs from dex/evm/out + shared/evm/out artifacts @ pinned commit → sdk/src/abis/*.ts
 * Usage: bun scripts/regen-dex-abis.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EVM_ROOTS = {
  dex: resolve(import.meta.dir, '../../dex/evm'),
  shared: resolve(import.meta.dir, '../../shared/evm'),
} as const;
const ABI_DIR = resolve(import.meta.dir, '../src/abis');

const CONTRACTS: Array<{
  contract: string;
  file: string;
  constName: string;
  title: string;
  blurb: string;
  /** Which repo's evm/out holds the artifact (default 'dex'; periphery singletons moved to shared/evm). */
  root?: keyof typeof EVM_ROOTS;
  /** Extra artifact(s) whose EVENT entries get merged in (dedup by name). Needed when an
   *  event is declared on an interface but only ever EMITTED from a library the contract calls into —
   *  solc's ABI generator doesn't pick up library-emitted events unless the contract itself `is` the
   *  declaring interface, so they're silently absent from the contract's own artifact (GATE-06: Pool's
   *  Swapped/Deposited/Withdrawn/LiabilitySwapped/Donated all hit this).
   *  Spec is `Contract` (⇒ `out/Contract.sol/Contract.json`) or `File.sol/Contract`. */
  mergeEventsFrom?: string[];
  /** Same, for ERROR entries. The swap path reverts from libraries (`Pricing`, `FeedMathLib`, ...), and
   *  solc keeps library-thrown errors out of the caller's ABI, so `Pool`'s own artifact names only the
   *  handful it throws inline. `venues/router.ts` decodes revert data against POOL_ABI to tell a
   *  deliberate halt (StaleData / BaseDepegged) from an RPC blink — merging `Err` keeps that table whole. */
  mergeErrorsFrom?: string[];
}> = [
  {
    contract: 'Admin',
    file: 'Admin.ts',
    constName: 'ADMIN_ABI',
    title: 'Admin',
    blurb: 'Singleton admin entrypoints. Pool address is first arg of pool-scoped fns.',
  },
  {
    contract: 'Pool',
    file: 'Pool.ts',
    constName: 'POOL_ABI',
    title: 'Pool',
    blurb:
      'Flat pool surface: swap/deposit/withdraw/view, the per-asset yield-hook surface (getAssetHook/hookDeploy/hookRecall), and the pool-scoped `admin*` entrypoints the Admin singleton calls into. One contract, no catch-all entrypoint.',
    mergeEventsFrom: ['IPool'],
    mergeErrorsFrom: ['Errors.sol/Err'],
  },
  {
    contract: 'IPoolHooks',
    file: 'IPoolHooks.ts',
    constName: 'POOL_HOOKS_ABI',
    title: 'IPoolHooks',
    blurb:
      'Per-asset yield-hook callback surface (preOutflow recall + postInflow deploy). Pool→hook direction. Flags: HOOK_PRE_OUTFLOW / HOOK_POST_INFLOW.',
  },
  {
    contract: 'PoolFactory',
    file: 'PoolFactory.ts',
    constName: 'POOL_FACTORY_ABI',
    title: 'PoolFactory',
    blurb: 'EIP-1167 minimal-clone factory for pool instances.',
  },
  {
    contract: 'ExternalOracle',
    file: 'ExternalOracle.ts',
    constName: 'EXTERNAL_ORACLE_ABI',
    title: 'ExternalOracle',
    blurb:
      'Signed external oracle. batchPushSigned carries NXR-signed (price, sigma, confidence, sourceTs); guardian fast-freeze via pauseFeed/revokeSigner/narrowMaxDeviation/cancelSignerGrant/cancelFeedWiden. updateFeed is TIGHTEN-ONLY: widening maxDeviation/ttl goes requestFeedWiden -> the BASE tier of GOV_DELAYS -> executeFeedWiden (guardian-vetoable).',
  },
  {
    contract: 'Flash',
    file: 'Flash.ts',
    constName: 'FLASH_ABI',
    title: 'Flash',
    blurb: 'Singleton flash loan / flash account module.',
  },
  {
    contract: 'AccessControl',
    root: 'shared',
    file: 'AccessControl.ts',
    constName: 'ACCESS_CONTROL_ABI',
    title: 'AccessControl',
    blurb:
      'Singleton AccessControl: governance SSoT (owner / treasuryOwner / treasury / swapper / factory / staking / keepers / guardians / risk stewards). Quorum policy: armQuorumPolicy latches ceil(2n/3) on admin principals and guardianQuorumMax on guardians; quorumStatus is the drift monitor.',
  },
  {
    contract: 'StakedAsset',
    root: 'shared',
    file: 'StakedAsset.ts',
    constName: 'STAKED_ASSET_ABI',
    title: 'StakedAsset',
    blurb: 'ERC-20 staking receipt (sToken) minted/burned by the Staking singleton.',
  },
  {
    contract: 'Staking',
    root: 'shared',
    file: 'Staking.ts',
    constName: 'STAKING_ABI',
    title: 'Staking',
    blurb: 'Gov + LP staking singleton.',
  },
  {
    contract: 'Distributor',
    root: 'shared',
    file: 'Distributor.ts',
    constName: 'DISTRIBUTOR_ABI',
    title: 'Distributor',
    blurb: 'Rewards distributor singleton.',
  },
  {
    contract: 'GovToken',
    root: 'shared',
    file: 'GovToken.ts',
    constName: 'GOV_TOKEN_ABI',
    title: 'GovToken',
    blurb: 'Governance token.',
  },
  {
    contract: 'Bridge',
    root: 'shared',
    file: 'Bridge.ts',
    constName: 'BRIDGE_ABI',
    title: 'Bridge',
    blurb: 'Cross-chain bridge endpoint.',
  },
  {
    contract: 'BridgeableERC20',
    root: 'shared',
    file: 'BridgeableERC20.ts',
    constName: 'BRIDGEABLE_ERC20_ABI',
    title: 'BridgeableERC20',
    blurb: 'Bridge-wrapped ERC20 with permit.',
  },
  {
    contract: 'GovTreasury',
    root: 'shared',
    file: 'GovTreasury.ts',
    constName: 'GOV_TREASURY_ABI',
    title: 'GovTreasury',
    blurb:
      'Home-chain governance treasury (UUPS). Emissions/vesting/bridge/gov-token custody + salvage. Ops fee-collection carved out to OpsTreasury. UpgradeGate: request/execute/cancel + paused.',
  },
  {
    contract: 'OpsTreasury',
    root: 'shared',
    file: 'OpsTreasury.ts',
    constName: 'OPS_TREASURY_ABI',
    title: 'OpsTreasury',
    blurb:
      'Per-chain operations treasury (UUPS, IOpsTreasury). collectProtocolFees/fundDistributor/setDistributor/salvage + receive. UpgradeGate: request/execute/cancel + paused.',
  },
];

/** Pretty-print ABI JSON as TS object literal (single-quoted strings, unquoted keys). */
function abiToTs(abi: unknown[], indent = 0): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (Array.isArray(abi)) {
    if (abi.length === 0) return '[]';
    return `[\n${abi.map((v) => `${padInner}${abiToTs(v as never, indent + 1)}`).join(',\n')},\n${pad}]`;
  }
  if (abi && typeof abi === 'object') {
    const entries = Object.entries(abi as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, v]) => {
        const val =
          typeof v === 'string'
            ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
            : abiToTs(v as never, indent + 1);
        return `${padInner}${k}: ${val}`;
      })
      .join(',\n')},\n${pad}}`;
  }
  return String(abi);
}

for (const {
  contract,
  file,
  constName,
  title,
  blurb,
  root = 'dex',
  mergeEventsFrom,
  mergeErrorsFrom,
} of CONTRACTS) {
  const evmRoot = EVM_ROOTS[root];
  const artifactPath = resolve(evmRoot, `out/${contract}.sol/${contract}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: Array<Record<string, unknown>>;
  };
  let abi = artifact.abi;
  /** Merge entries of `kind` from the named artifacts, deduped by name. */
  const merge = (kind: 'event' | 'error', specs: string[] | undefined) => {
    if (!specs?.length) return;
    const have = new Set(abi.filter((e) => e.type === kind).map((e) => e.name as string));
    for (const spec of specs) {
      const rel = spec.includes('/') ? spec : `${spec}.sol/${spec}`;
      const src = JSON.parse(readFileSync(resolve(evmRoot, `out/${rel}.json`), 'utf8')) as {
        abi: Array<Record<string, unknown>>;
      };
      const missing = src.abi.filter((e) => e.type === kind && !have.has(e.name as string));
      for (const e of missing) have.add(e.name as string);
      abi = [...abi, ...missing];
    }
  };
  merge('event', mergeEventsFrom);
  merge('error', mergeErrorsFrom);
  const header = `/**
 * ${title} Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * ${blurb}
 * Source: ${root}/evm out/ — regen via bun scripts/regen-dex-abis.ts
 */

export const ${constName} = ${abiToTs(abi)};
`;
  writeFileSync(resolve(ABI_DIR, file), header);
  console.log(`wrote ${file} (${abi.length} entries)`);
}
