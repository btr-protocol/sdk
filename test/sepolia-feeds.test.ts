import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEPOLIA_BTR,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_FX_SYMBOLS,
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
    const expected = [
      ...market.map((s) => `${s}-USDC`),
      'USDC-USD',
      ...fxNew.map((s) => `${s}-USDC`),
    ];

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
 * `sepolia.ts` READS `deployments.generated.ts`; it no longer restates any of it, so an address
 * comparison between the two would compare a value with itself. What is still worth pinning is
 * that the naming layer resolves completely: a roster symbol with no token or no feed, or a
 * singleton the bots resolve that the record does not carry, would surface as `undefined` at a
 * call site rather than as an error here.
 */
describe('sepolia.ts resolves completely against the generated record', () => {
  const gen = DEPLOYED_VENUES[SEPOLIA_CHAIN_ID]!;

  test('the chain is in the generated record at all', () => {
    expect(gen).toBeDefined();
    expect(gen.chainId).toBe(SEPOLIA_CHAIN_ID);
  });

  test('every feed resolves a token and a name of the documented shape', () => {
    for (const f of SEPOLIA_ORACLE_FEEDS) {
      expect(f.token, f.name).toBeDefined();
      expect(f.name).toBe(f.symbol === 'USDC' ? 'USDC-USD' : `${f.symbol}-USDC`);
    }
  });

  test('every scripted roster symbol has a token and a feed', () => {
    const feeds = new Set(SEPOLIA_ORACLE_FEEDS.map((f) => f.symbol));
    const roster = new Set([
      ...SEPOLIA_STABLE_SYMBOLS,
      ...SEPOLIA_VOLATILE_SYMBOLS,
      ...SEPOLIA_FX_SYMBOLS,
    ]);
    expect(
      [...roster].filter((s) => !SEPOLIA_TOKENS[s]),
      'untokened',
    ).toEqual([]);
    expect(
      [...roster].filter((s) => !feeds.has(s)),
      'unmarked',
    ).toEqual([]);
  });

  test('the singletons the bots resolve are all present', () => {
    for (const key of ['oracle', 'refOracle', 'poolFactory', 'flash', 'faucet'] as const) {
      expect(SEPOLIA_BTR[key], key).toBeDefined();
    }
  });

  test('the FX core is scripted but not deployed, so it can never reach the router', () => {
    expect(SEPOLIA_FX_SYMBOLS.length).toBeGreaterThan(0);
    expect(SEPOLIA_BTR.fxPool).toBeUndefined();
    expect(gen.pools.some((p) => p.tag === 'btr-fx')).toBe(false);
  });
});
