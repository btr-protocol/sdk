/**
 * Verify src/venues/sepolia.ts against the deployment SoT.
 *
 *   bun run scripts/verify-sepolia-venue.ts            # exit 1 on any drift
 *   DEX_DIR=/path/to/dex bun run scripts/verify-sepolia-venue.ts
 *
 * SoT = dex/evm/deployments/11155111.deploy.json (tokens + feed_<SYM>)
 *     + dex/evm/deployments/11155111.pools.json  (contracts + refFeeds)
 *
 * Run this after every Sepolia redeploy. It checks everything derivable from the
 * deployment: chain id, every ERC20 address, every feed id, every contract address,
 * and that the stable/volatile symbol sets are feed-complete.
 *
 * NOT checked, because it is not in the deployment: `nxrSymbol`. That is the NX Rates
 * pair name (stables→`X-USD` proxy, WETH→ETH-USDC, FX→`X-USD`), owned here on purpose —
 * the deploy JSON has no idea what NXR calls a pair. Edit it by hand; verify against NXR REST.
 */

import { join } from 'node:path';
import {
  SEPOLIA_BTR,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_FX_SYMBOLS,
  SEPOLIA_ORACLE_FEEDS,
  SEPOLIA_STABLE_SYMBOLS,
  SEPOLIA_TOKENS,
  SEPOLIA_VOLATILE_SYMBOLS,
} from '../src/venues/sepolia.js';

const DEX = process.env.DEX_DIR || join(import.meta.dir, '../../dex');
const DEPLOYMENTS = join(DEX, 'evm/deployments');

const errs: string[] = [];
const fail = (m: string) => errs.push(m);
const eq = (what: string, got: string | undefined, want: string | undefined) => {
  if (!want) return fail(`${what}: absent from deployment SoT`);
  if (!got) return fail(`${what}: absent from sdk`);
  if (got.toLowerCase() !== want.toLowerCase()) fail(`${what}: sdk ${got} != SoT ${want}`);
};

const deploy = await Bun.file(join(DEPLOYMENTS, '11155111.deploy.json')).json();
const pools = await Bun.file(join(DEPLOYMENTS, '11155111.pools.json')).json();

for (const [name, d] of [['deploy', deploy], ['pools', pools]] as const) {
  if (Number(d.chainId) !== SEPOLIA_CHAIN_ID) {
    fail(`${name}.json chainId ${d.chainId} != SEPOLIA_CHAIN_ID ${SEPOLIA_CHAIN_ID}`);
  }
}

// 1. ERC20s.
for (const [sym, addr] of Object.entries(SEPOLIA_TOKENS)) eq(`token ${sym}`, addr, deploy[sym]);

// 2. Contracts (pools.json is the superset; deploy.json repeats `oracle`).
for (const [key, addr] of Object.entries(SEPOLIA_BTR)) {
  eq(`contract ${key}`, addr, pools[key] ?? deploy[key]);
}

// 3. Feed ids + token cross-reference.
const seen = new Set<string>();
for (const f of SEPOLIA_ORACLE_FEEDS) {
  seen.add(f.symbol);
  eq(`feed ${f.symbol}`, f.feedId, deploy[`feed_${f.symbol}`]);
  eq(`feed ${f.symbol} token`, f.token, SEPOLIA_TOKENS[f.symbol]);
  if (f.name !== `${f.symbol}-USDC`) fail(`feed ${f.symbol}: name '${f.name}' != '${f.symbol}-USDC'`);
}

// 4. Every pool asset must have a feed, or the AIMM cannot mark it.
for (const sym of new Set([...SEPOLIA_STABLE_SYMBOLS, ...SEPOLIA_VOLATILE_SYMBOLS, ...SEPOLIA_FX_SYMBOLS])) {
  if (!seen.has(sym)) fail(`pool asset ${sym}: no entry in SEPOLIA_ORACLE_FEEDS`);
  if (!SEPOLIA_TOKENS[sym]) fail(`pool asset ${sym}: no entry in SEPOLIA_TOKENS`);
}

// 5. Advisory: feeds in the deployment the sdk does not expose (e.g. the USDC-USD
// reference feed, which is not a pool asset). Reported, not fatal.
const extra = Object.keys(deploy)
  .filter((k) => k.startsWith('feed_'))
  .map((k) => k.slice(5))
  .filter((s) => !seen.has(s));

console.log(
  `sepolia venue: ${Object.keys(SEPOLIA_TOKENS).length} tokens, ` +
    `${Object.keys(SEPOLIA_BTR).length} contracts, ${SEPOLIA_ORACLE_FEEDS.length} feeds checked`,
);
if (extra.length) console.log(`note: deployment feeds not exposed by sdk: ${extra.join(', ')}`);
if (errs.length) {
  console.error(`\nDRIFT (${errs.length}):`);
  for (const e of errs) console.error(`  ${e}`);
  process.exit(1);
}
console.log('OK — sdk matches deployment SoT');
