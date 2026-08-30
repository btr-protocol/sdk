/**
 * Verify src/venues/sepolia.ts against the deployment SoT.
 *
 *   bun run scripts/verify-sepolia-venue.ts            # exit 1 on any drift
 *   DEX_DIR=/path/to/dex bun run scripts/verify-sepolia-venue.ts
 *
 * SoT = dex/evm/deployments/11155111.deploy.json (tokens + feed_<SYM>)
 *     + dex/evm/deployments/11155111.pools.json  (contracts + refFeeds)
 *
 * Run this after every Sepolia redeploy. `sepolia.ts` reads the generated record rather than
 * restating it, so what this proves is that the COMMITTED generation is current: it walks the
 * deployment JSON directly and re-checks chain id, every ERC20, every feed id, every contract and
 * that the pool rosters are feed-complete. `bun run gen:check` catches the same staleness, but
 * only where the forge artifacts are present; this needs the two JSON files and nothing else.
 *
 * NOT checked, because it is not in the deployment: `nxrSymbol`. That is the NX Rates pair name,
 * declared once in `src/venues/nxr.ts NXR_MARKS`: the deploy JSON has no idea what NXR calls a
 * pair. Verify that against NXR REST, with the EXPLICIT pair.
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

const DEX = process.env.DEX_DIR || join(import.meta.dir, '../../dex-evm');
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

for (const [name, d] of [
  ['deploy', deploy],
  ['pools', pools],
] as const) {
  if (Number(d.chainId) !== SEPOLIA_CHAIN_ID) {
    fail(`${name}.json chainId ${d.chainId} != SEPOLIA_CHAIN_ID ${SEPOLIA_CHAIN_ID}`);
  }
}

// 1. ERC20s.
for (const [sym, addr] of Object.entries(SEPOLIA_TOKENS)) eq(`token ${sym}`, addr, deploy[sym]);

// 2. Contracts (pools.json is the superset; deploy.json repeats `oracle`). A key resolving to
// undefined is a core that is scripted but not broadcast (`fxPool`), which is a state the venue
// declares on purpose, not drift: there is nothing in the SoT to compare it against.
for (const [key, addr] of Object.entries(SEPOLIA_BTR)) {
  if (addr !== undefined) eq(`contract ${key}`, addr, pools[key] ?? deploy[key]);
}

// 3. Feed ids + token cross-reference.
const seen = new Set<string>();
for (const f of SEPOLIA_ORACLE_FEEDS) {
  seen.add(f.symbol);
  const feedKey = f.name === 'USDC-USD' ? 'feed_USDC-USD' : `feed_${f.symbol}`;
  eq(`feed ${f.name}`, f.feedId, deploy[feedKey]);
  eq(`feed ${f.name} token`, f.token, SEPOLIA_TOKENS[f.symbol]);
  if (f.name !== 'USDC-USD' && f.name !== `${f.symbol}-USDC`) {
    fail(`feed ${f.symbol}: name '${f.name}' != '${f.symbol}-USDC'`);
  }
}

// 4. Every pool asset must have a feed, or the AIMM cannot mark it.
for (const sym of new Set([
  ...SEPOLIA_STABLE_SYMBOLS,
  ...SEPOLIA_VOLATILE_SYMBOLS,
  ...SEPOLIA_FX_SYMBOLS,
])) {
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
