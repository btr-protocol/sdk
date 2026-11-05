// Liability-swap pipeline over the backend quoter (POST /v1/quote|route).
// Same style as front/src/lib/lpMath.ts: f64 in, f64 out, no chain reads. State inputs come from
// getAsset (sdk/pool/index.ts); conversion is backend SSOT (POST /v1/quote-path), never
// the deleted TS curve replica.
//
// LP settlement is POOL-LEVEL (LED-A, PoolSolvencyLib.sol): `C = Σ R_k·m_k / Σ L_k·m_k`. There is no
// per-leg haircut anywhere on the chain any more; this module is the ONE off-chain replica of it.
//
// swapLiability pipeline (PoolLiquidityLib.swapLiability):
//   1. liabIn      = lpAmountIn * idxIn / WAD
//   2. fairIn      = liabIn * C                     (mintRate: refuses when a mark is unusable)
//   3. conv        = backendConvert(in -> out, fairIn, 'credit'): the CLAIM law (no swap toll; the
//                    from-leg debit and the credit leg's pair-row Φ⁻ come out of the value)
//   4. markCap     = fairIn * q.markPrice   [Lemma B cap, _markCap]; conv clamped
//   5. liabOut     = conv / C (quote output is a TOKEN amount, `liabilities` is a FACE book;
//                    dividing by C re-denominates to face_in·m_in/m_out - no second haircut)
//   6. lpAmountOut = liabOut / idxOut (deadOut ~ 0 on any seeded live leg)
//
// Protocol-fee EXEMPT and no accrueLpFee booking on-chain: the swapper pays the full embedded
// spread only; no reserves move.

import { LIABILITY_SWAP_ENABLED_BIT } from '../abis/solidity.generated.js';
import type { PoolState } from '../amm/aimm.js';
import { applySlip } from '../utils/maths.js';
import { covWalls } from './covLaw.js';

/** SC.WAD */
export const WAD = 1e18;

/** The slice of IPool.Asset the liability math reads. Build from getAsset output. Face units. */
export interface LiabLeg {
  symbol: string;
  reserves: number;
  liabilities: number;
  /** Asset.liquidityIndexWad: face-per-share in WAD. Default WAD (1 share = 1 face). */
  indexWad?: number;
  /** `Asset.covBits`: the leg's coverage terms (`unpackCov`). Absent / 0 = no wall check. */
  covBits?: number;
  /** `Asset.minLiquidity`, face units like `reserves`. Absent = 0. */
  minLiquidity?: number;
  /** `Custody.invested`, face units: the hook tranche at book. Absent = 0 (not reported). */
  invested?: number;
}

/** `PoolLiquidityLib._requireCrossable`: a cross withdraw / liability swap burning `face` of this
 *  leg's claims at pool rate `c` reverts `InsufficientAmount` when `(liabilities - face)·c` would
 *  sit under the invested tranche. */
export const crossFenced = (leg: LiabLeg, face: number, c: number): boolean =>
  (leg.invested ?? 0) > 0 && (leg.liabilities - face) * c < (leg.invested ?? 0);

export const idxOf = (leg: LiabLeg): number => leg.indexWad ?? WAD;

/** `CovLib.walls` over float books: does the move `(r0, l0)` -> `(r1, l1)` end on or past a pole
 *  (c_min falling, c_max rising)? The chain reverts `ThresholdViolation(r1·WAD/l1, pole)`. Books are
 *  scaled to integers (1e6 per unit) and run through the bigint law, so the boundary is the chain's. */
export function covWallsF(
  covBits: number,
  r0: number,
  l0: number,
  r1: number,
  l1: number,
): boolean {
  if (!(covBits > 0) || !(l1 > 0)) return false;
  const q = (x: number): bigint => BigInt(Math.round(x * 1e6));
  return covWalls(BigInt(covBits), q(r0), q(l0), q(r1), q(l1));
}

/** PoolIOLib.checkRiskFlags(asset.flags, LIABILITY_SWAP_ENABLED_BIT) as a predicate. */
export const liabilitySwapEnabled = (flags: number): boolean =>
  (flags & LIABILITY_SWAP_ENABLED_BIT) !== 0;

/** `PoolSolvencyLib.solvency` over a `PoolState`: `C = Σ R·m / Σ L·m`, marks in base per token (the hub
 *  is the base, mark 1). Null is the chain's `ok == false`: a leg whose mark is unusable leaves no
 *  rate, so a mint or a cross conversion refuses (`mintRate` reverts `FeedUnavailable`). A 0/0 leg
 *  is skipped BEFORE its mark is read (A-1121: a dead feed on an emptied leg must not freeze the
 *  pool). An empty claim book reads 1 only when nothing is stranded; zero claim over value is no
 *  rate (A-1304). Indicative: the chain also caps each leg's reserves at its physical backing
 *  (`_backedReserves`), which pool state cannot see. */
export function poolSolvency(state: PoolState): number | null {
  let nav = state.hub?.res ?? 0;
  let claim = state.hub?.liab ?? 0;
  for (const leg of Object.values(state.legs)) {
    if (leg.res === 0 && leg.liab === 0) continue;
    if (!(Number.isFinite(leg.twap) && leg.twap > 0)) return null;
    nav += leg.res * leg.twap;
    claim += leg.liab * leg.twap;
  }
  if (!(claim > 0)) return nav > 0 ? null : 1;
  const c = nav / claim;
  return Number.isFinite(c) ? c : null;
}

/** `PoolSolvencyLib.previewCap` from the sweep's sums: `nav`/`claim` over the usable legs (hub
 *  included), `darkCk` = each unusable leg's `c_k = R/L` (∞ at L = 0; 0/0 legs skipped). With no dark
 *  leg it is C (1 on an empty book); else C's lower bound `min(C_usable, min c_k)`, since the true C is
 *  a mediant of them whatever the dark marks read. Excludes the C-exposure exit toll (`PoolSolvencyLib.sweep` tollPbps; read `previewWithdraw`). */
export function exitCap(nav: number, claim: number, darkCk: number[] = []): number {
  const lo = Math.min(...darkCk);
  if (darkCk.length === 0) return claim > 0 ? nav / claim : 1;
  return Math.min(claim > 0 ? nav / claim : nav > 0 ? Number.POSITIVE_INFINITY : lo, lo);
}

/** {@link exitCap} over a `PoolState`: a leg whose `twap` is not a positive number is dark. Reads
 *  the stored `res`; the chain caps it at `invested + balanceOf` (`_backedReserves`), so a leg whose
 *  token lost balance (fee-on-transfer, negative rebase, clawback) quotes high here; the exit's
 *  slippage floor covers the gap. */
export function poolExitCap(state: PoolState): number {
  let nav = state.hub?.res ?? 0;
  let claim = state.hub?.liab ?? 0;
  const dark: number[] = [];
  for (const leg of Object.values(state.legs)) {
    if (leg.res === 0 && leg.liab === 0) continue;
    if (!(Number.isFinite(leg.twap) && leg.twap > 0)) dark.push(legCoverage(leg.res, leg.liab));
    else {
      nav += leg.res * leg.twap;
      claim += leg.liab * leg.twap;
    }
  }
  return exitCap(nav, claim, dark);
}

/** `PoolLiquidityLib.exitMu` in face units: the SAME-ASSET payout `face · min(c_leg, cap)`.
 *  `cap` is the pool rate (`exitCap`); `c_leg = R/L` is the in-kind DELIVERY bound, not a fence -
 *  the full `face · C` claim stays reachable through a cross exit. A leg with no book pays `cap`. */
export function exitValue(face: number, cLeg: number, cap: number): number {
  return face * Math.min(cLeg, cap);
}

/** `c_leg = R/L`; a leg with no liabilities is unbounded (exitMu returns the cap there). */
export const legCoverage = (reserves: number, liabilities: number): number =>
  liabilities > 0 ? reserves / liabilities : Number.POSITIVE_INFINITY;

export interface SwapLiabilityQuote {
  /** Face burned on the in leg (shares · idxIn). */
  liabIn: number;
  /** `max(liabIn − fairIn, 0)`: what settling at C < 1 takes on the way in (the event's `haircut`). */
  haircutIn: number;
  /** liabIn · C: the claim value that converts. */
  fairIn: number;
  /** The pool rate the burn settled at. */
  poolC: number;
  /** Quoted conversion net of embedded spread/toll/skew, before the Lemma B clamp. */
  convQuoted: number;
  /** fairIn · markPrice: Lemma B re-denomination bound (_markCap). Decimal adjustment is
   *  implicit: both amounts and the WAD ratio here live in token units. */
  markCap: number;
  /** min(convQuoted, markCap): what actually converts. */
  conv: number;
  /** True when adaptive dispersion pushed the quoted conversion past the oracle mark. */
  markCapBinding: boolean;
  /** Final credited face on the out leg: `conv / poolC`, the conversion re-denominated from
   *  token amount to face at the same rate C. Crediting raw `conv` over-mints by a factor C. */
  liabOut: number;
  /** liabOut / idxOut: shares minted post-dead-seed (deadOut ~ 0 on a seeded live leg). */
  lpAmountOut: number;
  /** 1 − received/redeemed-equivalent vs the 1:1-face baseline, bps of face moved. */
  impactBps: number;
  /** Settlement discount at C, bps of liabIn: real component of impactBps (0 when C ≥ 1). */
  haircutInBps: number;
  /** Claim tolls inside `convQuoted` (out units): the debited leg's Φ⁺ and the credited leg's Φ⁻. */
  debitToll: number;
  creditToll: number;
  /** Half-spread actually deducted from the conversion output (path model). */
  convSpreadBps: number;
  /** Pure-curve movement along the fill. */
  convImpactBps: number;
  /** Size of the Lemma B clamp when binding, bps of convQuoted; else 0. */
  markClampBps: number;
}

/** §1.3 slippage guard: minLpAmountOut = quoted shares · (1 − slippageFrac), bigint, rounded DOWN
 *  (same applySlip semantics as the market-swap minOut floors). The contract checks it against the
 *  shares the swapper actually receives post-dead-seed (:472), so the guard measures what lands in
 *  the wallet. `quotedShares` is integer LP units; `slippageFrac\u2208[0,1)`. */
export function minLpAmountOut(quotedShares: bigint, slippageFrac: number): bigint {
  if (!Number.isFinite(slippageFrac) || slippageFrac < 0 || slippageFrac >= 1) {
    throw new Error(`minLpAmountOut: slippageFrac must be in [0, 1), got ${slippageFrac}`);
  }
  return applySlip(quotedShares, slippageFrac);
}
