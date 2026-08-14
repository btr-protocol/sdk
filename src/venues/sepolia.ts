// Sepolia (chainId 11155111) BTR DEX venue.
//
// Nothing here is a table. Every address, feed id, roster and ordinal is READ from
// `deployments.generated.ts` — the broadcast record of `dex/evm/deployments/11155111.{deploy,
// pools}.json` plus `sepolia-risk-params.json` — and every mark source is read from `NXR_MARKS`.
// This module is the chain-specific NAMING of those two, kept because the front and the ceremony
// scripts import Sepolia by name; it is not a second copy of either, and a redeploy reaches it
// through `bun run gen` alone.

import type { Address } from '../eth/types.js';
import { DEPLOYED_VENUES } from './deployments.generated.js';
import { type MarketSession, nxrMark } from './nxr.js';

export const SEPOLIA_CHAIN_ID = 11155111;
/** Ingest start block. MUST be at or below the first pool log. Not a deployment fact: the record
 *  carries no block, and the collector needs a floor to backfill from. */
export const SEPOLIA_DEPLOY_BLOCK = 11340000;

/** Reading the record is the only way in, so an absence is named at module load rather than
 *  surfacing as `undefined` at a call site that then quotes or signs against nothing. */
function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) {
    throw new Error(
      `sepolia deployment record carries no ${what} — re-run \`bun run gen\` in sdk/`,
    );
  }
  return v;
}

const V = need(DEPLOYED_VENUES[SEPOLIA_CHAIN_ID], `chain ${SEPOLIA_CHAIN_ID}`);

/** Pool asset ERC20s. Keyed by canonical symbol. */
export const SEPOLIA_TOKENS: Record<string, Address> = V.tokens;

/** Pool rosters as SCRIPTED, so the FX core is listed here while its address is still undefined. */
export const SEPOLIA_STABLE_SYMBOLS: readonly string[] = need(
  V.rosters['btr-stable'],
  'btr-stable roster',
);
export const SEPOLIA_VOLATILE_SYMBOLS: readonly string[] = need(
  V.rosters['btr-volatile'],
  'btr-volatile roster',
);
export const SEPOLIA_FX_SYMBOLS: readonly string[] = need(V.rosters['btr-fx'], 'btr-fx roster');

const poolAt = (tag: string): Address | undefined => V.pools.find((p) => p.tag === tag)?.address;

export const SEPOLIA_BTR = {
  ...V.contracts,
  stablePool: need(poolAt('btr-stable'), 'deployed btr-stable pool'),
  volatilePool: need(poolAt('btr-volatile'), 'deployed btr-volatile pool'),
  /**
   * FX core: DECLARED BUT NOT DEPLOYED. `sepolia-risk-params.json` scripts the roster
   * (`SEPOLIA_FX_SYMBOLS`) and `SepoliaPoolDeploy.s.sol deployFxPool()` can build it, but
   * `11155111.pools.json` carries no `fxPool`, so the generated record has no `btr-fx` pool and
   * this resolves to `undefined`. An older broadcast holds 0x18c7376A4F9B3C3fb8A0A33fAf3c55aD225CB229;
   * that is a stale artifact of a superseded run and must NOT be pinned here, because pointing the
   * router at a pool the current fleet does not own is worse than having no FX route.
   *
   * Typed `Address | undefined` rather than omitted so consumers get "not deployed yet, handle it"
   * instead of "this key does not exist". It fills itself in the day the ceremony records it.
   */
  fxPool: poolAt('btr-fx'),
};

export interface SepoliaFeed {
  name: string;
  feedId: `0x${string}`;
  nxrSymbol: string;
  nxrQuote?: string;
  quoteVia?: string;
  token: Address;
  symbol: string;
  session?: MarketSession;
}

/**
 * ARRAY POSITION IS THE ON-CHAIN `feedIds[]` INDEX — the idx every NXR-signed record carries.
 *
 * Neither the order nor the ids are stated here: `deployments.generated.ts` keys `feedIds` by name
 * in ordinal order, which `scripts/gen.ts` derives by replaying the deploy scripts against dex's
 * own risk-params and refuses to emit unless the replay reproduces the recorded feed set. The NXR
 * pair, its served reciprocal and its market session come from `NXR_MARKS`, so an asset's mark
 * source is stated once and a symbol with no row there is a hard error at module load.
 */
export const SEPOLIA_ORACLE_FEEDS: SepoliaFeed[] = Object.entries(V.feedIds).map(
  ([name, feedId]) => {
    // Feed names are `<symbol>-<quote>`; the base carries `USDC-USD`, its signed depeg reference,
    // because there is no `USDC/USDC` identity feed.
    const symbol = name.slice(0, name.lastIndexOf('-'));
    const m = nxrMark(symbol);
    if (!m) throw new Error(`${symbol}: no NXR mark source — add it to NXR_MARKS`);
    const { nxrSymbol, nxrQuote, quoteVia, session } = m;
    return {
      name,
      feedId,
      nxrSymbol,
      nxrQuote,
      quoteVia,
      token: need(V.tokens[symbol], `${symbol} token`),
      symbol,
      session,
    };
  },
);

export function sepoliaFeedId(symbol: string): `0x${string}` | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === symbol)?.feedId ?? null;
}

export function sepoliaFeedByName(name: string): SepoliaFeed | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.name === name) ?? null;
}

/**
 * Static USD fallbacks for sizing when a live oracle read fails, keyed by the SEPOLIA spelling of
 * each symbol (`cbBTC`, not `CBBTC`) because the front indexes it by the token symbol it renders.
 * The numbers themselves are `NXR_MARKS[...].refUsd` — a mark is a property of the asset, so it is
 * stated once there and any chain's roster narrows it (`registry.ts activeRefMarksUsd`).
 */
export const SEPOLIA_REF_MARKS_USD: Record<string, number> = Object.fromEntries(
  SEPOLIA_ORACLE_FEEDS.map((f) => [f.symbol, nxrMark(f.symbol)!.refUsd!]),
);
