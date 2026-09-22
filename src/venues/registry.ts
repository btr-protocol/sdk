// Venue registry for BTR pool quoting, resolved PER CHAIN.
//
// Every lookup here takes a `chainId` and throws when BTR is not deployed on it. That is the
// whole point of the module: the previous shape hardcoded one chain and took no chain at all, so a
// bot configured for another chain quoted the hardcoded pool addresses and *succeeded*: the worst failure mode
// available, because nothing reverts and nothing logs. There is deliberately no fallback: a caller
// that cannot name its chain has no business building swap calldata. `defaultChainId()` only picks
// which chain an app SHOWS first; every lookup still takes the chain explicitly.
//
// Facts come from `./deployments.generated.ts`, the recorded deployment facts per chain.
// A chain with no record is simply absent, so an undeployed chain fails
// at the first lookup instead of resolving to plausible-looking addresses.

import type { Address, Hex } from '../eth/index.js';
import { normalizeAddress } from '../eth/types.js';
import { mitchFeedId } from '../oracle/mitch.js';
import { type ChainVenue, DEPLOYED_VENUES } from './deployments.generated.js';
import { nxrMark } from './nxr.js';

export type VenueKind = 'btr';

export interface VenuePool {
  venue: VenueKind;
  tag: string;
  address: Address;
  tokens?: Address[];
}

export const eqAddr = (a: string, b: string): boolean =>
  normalizeAddress(a) === normalizeAddress(b);

export const hasToken = (tokens: readonly Address[] | undefined, t: Address): boolean =>
  !!tokens?.some((x) => eqAddr(x, t));

/** Chain ids BTR is actually deployed on, ascending. */
export function deployedChainIds(): number[] {
  return Object.keys(DEPLOYED_VENUES)
    .map(Number)
    .sort((a, b) => a - b);
}

export interface BtrChain {
  chainId: number;
  /** `dex-evm/deployments/chains.json` slug; names `<slug>.manifest.json`. */
  slug: string;
  /** `live` iff `DEPLOYED_VENUES` carries a transcribed record for the chain. */
  status: 'live' | 'pending';
}

/** Every chain the one BTR deployment serves, in default order: BNB first once live, then Arc. */
export const BTR_CHAINS: readonly BtrChain[] = (
  [
    [56, 'bnb'],
    [5042002, 'arc'],
  ] as const
).map(([chainId, slug]) => ({
  chainId,
  slug,
  status: DEPLOYED_VENUES[chainId] ? 'live' : 'pending',
}));

/** The first live served chain: Arc until BNB's record is transcribed, then BNB. */
export function defaultChainId(): number {
  const c = BTR_CHAINS.find((c) => c.status === 'live');
  if (!c) throw new Error('no served BTR chain has a deployment record');
  return c.chainId;
}

/**
 * The deployment record for `chainId`, or a throw naming what is deployed.
 *
 * Throwing is the contract. Every caller below funnels through here, so a bot started against an
 * undeployed chain dies on its first quote with the chain id in the message, rather than trading
 * another chain's addresses.
 */
export function chainVenue(chainId: number): ChainVenue {
  const v = DEPLOYED_VENUES[chainId];
  if (!v) {
    const served = BTR_CHAINS.find((c) => c.chainId === chainId);
    const why = served
      ? `chain ${chainId} (${served.slug}) is served but pending its ceremony record`
      : 'No SDK record exists for it yet';
    throw new Error(
      `no BTR deployment for chain ${chainId} — deployed: [${deployedChainIds().join(', ')}]. ${why}.`,
    );
  }
  return v;
}

/** The chain's native USDC (Arc's gas token), NOT the pool base: Arc's live base is USDC.b. */
export function nativeUsdc(chainId: number): Address {
  const v = chainVenue(chainId);
  const usdc = v.tokens.USDC;
  if (!usdc) throw new Error(`chain ${chainId} deployment carries no native USDC`);
  return usdc;
}

/** ExternalOracle address. */
export function activeOracle(chainId: number): Address {
  const v = chainVenue(chainId);
  const oracle = v.contracts.oracle;
  if (!oracle) throw new Error(`chain ${chainId} deployment carries no oracle`);
  return oracle;
}

/**
 * Static USD ref marks for the chain's assets (sizing fallback while the live oracle is stale).
 *
 * Marks are a property of the ASSET, not of the chain, so the table is shared; it is narrowed to
 * the chain's roster so an asset listed on one chain and not another cannot be sized off a mark
 * for a token that chain does not have. A symbol with no static mark is absent, and the caller
 * falls back rather than sizing off a fabricated number.
 *
 * Resolution is case-folded (`nxrMark`) because the roster spelling is per chain: one chain may
 * list `cbBTC` where Arc lists `CBBTC` for the same asset, and an exact-key lookup silently drops
 * one of them; sizing then falls back for a token that has a perfectly good mark.
 */
export function activeRefMarksUsd(chainId: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sym of Object.keys(chainVenue(chainId).tokens)) {
    const m = nxrMark(sym)?.refUsd;
    if (m !== undefined) out[sym] = m;
  }
  return out;
}

/**
 * `ExternalOracle.getFeed` key for a token symbol; null when the chain has no feed for it.
 *
 * The base resolves to its signed `USDC-USD` reference: there is no `USDC/USDC` identity feed, and
 * `PricingLib._denominate` divides every usd-quoted asset by that reference.
 */
export function activeFeedId(chainId: number, symbol: string): Hex | null {
  const v = chainVenue(chainId);
  return v.feedIds[`${symbol}-USDC`] ?? v.feedIds[`${symbol}-USD`] ?? null;
}

/**
 * The MITCH `tickerId` (decimal string) for a token symbol; null when the chain has no feed for it.
 *
 * Same `<SYM>-USDC` then `<SYM>-USD` resolution as `activeFeedId`, so the base still resolves to
 * its signed `USDC-USD` reference. Absent for a deployment record recorded before the migration.
 */
export function activeTickerId(chainId: number, symbol: string): string | null {
  const t = chainVenue(chainId).tickerIds;
  return t?.[`${symbol}-USDC`] ?? t?.[`${symbol}-USD`] ?? null;
}

/**
 * The MITCH-scheme `feedId` for a token symbol; null when the chain records no ticker for it.
 *
 * NOT a replacement for `activeFeedId`: during the migration a NEW oracle instance keyed by MITCH
 * runs alongside the live keccak-keyed one, and the generated `feedIds` map stays the source of
 * truth for whichever identity the deployment artifact actually holds. This resolves the incoming
 * scheme for readers that must address the new instance.
 */
export function mitchFeedIdFor(chainId: number, symbol: string): Hex | null {
  const id = activeTickerId(chainId, symbol);
  return id === null ? null : mitchFeedId(id);
}

/**
 * Deployed pools on `chainId`, with the token list that gates which pair each one quotes.
 *
 * A dual-listed asset quotes every pool that lists it and the router picks the better price
 * (best-route across pools). Only broadcast pools appear: a scripted-but-undeployed core is
 * absent from the generated record, so it can never be handed to the router.
 */
export function staticVenuePools(chainId: number): VenuePool[] {
  const v = chainVenue(chainId);
  return v.pools.map((p) => ({
    venue: 'btr' as const,
    tag: p.tag,
    address: p.address,
    tokens: p.symbols.map((s) => v.tokens[s]!).filter(Boolean),
  }));
}
