// C-exposure toll replica (integer, bigint): what an LP entrypoint pays for the pool rate C being
// a function of marks that can still move. Twin of PricingLib.markToBaseWad (spread, entry gap,
// clamp refusal) + PoolSolvencyLib.sweep (tollPbps) + PoolLiquidityLib._cToll. Pure; the caller
// reads the pool and decodes the mark words. Back mirror: quote/src/lp.rs, pinned by
// test/fixtures/lp-toll-vectors.json (one vector file, both suites).

import { MAX_STALE_GRACE_SECS, STALE_Z } from '../abis/solidity.generated.js';

export const BPS = 10_000n;
export const PBPS = 1_000_000n;
/** Entry-gap age cap (seconds): `PricingLib._entryGap` credits at most 30 s of movement. */
export const ENTRY_AGE_CAP = 30n;

const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};

/** One anchor hop of a leg (the leg itself, depth 1; deeper legs list every hop). Ages are
 *  `block.timestamp - obs`, floored at 0. */
export interface TollHop {
  minFeePbps: bigint;
  /** Seconds past the premium-free grace: `staleExcess` of the leg's word. */
  staleExcessSecs: bigint;
  sigmaPbps: bigint;
  maxDevBps: bigint;
  obsAgeSecs: bigint;
  refBandBps: bigint;
  /** Age of the reference tier; `undefined` when the word carries none. */
  refAgeSecs?: bigint;
  /** Quoted in USD (priced mark/base): the base lane's age and maxDev add on entry. */
  uoa: boolean;
  baseObsAgeSecs?: bigint;
  baseMaxDevBps?: bigint;
}

/** `ttlSecs/2` clamped to MAX_STALE_GRACE_SECS, then the age past it (PricingLib._staleExcessOf). */
export const staleExcess = (ageSecs: bigint, ttlSecs: bigint): bigint => {
  const grace =
    ttlSecs / 2n < BigInt(MAX_STALE_GRACE_SECS) ? ttlSecs / 2n : BigInt(MAX_STALE_GRACE_SECS);
  return ageSecs > grace ? ageSecs - grace : 0n;
};

const staleTerm = (excess: bigint, sigmaPbps: bigint): bigint =>
  excess === 0n || sigmaPbps === 0n ? 0n : (BigInt(STALE_Z) * sigmaPbps * isqrt(excess)) / BPS;

/** `PricingLib._entryGap`: full spread, PBPS, of the largest landing knowable at a deposit. */
export const entryGapPbps = (ageSecs: bigint, maxDevBps: bigint): bigint =>
  200n * (ageSecs < ENTRY_AGE_CAP ? ageSecs : ENTRY_AGE_CAP) * maxDevBps + 400n * maxDevBps;

/** One hop's full spread, PBPS: `max(minFee + staleness, gap)`. Exit gap = 2·maxDev, entry gap =
 *  `entryGapPbps` off the OLDER of the primary and (banded legs) the reference tier, plus the
 *  base lane's term for a USD-quoted leg. */
export function hopSpreadPbps(h: TollHop, entry: boolean): bigint {
  const sp = h.minFeePbps + staleTerm(h.staleExcessSecs, h.sigmaPbps);
  let gap = 200n * h.maxDevBps;
  if (entry) {
    let age = h.obsAgeSecs;
    if (h.refBandBps !== 0n && h.refAgeSecs !== undefined && h.refAgeSecs > age) age = h.refAgeSecs;
    gap = entryGapPbps(age, h.maxDevBps);
    if (h.uoa) gap += entryGapPbps(h.baseObsAgeSecs ?? 0n, h.baseMaxDevBps ?? 0n);
  }
  return sp > gap ? sp : gap;
}

/** A leg's spread: the sum over its hops to the base (0 on the base itself). */
export const legSpreadPbps = (hops: readonly TollHop[], entry: boolean): bigint =>
  hops.reduce((s, h) => s + hopSpreadPbps(h, entry), 0n);

/** `PricingLib._tryLegMark`, entry: a banded leg refuses the deposit while its clamp binds or its
 *  reference is unusable (`markRaw` and `refPrice` in the same raw unit). */
export function bandRefusesEntry(
  markRaw: bigint,
  bandBps: bigint,
  ref: { price: bigint; ok: boolean } | null,
): boolean {
  if (bandBps === 0n || ref === null) return false;
  if (!ref.ok) return true;
  const lo = (ref.price * (BPS - bandBps)) / BPS;
  const hi = (ref.price * (BPS + bandBps)) / BPS;
  return markRaw < lo || markRaw > hi;
}

/** One usable leg of the sweep, in base units (WAD): value `rb = R·px`, claim `legBase = L·px`. */
export interface TollLeg {
  reserveBase: bigint;
  claimBase: bigint;
  spreadPbps: bigint;
}

/** `PoolSolvencyLib.sweep` tollPbps: `ceil(Σ |rb - g·legBase|·sp / (2·nav))`. `g` = last good C
 *  (WAD; 0 reads par). Half-spread, PBPS; 0 on a balanced pool or an empty NAV. */
export function exposureTollPbps(legs: readonly TollLeg[], lastGoodCWad: bigint): bigint {
  const WAD = 10n ** 18n;
  const g = lastGoodCWad === 0n ? WAD : lastGoodCWad;
  let nav = 0n;
  let acc = 0n;
  for (const l of legs) {
    nav += l.reserveBase;
    const gl = (l.claimBase * g) / WAD;
    const d = l.reserveBase > gl ? l.reserveBase - gl : gl - l.reserveBase;
    acc += d * l.spreadPbps;
  }
  return nav === 0n ? acc : (acc + 2n * nav - 1n) / (2n * nav);
}

/** `PoolLiquidityLib._cToll`: ceil(amt·toll/PBPS), capped at amt. */
export const cToll = (amt: bigint, tollPbps: bigint): bigint => {
  const f = (amt * tollPbps + PBPS - 1n) / PBPS;
  return f > amt ? amt : f;
};

/** Deposit receipt, face and shares (PoolLiquidityLib.deposit, after the first-deposit treasury
 *  share and dead-share seed, which the caller subtracts): `face = (amt - toll)·WAD/C`,
 *  `shares = face·WAD/idx`. Entry toll stays in reserves. */
export function depositShares(
  amt: bigint,
  entryTollPbps: bigint,
  cWad: bigint,
  indexWad: bigint,
): { face: bigint; shares: bigint; toll: bigint } {
  const WAD = 10n ** 18n;
  const toll = cToll(amt, entryTollPbps);
  const face = ((amt - toll) * WAD) / cWad;
  return { face, shares: (face * WAD) / indexWad, toll };
}

/** `minLpOut` for `Pool.depositMin`: the preview less the caller's slippage (bps), floored. */
export const minLpOut = (shares: bigint, slippageBps: bigint): bigint =>
  (shares * (BPS - slippageBps)) / BPS;
