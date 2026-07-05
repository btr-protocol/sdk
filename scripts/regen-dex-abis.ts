/**
 * One-shot: extract ABIs from dex/evm/out artifacts @ pinned commit → sdk/src/abis/*.ts
 * Usage: bun scratchpad/regen-dex-abis.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEX_EVM = resolve(import.meta.dir, '../../../dex/evm');
const ABI_DIR = resolve(import.meta.dir, '../src/abis');

const CONTRACTS: Array<{
  contract: string;
  file: string;
  constName: string;
  title: string;
  blurb: string;
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
  },
  {
    contract: 'PoolFactory',
    file: 'PoolFactory.ts',
    constName: 'POOL_FACTORY_ABI',
    title: 'PoolFactory',
    blurb: 'EIP-1167 minimal-clone factory for pool instances.',
  },
  {
    contract: 'Router',
    file: 'Router.ts',
    constName: 'ROUTER_ABI',
    title: 'Router',
    blurb: 'On-chain swap executor with min-out guards.',
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
    contract: 'Staking',
    file: 'Staking.ts',
    constName: 'STAKING_ABI',
    title: 'Staking',
    blurb: 'Gov + LP staking singleton.',
  },
  {
    contract: 'Distributor',
    file: 'Distributor.ts',
    constName: 'DISTRIBUTOR_ABI',
    title: 'Distributor',
    blurb: 'Rewards distributor singleton.',
  },
  {
    contract: 'GovToken',
    file: 'GovToken.ts',
    constName: 'GOV_TOKEN_ABI',
    title: 'GovToken',
    blurb: 'Governance token.',
  },
  {
    contract: 'Bridge',
    file: 'Bridge.ts',
    constName: 'BRIDGE_ABI',
    title: 'Bridge',
    blurb: 'Cross-chain bridge endpoint.',
  },
  {
    contract: 'BridgeableERC20',
    file: 'BridgeableERC20.ts',
    constName: 'BRIDGEABLE_ERC20_ABI',
    title: 'BridgeableERC20',
    blurb: 'Bridge-wrapped ERC20 with permit.',
  },
  {
    contract: 'Treasury',
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

for (const { contract, file, constName, title, blurb } of CONTRACTS) {
  const artifactPath = resolve(DEX_EVM, `out/${contract}.sol/${contract}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: unknown[] };
  const header = `/**
 * ${title} Contract ABI
 * @module @btr-protocol/sdk/abis
 *
 * ${blurb}
 * Source: dex/evm from dex/evm out/ — regen via \`bun scratchpad/regen-dex-abis.ts\`.
 */

export const ${constName} = ${abiToTs(artifact.abi)};
`;
  writeFileSync(resolve(ABI_DIR, file), header);
  console.log(`wrote ${file} (${artifact.abi.length} entries)`);
}
