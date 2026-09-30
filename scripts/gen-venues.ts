/** Regenerate `src/venues/deployments.generated.ts` from the dex-evm deployment records.
 *
 *   BTR_DEX_EVM=../dex-evm bun scripts/gen-venues.ts
 *
 * Inputs per chain in `deployments/chains.json`: `<id>.deploy.json` (mark store: oracle, store,
 * feeds), `<id>.pools.json` (core singletons + one address per broadcast core) and
 * `<slug>.manifest.json` (tokens, scripted rosters). A chain whose `poolFactory` is zero or that
 * has no broadcast core is left out, so `chainVenue` keeps throwing for it. The output is
 * committed (a Docker build has no sibling); `test/venues-mirror.test.ts` fails when it drifts. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

type Venue = {
  chainId: number;
  contracts: Record<string, string>;
  tokens: Record<string, string>;
  symbols: Record<string, string>;
  feedIds: Record<string, string>;
  tickerIds: Record<string, string>;
  rosters: Record<string, string[]>;
  lp: Record<string, { code: string; name: string }>;
  pools: Array<{ tag: string; address: string; symbols: string[] }>;
  refFeeds: string[];
};

const ZERO = /^0x0{40}$/i;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
// Addresses that are people, not contracts: kept out of `contracts`.
const ROLES = new Set(['deployer', 'owner', 'guardian', 'treasury']);

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Record key → router tag, back `registry::pool_tag` verbatim: `core` → `btr-core`,
 *  `<x>Pool` → `btr-<x>`, `<x>Core` → `btr-<x>-core`. Only manifest pool keys reach it, so
 *  back's contract-role exclusion has nothing to exclude here. */
export function poolTag(key: string): string | null {
  if (key === 'core') return 'btr-core';
  const m = /^([a-z][a-zA-Z0-9]*?)(Core|Pool)$/.exec(key);
  if (!m) return null;
  return m[2] === 'Core' ? `btr-${m[1]}-core` : `btr-${m[1]}`;
}

/** Feed record key → on-chain feed name: spokes are `<SYM>-USDC`, the reference keeps its pair. */
const feedName = (k: string) => (k.includes('-') ? k : `${k}-USDC`);

export function venuesFromRecords(dexEvm: string): Record<number, Venue> {
  const dir = join(dexEvm, 'deployments');
  const slugs: Record<string, string> = read(join(dir, 'chains.json')).slugs;
  const out: Record<number, Venue> = {};
  for (const [id, slug] of Object.entries(slugs).sort(([a], [b]) => Number(a) - Number(b))) {
    const [dp, pp, mp] = [`${id}.deploy.json`, `${id}.pools.json`, `${slug}.manifest.json`].map(
      (f) => join(dir, f),
    );
    if (![dp, pp, mp].every(existsSync)) continue;
    const deploy = read(dp);
    const pools = read(pp);
    const man = read(mp);
    if (!ADDR.test(pools.poolFactory ?? '') || ZERO.test(pools.poolFactory)) continue;
    if (Number(deploy.chainId) !== Number(id) || Number(pools.chainId) !== Number(id))
      throw new Error(`gen-venues: ${id} records name chain ${deploy.chainId}/${pools.chainId}`);

    const coreKeys = Object.keys(man.pools).filter((k) => poolTag(k));
    const tokens: Record<string, string> = {};
    const symbols: Record<string, string> = {};
    for (const [s, t] of Object.entries<{ addr: string; symbol: string }>(man.tokens)) {
      if (s === '_doc') continue;
      if (typeof t.symbol !== 'string' || !t.symbol)
        throw new Error(`gen-venues: ${slug} manifest tokens.${s} lacks symbol`);
      tokens[s] = t.addr;
      symbols[s] = t.symbol;
    }

    const contracts: Record<string, string> = {};
    for (const rec of [pools, deploy])
      for (const [k, v] of Object.entries(rec))
        if (typeof v === 'string' && ADDR.test(v) && !ZERO.test(v) && !ROLES.has(k))
          if (!(k in tokens) && !coreKeys.includes(k)) {
            if (contracts[k] && contracts[k].toLowerCase() !== v.toLowerCase())
              throw new Error(`gen-venues: ${id} records disagree on ${k}`);
            contracts[k] = v;
          }
    const sortedContracts = Object.fromEntries(
      Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b)),
    );

    const feeds = Object.entries<{ feedId: string; globalIndex: number }>(deploy.feeds ?? {}).sort(
      ([, a], [, b]) => a.globalIndex - b.globalIndex,
    );
    const feedIds: Record<string, string> = {};
    const tickerIds: Record<string, string> = {};
    for (const [k, f] of feeds) {
      feedIds[feedName(k)] = f.feedId;
      tickerIds[feedName(k)] = BigInt(f.feedId).toString();
    }

    const rosters: Record<string, string[]> = {};
    const lp: Venue['lp'] = {};
    const live: Venue['pools'] = [];
    const refFeeds: string[] = [];
    for (const k of coreKeys) {
      const tag = poolTag(k)!;
      const assets: string[] = man.pools[k].assets;
      rosters[tag] = assets;
      const { code, name } = man.pools[k];
      if (typeof code !== 'string' || !code || typeof name !== 'string' || !name)
        throw new Error(`gen-venues: ${slug} manifest pools.${k} lacks code/name`);
      lp[tag] = { code, name };
      const addr = pools[k];
      if (typeof addr !== 'string' || !ADDR.test(addr) || ZERO.test(addr)) continue;
      for (const s of assets)
        if (!tokens[s]) throw new Error(`gen-venues: ${k} lists ${s}, no token`);
      live.push({ tag, address: addr, symbols: assets });
      for (const s of pools[`${k}RefFeeds`] ?? [])
        if (!refFeeds.includes(feedName(s))) refFeeds.push(feedName(s));
    }
    if (live.length === 0) continue;
    out[Number(id)] = {
      chainId: Number(id),
      contracts: sortedContracts,
      tokens,
      symbols,
      feedIds,
      tickerIds,
      rosters,
      lp,
      pools: live,
      refFeeds,
    };
  }
  return out;
}

const HEADER = `// GENERATED by \`bun scripts/gen-venues.ts\` from dex-evm/deployments/<chainId>.{deploy,pools}.json
// + <slug>.manifest.json. Do not edit: fix the record and regenerate.

/**
 * Deployed BTR venues, keyed by chain id
 * @module @btr-protocol/sdk/venues
 *
 * A chain with no broadcast core is ABSENT, and \`registry.ts\` throws on an absent chain rather
 * than falling back, so a bot pointed at a chain BTR is not deployed on cannot silently quote
 * another chain's addresses.
 */

import type { Address, Hex } from '../eth/types.js';

export interface ChainVenue {
  chainId: number;
  /** Every top-level non-role, non-token, non-core address in the records, by record key
   *  (nested \`libraries\` and \`<key>Receipts\` are not venues). P8 aliases are the design: the
   *  factory is \`oracle\` = \`poolFactory\` = \`verifierP\` and serves both tiers (no \`refOracle\`),
   *  \`store\` = \`poolImpl\`. \`verifierR\` is the reference tier's derived EIP-712 verifyingContract
   *  (\`MarkStoreBase.tierVerifier\`): no code. */
  contracts: Record<string, Address>;
  /** Manifest tokens by symbol. The hub (roster index 0) is the base of every core. */
  tokens: Record<string, Address>;
  /** Token key ⇒ manifest \`tokens.<key>.symbol\`, the listed SYM in the LP receipt (\`USDCB\` ⇒ \`USDC\`). */
  symbols: Record<string, string>;
  /** On-chain feed name (\`USDT-USDC\`, \`USDC-USD\`) ⇒ feedId, in globalIndex order. */
  feedIds: Record<string, Hex>;
  /** Same keys ⇒ MITCH tickerId (decimal string; feedId = bytes32(ticker)). */
  tickerIds: Record<string, string>;
  /** Pool tag ⇒ the symbols the manifest scripts for that core, broadcast or not. */
  rosters: Record<string, string[]>;
  /** Pool tag ⇒ manifest \`pools.<key>.{code,name}\`, input of \`lpToken\`. */
  lp: Record<string, { code: string; name: string }>;
  /** Broadcast cores only: the routable set. */
  pools: Array<{ tag: string; address: Address; symbols: string[] }>;
  /** Feed names read off the reference tier, union of every core's \`<key>RefFeeds\`. */
  refFeeds: string[];
}

export const DEPLOYED_VENUES: Record<number, ChainVenue> = `;

export function render(v: Record<number, Venue>): string {
  return `${HEADER}${JSON.stringify(v, null, 2)};\n`;
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dexEvm = process.env.BTR_DEX_EVM ?? join(root, '..', 'dex-evm');
  if (!existsSync(join(dexEvm, 'deployments', 'chains.json'))) {
    console.log(`gen-venues: ${dexEvm}/deployments absent — keeping the committed table`);
    process.exit(0);
  }
  const out = join(root, 'src', 'venues', 'deployments.generated.ts');
  writeFileSync(out, render(venuesFromRecords(dexEvm)));
  await $`bunx biome format --write ${out}`.cwd(root).quiet();
  console.log(`gen-venues: wrote ${out}`);
}
