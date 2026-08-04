// Venue registry for BTR pool quoting. Sepolia is the only deployed venue
// (Chapel retired 2026-07-25) and it hosts no incumbents, so the venue set is
// the three BTR cores. Addresses live in ./sepolia.ts.

import type { Address, Hex } from '../eth/index.js';
import {
  SEPOLIA_BTR,
  SEPOLIA_FX_SYMBOLS,
  SEPOLIA_REF_MARKS_USD,
  SEPOLIA_STABLE_SYMBOLS,
  SEPOLIA_TOKENS,
  SEPOLIA_VOLATILE_SYMBOLS,
  sepoliaFeedId,
} from './sepolia.js';

export type VenueKind = 'btr';

export interface VenuePool {
  venue: VenueKind;
  tag: string;
  address: Address;
  tokens?: Address[];
}

export const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const hasToken = (tokens: readonly Address[] | undefined, t: Address): boolean =>
  !!tokens?.some((x) => eqAddr(x, t));

// ── Venue set ─────────────────────────────────────────────────────────────────
// Single chain: Sepolia is the only deployed venue and hosts no incumbents, so
// the venue set is the three BTR cores. Token lists gate which pool quotes a
// pair; a dual-listed asset quotes every pool that lists it and the router
// picks the better price (best-route across pools).

const symAddrs = (syms: readonly string[]): Address[] =>
  syms.map((s) => SEPOLIA_TOKENS[s]!).filter(Boolean);

/** USDC base (USDC-hub numeraire). */
export function activeUsdc(): Address {
  return SEPOLIA_TOKENS['USDC']!;
}

/** ExternalOracle address. */
export function activeOracle(): Address {
  return SEPOLIA_BTR.oracle;
}

/** Static USD ref marks (fallback while live oracle is down / stale). */
export function activeRefMarksUsd(): Record<string, number> {
  return { ...SEPOLIA_REF_MARKS_USD };
}

/** ExternalOracle getFeed key for a symbol (registered Pyth-style feedId); null when unknown. */
export function activeFeedId(symbol: string): Hex | null {
  return sepoliaFeedId(symbol);
}

/** Static venue pools. */
export function staticVenuePools(): VenuePool[] {
  const pools: VenuePool[] = [
    { venue: 'btr', tag: 'btr-stable', address: SEPOLIA_BTR.stablePool, tokens: symAddrs(SEPOLIA_STABLE_SYMBOLS) },
    { venue: 'btr', tag: 'btr-volatile', address: SEPOLIA_BTR.volatilePool, tokens: symAddrs(SEPOLIA_VOLATILE_SYMBOLS) },
  ];
  // FX core not in the current Sepolia redeploy (11155111.pools.json has no fxPool).
  const fx = (SEPOLIA_BTR as { fxPool?: typeof SEPOLIA_BTR.stablePool }).fxPool;
  if (fx) pools.push({ venue: 'btr', tag: 'btr-fx', address: fx, tokens: symAddrs(SEPOLIA_FX_SYMBOLS) });
  return pools;
}
