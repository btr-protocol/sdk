/** The coverage-law codec of `Asset.covBits` / `Asset.kneeBits` (storage version 12), bit-exact
 *  with dex-evm `CovLib.sol` and core `cov.rs`. Raw units never leave the pool: `getAsset` returns
 *  the packed words, `getRiskConfig` the bps; this decodes the former into the latter.
 *
 *  `covBits` (u32): c_min 0..5 (2% steps) | t − 1 6..11 (5 bps) | flat 12..14 (5%) | c_max 15..19
 *  (1.05 + 5%) | κ⁻ code 20..25 | κ⁺ code 26..31. `kneeBits` (u16, `Asset` slot 3, read only
 *  while `KNEE_BIT` is set in `flags`): c_k 0..5 (2%) | κ₂ code 6..11; κ₂ = 0 ⇔ no knee. */

/** `CovLib.kappaBps`: a 4-step-per-octave minifloat, code 0..53 → 0..20480 bps. */
export function kappaBps(code: number): number {
  const c = code & 63;
  return c >> 2 === 0 ? c : (4 + (c & 3)) << ((c >> 2) - 1);
}

export interface CovTerms {
  /** Lower pole c_min (bps). */
  cMinBps: number;
  /** Target t (bps), ≥ 10_000. */
  targetBps: number;
  /** Toll-free width above t (bps). */
  flatBps: number;
  /** Upper pole c_max (bps). */
  cMaxBps: number;
  /** κ⁻ (bps): the leg's own; a class row overrides it live. */
  kappaNegBps: number;
  /** κ⁺ (bps). */
  kappaPosBps: number;
}

export function decodeCovBits(bits: number): CovTerms {
  const b = bits >>> 0;
  return {
    cMinBps: (b & 63) * 200,
    targetBps: 10_000 + ((b >>> 6) & 63) * 5,
    flatBps: ((b >>> 12) & 7) * 500,
    cMaxBps: 10_500 + ((b >>> 15) & 31) * 500,
    kappaNegBps: kappaBps((b >>> 20) & 63),
    kappaPosBps: kappaBps(b >>> 26),
  };
}

export interface KneeTerms {
  /** Knee c_k (bps); 0 with no knee. */
  kneeCovBps: number;
  /** κ₂ (bps); 0 = no knee. */
  kappaKneeBps: number;
}

export function decodeKneeBits(bits: number): KneeTerms {
  const b = bits & 0xffff;
  return { kneeCovBps: (b & 63) * 200, kappaKneeBps: kappaBps((b >>> 6) & 63) };
}
