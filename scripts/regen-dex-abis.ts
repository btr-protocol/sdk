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
  /** Extra interface artifact(s) whose EVENT entries get merged in (dedup by name). Needed when an
   *  event is declared on an interface but only ever EMITTED from a library the contract calls into —
   *  solc's ABI generator doesn't pick up library-emitted events unless the contract itself `is` the
   *  declaring interface, so they're silently absent from the contract's own artifact (GATE-06: Pool's
   *  Swapped/BatchSwapped/Deposited/Withdrawn/LiabilitySwapped/Donated all hit this). */
  mergeEventsFrom?: string[];
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
    blurb: 'Flat pool surface (swap/deposit/withdraw/view). Admin ops live on Admin singleton.',
    mergeEventsFrom: ['IPool'],
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
      'Push-based external oracle. pushFeed/batchPush carry (price, sigma, confidence); getEma = rate-clamped reference.',
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
      'Singleton AccessControl — governance SSoT (owner / treasury / swapper / factory / keepers).',
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
    contract: 'Treasury',
    root: 'shared',
    file: 'Treasury.ts',
    constName: 'TREASURY_ABI',
    title: 'Treasury',
    blurb: 'Protocol treasury singleton.',
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
} of CONTRACTS) {
  const evmRoot = EVM_ROOTS[root];
  const artifactPath = resolve(evmRoot, `out/${contract}.sol/${contract}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
    abi: Array<Record<string, unknown>>;
  };
  let abi = artifact.abi;
  if (mergeEventsFrom?.length) {
    const have = new Set(abi.filter((e) => e.type === 'event').map((e) => e.name as string));
    for (const ifaceName of mergeEventsFrom) {
      const ifacePath = resolve(evmRoot, `out/${ifaceName}.sol/${ifaceName}.json`);
      const iface = JSON.parse(readFileSync(ifacePath, 'utf8')) as {
        abi: Array<Record<string, unknown>>;
      };
      const missing = iface.abi.filter((e) => e.type === 'event' && !have.has(e.name as string));
      for (const e of missing) have.add(e.name as string);
      abi = [...abi, ...missing];
    }
  }
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
