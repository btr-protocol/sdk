/** Regenerate `src/venues/deployments.generated.ts` from the dex-evm deployment records.
 *
 *   BTR_DEX_EVM=../dex-evm bun scripts/gen-venues.ts
 *
 * Inputs per chain in `deployments/chains.json`: `<id>.deploy.json` (mark store: oracle, store,
 * feeds), `<id>.pools.json` (core singletons + one address per broadcast core) and
 * `<slug>.manifest.json` (tokens, scripted rosters). A chain whose `poolFactory` is zero or that
 * has no broadcast core is left out, so `chainVenue` keeps throwing for it. The output is
 * committed (a Docker build has no sibling); `test/venues-mirror.test.ts` fails when it drifts. */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';
import { CHAINS } from '../src/eth/chains';

type Venue = {
  chainId: number;
  contracts: Record<string, string>;
  tokens: Record<string, string>;
  symbols: Record<string, string>;
  decimals: Record<string, number>;
  feedIds: Record<string, string>;
  tickerIds: Record<string, string>;
  rosters: Record<string, string[]>;
  lp: Record<string, { code: string; name: string }>;
  pools: Array<{ tag: string; address: string; symbols: string[] }>;
  refFeeds: string[];
  libraries: Record<string, string>;
  roles: Record<string, string>;
  versions: Record<string, VenueVersion>;
};

/** One `<id>-<tag>.{deploy,pools}.json` pair: a generation other than `<id>.*`. Key-driven: every
 *  address-valued top-level key is kept, nothing is named here. */
type VenueVersion = {
  status: 'current' | 'superseded';
  contracts: Record<string, string>;
  roles: Record<string, string>;
  libraries: Record<string, string>;
  pools: Record<string, string>;
  receipts: Record<string, Record<string, string>>;
  hooks: Record<string, Record<string, string>>;
};

const ZERO = /^0x0{40}$/i;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
// Addresses that are people, not contracts: kept out of `contracts`.
const ROLES = new Set(['deployer', 'owner', 'guardian', 'treasury']);

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Chains dex-evm retired (`deployments/retired.json`, keys are chain ids): never generated, so a
 *  retired chain is absent from every served surface. Its records stay in dex as history. */
export function retiredChainIds(dexEvm: string): Set<number> {
  const p = join(dexEvm, 'deployments', 'retired.json');
  if (!existsSync(p)) return new Set();
  return new Set(Object.keys(read(p)).filter((k) => /^\d+$/.test(k)).map(Number));
}

/** Chains the SDK serves: a `CHAINS` row (src/eth/chains.ts) and not retired. The row is required
 *  because a dex-evm pin can record a chain the SDK has no row for; a CI pin that predates
 *  retired.json can still record a since-retired chain as its default, so retirement alone is not enough.
 *  The same set at every pin. */
export function servedChainIds(dexEvm: string): Set<number> {
  const retired = retiredChainIds(dexEvm);
  return new Set(
    Object.keys(CHAINS)
      .map(Number)
      .filter((id) => !retired.has(id)),
  );
}

/** Record key → router tag, back `registry::pool_tag` verbatim: `core` → `btr-core`,
 *  `<x>Pool` → `btr-<x>`, `<x>Core` → `btr-<x>-core`. Only manifest pool keys reach it, so
 *  back's contract-role exclusion has nothing to exclude here. */
export function poolTag(key: string): string | null {
  if (key === 'core') return 'btr-core';
  const m = /^([a-z][a-zA-Z0-9]*?)(Core|Pool)$/.exec(key);
  if (!m) return null;
  return m[2] === 'Core' ? `btr-${m[1]}-core` : `btr-${m[1]}`;
}

const live = (v: unknown): v is string => typeof v === 'string' && ADDR.test(v) && !ZERO.test(v);
const addrMap = (o: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((o && typeof o === 'object' ? o : {}) as Record<string, unknown>)
      .filter(([, v]) => live(v))
      .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, string]>,
  );
const nested = (rec: Record<string, unknown>, suffix: string) =>
  Object.fromEntries(
    Object.entries(rec)
      .filter(([k, v]) => k.endsWith(suffix) && v && typeof v === 'object')
      .map(([k, v]) => [k, addrMap(v)] as const),
  );

/** A generation's records, split by kind: addresses by key, role EOAs, libraries, core pools. */
function versionOf(deploy: Record<string, any>, pools: Record<string, any>, status: VenueVersion['status']): VenueVersion {
  const contracts: Record<string, string> = {};
  const roles: Record<string, string> = {};
  const pls: Record<string, string> = {};
  for (const rec of [pools, deploy])
    for (const [k, v] of Object.entries<unknown>(rec)) {
      if (!live(v) || /^[A-Z0-9]+$/.test(k)) continue; // token keys are upper-case
      if (ROLES.has(k)) roles[k] = v;
      else if (poolTag(k)) pls[k] = v;
      else contracts[k] = v;
    }
  const ref = deploy.derived?.referenceTierVerifier;
  if (live(ref)) contracts.verifierR = ref;
  const sort = (o: Record<string, string>) => addrMap(o);
  return {
    status,
    contracts: sort(contracts),
    roles: sort(roles),
    libraries: addrMap(pools.libraries),
    pools: sort(pls),
    receipts: nested(pools, 'Receipts'),
    hooks: nested(pools, 'Hooks'),
  };
}

/** Feed record key → on-chain feed name: spokes are `<SYM>-USDC`, the reference keeps its pair. */
const feedName = (k: string) => (k.includes('-') ? k : `${k}-USDC`);

export function venuesFromRecords(dexEvm: string): Record<number, Venue> {
  const dir = join(dexEvm, 'deployments');
  const slugs: Record<string, string> = read(join(dir, 'chains.json')).slugs;
  const served = servedChainIds(dexEvm);
  const out: Record<number, Venue> = {};
  for (const [id, slug] of Object.entries(slugs).sort(([a], [b]) => Number(a) - Number(b))) {
    if (!served.has(Number(id))) continue;
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
    const decimals: Record<string, number> = {};
    for (const [s, t] of Object.entries<{ addr: string; symbol: string; decimals: unknown }>(
      man.tokens,
    )) {
      if (s === '_doc') continue;
      if (typeof t.symbol !== 'string' || !t.symbol)
        throw new Error(`gen-venues: ${slug} manifest tokens.${s} lacks symbol`);
      // The deploy asserts these against the live ERC-20; clients pin them instead of trusting a read.
      if (
        !Number.isInteger(t.decimals) ||
        (t.decimals as number) < 0 ||
        (t.decimals as number) > 36
      )
        throw new Error(`gen-venues: ${slug} manifest tokens.${s} decimals ${t.decimals}`);
      tokens[s] = t.addr;
      symbols[s] = t.symbol;
      decimals[s] = t.decimals as number;
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
    const cur = versionOf(deploy, pools, 'current');
    const versions: Record<string, VenueVersion> = {};
    for (const f of readdirSync(dir).sort()) {
      const m = new RegExp(`^${id}-([A-Za-z0-9_.]+)\\.pools\\.json$`).exec(f);
      if (!m) continue;
      const vp = read(join(dir, f));
      if (Number(vp.chainId) !== Number(id)) continue;
      const vd = join(dir, `${id}-${m[1]}.deploy.json`);
      const v = versionOf(existsSync(vd) ? read(vd) : {}, vp, 'superseded');
      const same = v.contracts.poolFactory?.toLowerCase() === pools.poolFactory.toLowerCase();
      versions[m[1]] = { ...v, status: same ? 'current' : 'superseded' };
    }
    out[Number(id)] = {
      chainId: Number(id),
      contracts: { ...sortedContracts, ...(cur.contracts.verifierR ? { verifierR: cur.contracts.verifierR } : {}) },
      libraries: cur.libraries,
      roles: cur.roles,
      versions,
      tokens,
      symbols,
      decimals,
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

/** Chains the one deployment serves: every served slug whose manifest is not `class: "local"`, the
 *  default first, then ascending id. The default is `chains.json` `.default` when it is served, else
 *  the first served chain with a deployment record (a pin whose default has since retired). A new
 *  chain is its records, a slug row and a `CHAINS` row, no code. */
export function servedChains(dexEvm: string): Array<{ chainId: number; slug: string }> {
  const dir = join(dexEvm, 'deployments');
  const { slugs, default: dflt } = read(join(dir, 'chains.json'));
  const served = servedChainIds(dexEvm);
  const rows = Object.entries<string>(slugs)
    .filter(([id]) => served.has(Number(id)))
    .filter(([, slug]) => read(join(dir, `${slug}.manifest.json`)).chain.class !== 'local')
    .map(([id, slug]) => ({ chainId: Number(id), slug }));
  const live = new Set(Object.keys(venuesFromRecords(dexEvm)).map(Number));
  const lead = rows.some((r) => r.chainId === dflt)
    ? dflt
    : rows.find((r) => live.has(r.chainId))?.chainId;
  return rows.sort(
    (a, b) => Number(b.chainId === lead) - Number(a.chainId === lead) || a.chainId - b.chainId,
  );
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
  /** Token key ⇒ manifest \`tokens.<key>.decimals\`, asserted against the ERC-20 at deploy. The
   *  pin: a \`decimals()\` read that disagrees is refused, never applied. */
  decimals: Record<string, number>;
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
  /** Current generation's \`libraries\` (record key ⇒ address; linked into pools). */
  libraries: Record<string, Address>;
  /** Current generation's role addresses (deployer, owner, guardian, treasury): people, not code. */
  roles: Record<string, Address>;
  /** Other generations by record suffix (\`<id>-<tag>.pools.json\`, e.g. \`core\` = v1, \`v2\`).
   *  \`status\` is \`current\` iff its factory is the current one, else \`superseded\`. \`pools\` =
   *  core-pool address by record key, \`receipts\`/\`hooks\` = \`<key>Receipts\`/\`<key>Hooks\` maps. */
  versions: Record<
    string,
    {
      status: 'current' | 'superseded';
      contracts: Record<string, Address>;
      roles: Record<string, Address>;
      libraries: Record<string, Address>;
      pools: Record<string, Address>;
      receipts: Record<string, Record<string, Address>>;
      hooks: Record<string, Record<string, Address>>;
    }
  >;
}

export const DEPLOYED_VENUES: Record<number, ChainVenue> = `;

export function render(v: Record<number, Venue>, served: ReturnType<typeof servedChains>): string {
  return `${HEADER}${JSON.stringify(v, null, 2)};

/** Chains the deployment serves, default first (\`chains.json\`); live iff \`DEPLOYED_VENUES\` has a record. */
export const SERVED_CHAINS: ReadonlyArray<{ chainId: number; slug: string }> = ${JSON.stringify(served, null, 2)};
`;
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dexEvm = process.env.BTR_DEX_EVM ?? join(root, '..', 'dex-evm');
  if (!existsSync(join(dexEvm, 'deployments', 'chains.json'))) {
    console.log(`gen-venues: ${dexEvm}/deployments absent — keeping the committed table`);
    process.exit(0);
  }
  const out = join(root, 'src', 'venues', 'deployments.generated.ts');
  writeFileSync(out, render(venuesFromRecords(dexEvm), servedChains(dexEvm)));
  await $`bunx biome format --write ${out}`.cwd(root).quiet();
  console.log(`gen-venues: wrote ${out}`);
}
