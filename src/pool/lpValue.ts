/**
 * USD value of ONE pool LP receipt unit, from chain truth: the leg's liquidity index (the pool's
 * `getAsset`) x the mark the pool itself reads for that leg (`readMarks`, the impl's P8 store).
 * One definition for every app (front, Safe app): an LP receipt is a per-leg claim, so 1 receipt
 * unit of leg X = `indexWad / 1e18` units of X, worth that x X's mark. Right after a deposit the
 * value received equals the value sent minus fees. Face value: before the exit haircut.
 *
 * Keyed by the pool and the underlying token ADDRESS, never by a symbol. Receipts carry the
 * underlying's decimals, so a receipt amount in token units prices without a decimals factor.
 *
 * Mark scale: `mark1e18` is the pool's own 1e18-WAD mark of the leg (IOracle.sol:10 `mark1e18`, "live mark in 1e18 WAD"), decoded off the P8 store word
 * (`readMarks` storage.ts:808 -> `decodeStoreWord` -> `laneFloat` storage.ts:578, `mant << (e - 16)`), so `Number(mark1e18) / 1e18` is the USD price of one
 * underlying unit (the base leg's mark is ~1.0). Every read of one call is pinned to ONE block (`pinBlock`).
 */

import { POOL_ABI } from '../abis/Pool.js';
import { decodeFn, encodeFn } from '../eth/abi';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';
import { getAsset } from './index.js';
import { readMarks } from './storage.js';

const WAD = 10n ** 18n;
/** v1 fleet only (storage 5..9): a leg listed before the base was written stores 0, which that pool lazy-inits to 1e12 (front/src/hooks/usePoolData.ts:60-64).
 *  A v2 pool (dex-evm PoolConfigLib.sol:352) writes WAD at initAsset and treats 0 as WIPED, never as this sentinel; a v2 leg cannot hold 0 with liabilities > 0
 *  (writeDown floors the index at MIN_WRITEDOWN_INDEX, PoolConstantsLib.sol:139). Not verified: that a deployed v1 leg still returns it. */
export const LEGACY_LIQUIDITY_INDEX = 10n ** 12n;

/**
 * Share-value index of a leg. A stored 0 is ambiguous and `liabilities` separates the cases: a
 * write-down leaves liabilities at 0 (shares worth 0), a legacy lazy-init leg still owes its face.
 */
export function shareIndexWad(asset: { liquidityIndexWad: bigint; liabilities: bigint }): bigint {
  if (asset.liquidityIndexWad !== 0n) return asset.liquidityIndexWad;
  return asset.liabilities > 0n ? LEGACY_LIQUIDITY_INDEX : 0n;
}

/** The slice of a mark word the valuation reads. */
export interface LegMark {
  mark1e18: bigint;
  /** INTERNAL mode: the leg quotes the 1.0 peg, the feed is only its breaker. */
  internal: boolean;
  /** Quote unit UOA: the mark is divided by the base mark, not a USD price. */
  uoa: boolean;
  halted: boolean;
  /** Unix seconds of the observation, and the pool's freshness window. */
  obs: number;
  ttlSecs: number;
}

/** USD per 1 unit of the leg's underlying, as the pool prices it; null when it cannot be said. */
export function legMarkUsd(m: LegMark | null | undefined): number | null {
  if (!m || m.uoa) return null;
  if (m.internal) return 1;
  if (m.mark1e18 <= 0n) return null;
  return Number(m.mark1e18) / 1e18;
}

/**
 * USD per 1 LP receipt unit (token units, not base units): index x mark. `null` = unknown (no
 * mark), never 0. A written-down leg (index 0) is a real 0.
 */
export function lpUsdPerUnit(
  asset: { liquidityIndexWad: bigint; liabilities: bigint },
  mark: LegMark | null | undefined,
): number | null {
  const px = legMarkUsd(mark);
  if (px === null) return null;
  return (Number(shareIndexWad(asset)) / Number(WAD)) * px;
}

export interface LegLpValue {
  /** Underlying token of the leg. */
  token: Address;
  /** The leg's LP receipt token, as `Pool.lpToken(token)` answers; null = the pool does not list the token (or could not be read). */
  lp: Address | null;
  indexWad: bigint | null;
  /** USD per underlying unit (the pool's own mark); null = unknown. */
  markUsd: number | null;
  /** USD per LP receipt unit = index x mark; null = unknown. */
  usdPerLp: number | null;
  /** Observation time of the mark (unix seconds); null when there is no mark. */
  obs: number | null;
  /** The mark is older than the pool's freshness window, measured against the pinned block's timestamp (`blockTs`) and `ttlSecs`. null when there is no mark.
   *  A `stale` or `halted` value is the LAST mark the pool holds, returned so that consumers decide: it is NOT a live USD figure and must not be displayed as one. */
  stale: boolean | null;
  halted: boolean | null;
  /** The pool's freshness window for this mark, seconds; null when there is no mark. */
  ttlSecs: number | null;
  /** INTERNAL mode: the leg quotes the 1.0 peg (`markUsd` is 1), so a consumer can label it. null when there is no mark. */
  peg: boolean | null;
  /** The block every read of this value was pinned to, and its timestamp (unix seconds); null when none could be pinned. */
  block: number | null;
  blockTs: number | null;
}

const UNKNOWN = (token: Address): LegLpValue => ({
  token,
  lp: null,
  indexWad: null,
  markUsd: null,
  usdPerLp: null,
  obs: null,
  stale: null,
  halted: null,
  ttlSecs: null,
  peg: null,
  block: null,
  blockTs: null,
});

/** A provider whose `latest` state reads (eth_call, eth_getStorageAt) are rewritten to `block`: the sdk readers all read `latest`. Any OTHER block tag on those
 *  methods throws instead of passing through, so a reader that learns to pass its own tag cannot silently mix blocks. */
export function pinBlock(provider: Eip1193Provider, block: number): Eip1193Provider {
  const tag = `0x${block.toString(16)}`;
  return {
    ...provider,
    request: ((args: { method: string; params?: unknown[] }) => {
      if (args.method !== 'eth_call' && args.method !== 'eth_getStorageAt')
        return provider.request(args as never);
      const params = [...(args.params ?? [])];
      const at = params.length - 1;
      if (params[at] !== 'latest' && params[at] !== tag)
        throw new Error(`pinBlock: unexpected block tag ${String(params[at])} on ${args.method}`);
      params[at] = tag;
      return provider.request({ ...args, params } as never);
    }) as Eip1193Provider['request'],
  };
}

/** The head block a set of reads is pinned to. */
export interface Head {
  number: number;
  ts: number;
}

/** Everything read from chain for one leg; injectable for tests. */
export interface LegReaders {
  /** The head block and its timestamp, read once per call. */
  head: (p: Eip1193Provider) => Promise<Head>;
  asset: typeof getAsset;
  marks: (
    p: Eip1193Provider,
    pool: Address,
    token: Address,
    nowSecs: number,
  ) => Promise<{ primary: LegMark }>;
  lpToken: (p: Eip1193Provider, pool: Address, token: Address) => Promise<Address>;
}

const ZERO = /^0x0*$/i;

/** The chain's head block and its timestamp (one read; pass it to several `readLegLpValues` calls so they share ONE block). */
export const readHead = (provider: Eip1193Provider): Promise<Head> => chainReaders.head(provider);

const chainReaders: LegReaders = {
  head: async (p) => {
    const n = (await p.request({ method: 'eth_blockNumber', params: [] })) as Hex;
    const b = (await p.request({ method: 'eth_getBlockByNumber', params: [n, false] })) as {
      timestamp: Hex;
    } | null;
    if (!b) throw new Error('head block not served');
    return { number: Number(BigInt(n)), ts: Number(BigInt(b.timestamp)) };
  },
  asset: (p, pool, token) => getAsset(p, pool, token), // lazy: ./index re-exports this module
  marks: (p, pool, token, nowSecs) => readMarks(p, pool, token, nowSecs),
  lpToken: async (p, pool, token) => {
    const out = (await p.request({
      method: 'eth_call',
      params: [
        { to: pool, data: encodeFn({ abi: POOL_ABI, functionName: 'lpToken', args: [token] }) },
        'latest',
      ],
    })) as Hex;
    return decodeFn({ abi: POOL_ABI, functionName: 'lpToken', data: out }) as Address;
  },
};

/**
 * Per-leg LP value of `pool` for the given underlying tokens, live from chain: ONE head block (`opts.head`, else read here) is the block of every read (index,
 * receipt, mark), with the mark's clock that block's timestamp. A token the pool does not list (lpToken 0 or a revert) is all null and its mark is never read
 * (the sdk mark reader would fall back to lane 0). A node that cannot serve the head gives all-null values, never mixed-block ones.
 * Values flagged `halted` or `stale` are returned as numbers so consumers decide; they are NOT live USD figures and must not be displayed as such.
 */
export async function readLegLpValues(
  provider: Eip1193Provider,
  pool: Address,
  tokens: readonly Address[],
  opts: { head?: Head; read?: LegReaders } = {},
): Promise<LegLpValue[]> {
  const read = opts.read ?? chainReaders;
  let head: Head;
  try {
    head = opts.head ?? (await read.head(provider));
  } catch {
    return tokens.map(UNKNOWN);
  }
  const at = pinBlock(provider, head.number);
  return Promise.all(
    tokens.map(async (token): Promise<LegLpValue> => {
      try {
        const lp = await read.lpToken(at, pool, token);
        if (!lp || ZERO.test(lp)) return UNKNOWN(token);
        const [asset, mark] = await Promise.all([
          read.asset(at, pool, token),
          read.marks(at, pool, token, head.ts).then(
            (m) => m.primary,
            () => null,
          ),
        ]);
        const px = legMarkUsd(mark);
        return {
          token,
          lp,
          indexWad: shareIndexWad(asset),
          markUsd: px,
          usdPerLp: lpUsdPerUnit(asset, mark),
          obs: px === null ? null : mark!.obs,
          stale: px === null ? null : head.ts - mark!.obs > mark!.ttlSecs,
          halted: px === null ? null : mark!.halted,
          ttlSecs: px === null ? null : mark!.ttlSecs,
          peg: px === null ? null : mark!.internal,
          block: head.number,
          blockTs: head.ts,
        };
      } catch {
        return UNKNOWN(token);
      }
    }),
  );
}
