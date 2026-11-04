/**
 * Coverage codec: `Asset.covBits` / `kneeBits` pack and unpack, bps terms. Pure bit twiddling, no
 * toll law (that is `covLaw.ts`) so a route that only decodes risk terms does not bundle the law.
 */

/** Largest minifloat κ (code 53), bps. */
export const MAX_KAPPA_BPS = 20_480;

/** `PoolConstantsLib.KNEE_BIT`: `Asset.flags` bit 1; slot 3 (`kneeBits`) is live only while set. */
export const KNEE_BIT = 1 << 1;

/** The knee word a quote reads: `kneeBits` only while `flags` carries `KNEE_BIT`, else 0 (PricingLib, PoolLiquidityLib). */
export const readKnee = (flags: number, kneeBits: number): number =>
  flags & KNEE_BIT ? kneeBits : 0;

// ---- codec -----------------------------------------------------------------------------------

/** `CovLib.kappaBps`: minifloat code (4 steps per octave) -> bps. */
export const kappaBps = (code: number): number =>
  code >> 2 === 0 ? code : (4 + (code & 3)) << ((code >> 2) - 1);

/** Inverse of {@link kappaBps}; throws where `CovLib` reverts (off the step grid). */
export function kappaCode(bps: number): number {
  if (bps < 4) return bps;
  const e = Math.floor(Math.log2(bps)) - 1;
  const m = (bps >> (e - 1)) - 4;
  if ((4 + m) << (e - 1) !== bps || e > 13 || (e === 13 && m > 1)) {
    throw new Error(`kappa ${bps} bps off step`);
  }
  return (e << 2) | m;
}

/** The coverage terms of `Asset.covBits`, in bps (`getRiskConfig` units). */
export interface CovTerms {
  covMinBps: number;
  covTargetBps: number;
  covFlatBps: number;
  covMaxBps: number;
  /** κ⁻ of the leg record (a class row may override it live). */
  kappaCovBps: number;
  kappaPosBps: number;
}

/** `CovLib.unpack`: covBits (uint32) -> bps terms. */
export function unpackCov(bits: number): CovTerms {
  const b = BigInt(bits);
  return {
    covMinBps: Number(b & 63n) * 200,
    covTargetBps: 10_000 + Number((b >> 6n) & 63n) * 5,
    covFlatBps: Number((b >> 12n) & 7n) * 500,
    covMaxBps: 10_500 + Number((b >> 15n) & 31n) * 500,
    kappaCovBps: kappaBps(Number((b >> 20n) & 63n)),
    kappaPosBps: kappaBps(Number(b >> 26n)),
  };
}

/** `CovLib.pack`: bps terms -> covBits; throws exactly where the chain reverts `InvalidInput`. */
export function packCov(t: CovTerms): number {
  const { covMinBps: lo, covTargetBps: tg, covFlatBps: fl, covMaxBps: hi } = t;
  if (
    lo > 9000 ||
    lo % 200 ||
    tg < 10_000 ||
    tg > 10_300 ||
    tg % 5 ||
    fl > 3000 ||
    fl % 500 ||
    hi < 10_500 ||
    hi > 25_000 ||
    hi % 500 ||
    hi < tg + fl + 200
  ) {
    throw new Error('cov terms off step');
  }
  const v =
    BigInt(lo / 200) |
    (BigInt((tg - 10_000) / 5) << 6n) |
    (BigInt(fl / 500) << 12n) |
    (BigInt((hi - 10_500) / 500) << 15n) |
    (BigInt(kappaCode(t.kappaCovBps)) << 20n) |
    (BigInt(kappaCode(t.kappaPosBps)) << 26n);
  return Number(v);
}

/** The knee of `Asset.kneeBits` (uint16), bps. 0/0 = no knee. */
export interface KneeTerms {
  kneeCovBps: number;
  kappaKneeBps: number;
}

export function unpackKnee(kneeBits: number): KneeTerms {
  return { kneeCovBps: (kneeBits & 63) * 200, kappaKneeBps: kappaBps(kneeBits >> 6) };
}

/** `CovLib.packKnee`: needs c_min (the knee sits in `(c_min, 0.98]`). */
export function packKnee(covMinBps: number, t: KneeTerms): number {
  if (t.kappaKneeBps === 0) {
    if (t.kneeCovBps) throw new Error('knee: c_k without kappa2');
    return 0;
  }
  if (t.kneeCovBps % 200 || t.kneeCovBps < covMinBps + 200 || t.kneeCovBps > 9800) {
    throw new Error('knee: c_k off step or outside (c_min, 0.98]');
  }
  return (t.kneeCovBps / 200) | (kappaCode(t.kappaKneeBps) << 6);
}
