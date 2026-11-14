/**
 * USD value of ONE pool LP receipt unit, from chain truth: the leg's liquidity index (the pool's
 * `getAsset`) x the mark the pool itself reads for that leg (`readMarks`, the impl's P8 store).
 * One definition for every app (front, Safe app): an LP receipt is a per-leg claim, so 1 receipt
 * unit of leg X = `indexWad / 1e18` units of X, worth that x X's mark. Right after a deposit the
 * value received equals the value sent minus fees. Face value: before the exit haircut.
 *
 * Keyed by the pool and the underlying token ADDRESS, never by a symbol. Receipts carry the
 * underlying's decimals, so a receipt amount in token units prices without a decimals factor.
 */

import { POOL_ABI } from '../abis/Pool.js';
import { decodeFn, encodeFn } from '../eth/abi';
import type { Address, Eip1193Provider, Hex } from '../eth/types.js';
import { getAsset } from './index.js';
import { readMarks } from './storage.js';

const WAD = 10n ** 18n;
/** ConstantsLib LEGACY_LIQUIDITY_INDEX: a leg listed before the base was written stores 0, which the pool lazy-inits to 1e12. */
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
  /** The leg's LP receipt token, as `Pool.lpToken(token)` answers. */
  lp: Address;
  indexWad: bigint;
  /** USD per underlying unit (the pool's own mark); null = unknown. */
  markUsd: number | null;
  /** USD per LP receipt unit = index x mark; null = unknown. */
  usdPerLp: number | null;
  /** The mark is older than the pool's freshness window (value still returned: it is the last mark the pool holds). */
  stale: boolean;
  halted: boolean;
}

/** Everything read from chain for one leg; injectable for tests. */
export interface LegReaders {
  asset: typeof getAsset;
  marks: (
    p: Eip1193Provider,
    pool: Address,
    token: Address,
    nowSecs: number,
  ) => Promise<{ primary: LegMark }>;
  lpToken: (p: Eip1193Provider, pool: Address, token: Address) => Promise<Address>;
}

const chainReaders: LegReaders = {
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
 * Per-leg LP value of `pool` for the given underlying tokens, live from chain (reads at `latest`,
 * all legs in parallel). A leg whose mark cannot be read comes back with `markUsd`/`usdPerLp` null.
 */
export async function readLegLpValues(
  provider: Eip1193Provider,
  pool: Address,
  tokens: readonly Address[],
  nowSecs = Math.floor(Date.now() / 1000),
  read: LegReaders = chainReaders,
): Promise<LegLpValue[]> {
  return Promise.all(
    tokens.map(async (token): Promise<LegLpValue> => {
      const [asset, lp, mark] = await Promise.all([
        read.asset(provider, pool, token),
        read.lpToken(provider, pool, token),
        read.marks(provider, pool, token, nowSecs).then(
          (m) => m.primary,
          () => null,
        ),
      ]);
      return {
        token,
        lp,
        indexWad: shareIndexWad(asset),
        markUsd: legMarkUsd(mark),
        usdPerLp: lpUsdPerUnit(asset, mark),
        stale: mark ? nowSecs - mark.obs > mark.ttlSecs : false,
        halted: mark?.halted ?? false,
      };
    }),
  );
}
