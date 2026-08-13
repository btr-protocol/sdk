import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEPOLIA_BTR,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_ORACLE_FEEDS,
  SEPOLIA_STABLE_SYMBOLS,
  SEPOLIA_TOKENS,
  SEPOLIA_VOLATILE_SYMBOLS,
  sepoliaFeedByName,
  sepoliaFeedId,
} from '../src/venues/sepolia';
import { DEPLOYED_VENUES } from '../src/venues/deployments.generated';

/**
 * The oracle feed table is a money-path identity map, and its ARRAY POSITION is the on-chain
 * `feedIds[]` index that every NXR-signed record carries. A wrong entry relays one asset's mark
 * under another's name; a wrong position binds a signed quote to the wrong feed entirely.
 *
 * So the order is not asserted against a copy of itself — it is re-derived from dex's own deploy
 * inputs (`sepolia-risk-params.json`) in the same way the deploy scripts consume them.
 */
const DEX_EVM = resolve(import.meta.dir, '../../dex/evm');
const RISK = resolve(DEX_EVM, 'deployments/sepolia-risk-params.json');
const DEPLOY = resolve(DEX_EVM, 'deployments/11155111.deploy.json');

describe('sepolia oracle feed table', () => {
  test('feedIds are unique — a duplicate would alias two assets to one mark', () => {
    const ids = SEPOLIA_ORACLE_FEEDS.map((f) => f.feedId.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('on-chain names are unique — `name` is the only safe feed-level key', () => {
    const names = SEPOLIA_ORACLE_FEEDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('carries the USDC-USD base-depeg reference', () => {
    // Pricing._denominate divides every usdQuoted asset by this feed, so its absence is not
    // cosmetic. There is no USDC/USDC identity feed: the base's own mark IS this reference.
    const ref = sepoliaFeedByName('USDC-USD');
    expect(ref).not.toBeNull();
    expect(sepoliaFeedByName('USDC-USDC')).toBeNull();
  });

  test('token-symbol lookup resolves USDC to the signed USD reference', () => {
    expect(sepoliaFeedId('USDC')).toBe(sepoliaFeedByName('USDC-USD')!.feedId);
  });

  // dex is a sibling repo; an sdk-only checkout cannot re-derive. Skip loudly rather than vanish.
  const haveDex = existsSync(RISK) && existsSync(DEPLOY);
  const derive = haveDex ? test : test.skip;

  derive('order and feedIds re-derive from dex deploy inputs', () => {
    const risk = JSON.parse(readFileSync(RISK, 'utf8')) as { fxPool: string[] };
    const deploy = JSON.parse(readFileSync(DEPLOY, 'utf8')) as Record<string, string>;

    // addFeed order, exactly as the scripts issue it:
    //  1. SepoliaOracleDeploy._syms() — the market legs, in that literal's order.
    //  2. the signed USDC/USD reference, added immediately after that loop.
    //  3. SepoliaPoolDeploy.addFxFeeds() — the fxPool legs that do not already have a feed.
    const oracleScript = readFileSync(resolve(DEX_EVM, 'script/SepoliaOracleDeploy.s.sol'), 'utf8');
    const symsBody = /function _syms\(\)[^{]*\{\s*s = \[([^\]]*)\]/.exec(oracleScript);
    expect(symsBody).not.toBeNull();
    const market = [...symsBody![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const fxNew = risk.fxPool.filter((s) => s !== 'USDC' && !market.includes(s));
    const expected = [...market.map((s) => `${s}-USDC`), 'USDC-USD', ...fxNew.map((s) => `${s}-USDC`)];

    expect(SEPOLIA_ORACLE_FEEDS.map((f) => f.name)).toEqual(expected);

    // feedId = keccak(asset, quote), recorded per symbol by the deploy scripts.
    for (const [idx, f] of SEPOLIA_ORACLE_FEEDS.entries()) {
      const key = f.name === 'USDC-USD' ? 'feed_USDC-USD' : `feed_${f.symbol}`;
      expect({ idx, name: f.name, feedId: f.feedId.toLowerCase() }).toEqual({
        idx,
        name: f.name,
        feedId: deploy[key]!.toLowerCase(),
      });
    }
  });
});

/**
 * `sepolia.ts` and `deployments.generated.ts` both carry the Sepolia addresses: the first is
 * hand-authored because it also holds facts no deployment record has (NXR pair names, market
 * sessions, ref marks) and the front imports it by name; the second is generated from the
 * broadcast record and is what the chain-parameterised registry resolves. Two copies of an
 * address set drift, and the drift is silent, so it is pinned here rather than trusted.
 */
describe('sepolia.ts agrees with the generated deployment record', () => {
  const gen = DEPLOYED_VENUES[SEPOLIA_CHAIN_ID]!;
  const same = (a: string | undefined, b: string | undefined) => a?.toLowerCase() === b?.toLowerCase();

  test('the chain is in the generated record at all', () => {
    expect(gen).toBeDefined();
    expect(gen.chainId).toBe(SEPOLIA_CHAIN_ID);
  });

  test('every hand-authored token address matches the broadcast record', () => {
    for (const [sym, addr] of Object.entries(SEPOLIA_TOKENS)) {
      expect(same(addr, gen.tokens[sym]), `${sym}`).toBe(true);
    }
  });

  test('every hand-authored feed id matches the broadcast record', () => {
    for (const f of SEPOLIA_ORACLE_FEEDS) {
      expect(same(f.feedId, gen.feedIds[f.name]), f.name).toBe(true);
    }
  });

  test('the singletons the bots resolve match the broadcast record', () => {
    for (const key of ['oracle', 'refOracle', 'poolFactory', 'flash', 'faucet'] as const) {
      expect(same(SEPOLIA_BTR[key], gen.contracts[key]), key).toBe(true);
    }
  });

  test('pool rosters match, and the undeployed FX core is in neither', () => {
    const byTag = Object.fromEntries(gen.pools.map((p) => [p.tag, p]));
    expect(same(SEPOLIA_BTR.stablePool, byTag['btr-stable']?.address)).toBe(true);
    expect(same(SEPOLIA_BTR.volatilePool, byTag['btr-volatile']?.address)).toBe(true);
    expect(byTag['btr-stable']!.symbols).toEqual([...SEPOLIA_STABLE_SYMBOLS]);
    expect(byTag['btr-volatile']!.symbols).toEqual([...SEPOLIA_VOLATILE_SYMBOLS]);
    expect(SEPOLIA_BTR.fxPool).toBeUndefined();
    expect(byTag['btr-fx']).toBeUndefined();
  });
});
