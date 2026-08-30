/**
 * `IOracle.FeedData`: what `ExternalOracle.getFeed(feedId)` returns.
 *
 * Mirrored as a named interface so consumers stop typing the decode result `as any`. The SDK's
 * decoder keys a tuple by ABI component name (`eth/abi.ts`), so a stale field name does not
 * throw: it reads `undefined`, `Number()` makes it `NaN` or `0`, and the caller reports a
 * confident wrong answer. That is how a renamed `sigma`/`updatedAt`/`ttl` left an indexer
 * gating every feed as stale while its tests stayed green.
 */

import type { Assert, FeedDataFields, FieldsMatch } from '../abis/structs.generated.js';

export interface FeedData {
  /** Packed B64 decimal float (mantissa 52 | decimals 5 | exp+bias 7), NOT value x 2^64.
   *  Decode with `decodeB64`; dividing the word by 2^64 reads USDC as 0.222. */
  lastPriceB64: bigint;
  /** Keeper-signed volatility, PBPS (1e6 = 100%). */
  sigmaPbps: number;
  /** Chain clock of the last accepted push, seconds. */
  updatedAtSecs: number;
  /** Staleness bound, seconds. Half of it (integer division) is the keeper grace. */
  ttlSecs: number;
  /** Mark 1-sigma confidence interval, bps. */
  confidenceBps: number;
  /** Feed bits; bit0 = paused. */
  flags: number;
  /** Single-push deviation bound, bps. Widening it is timelocked; narrowing is instant. */
  maxDeviationBps: number;
  /** Signer-attested source time, ms since epoch. Strictly monotonic per feed; 0 when unsigned. */
  sourceTsMs: number;
}

/** Fails the typecheck if `FeedData` and the ABI's struct stop agreeing on field names. */
export type _FeedDataMatchesAbi = Assert<FieldsMatch<FeedData, FeedDataFields>>;

/**
 * Freshness clock the contract gates on: `min(sourceTs, updatedAt)`, falling back to `updatedAt`
 * when the feed is unsigned. Age read off `updatedAtSecs` alone under-states it by the relay lag,
 * which is how a feed reads fresh off-chain and still reverts `StaleData` on-chain.
 */
export function observedAtSecs(f: Pick<FeedData, 'sourceTsMs' | 'updatedAtSecs'>): number {
  if (!f.sourceTsMs) return f.updatedAtSecs;
  const srcSecs = Math.floor(f.sourceTsMs / 1000);
  return srcSecs > f.updatedAtSecs ? f.updatedAtSecs : srcSecs;
}
