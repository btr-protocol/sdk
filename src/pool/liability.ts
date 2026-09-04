// Liability-swap pipeline over the backend quoter (POST /v1/quote|route).
// Same style as front/src/lib/lpMath.ts: f64 in, f64 out, no chain reads. State inputs come from
// getAsset (sdk/pool/index.ts); conversion is backend SSOT (quoteLegAsync / routeAsync), never
// the deleted TS curve replica.
//
// Pipeline (contract order, PoolLiquidity.sol:428-464):
//   1. liabIn     = lpAmountIn * idxIn / WAD                          (:428)
//   2. haircutIn  = applyHaircut(liabIn, R_in, L_in, suppressor_in)    (:93, :435)
//   3. conv       = backendConvert(in -> out, fairIn); spread/toll/skew embedded (:437)
//   4. markCap    = fairIn * q.markPrice   [Lemma B cap, _markCap :379]; conv clamped (:442)
//   5. haircutOut applied to the converted amount                      (:454)
//   6. lpAmountOut = liabOut / idxOut (deadOut ~ 0 on any seeded live leg) (:458-464)
//
// Protocol-fee EXEMPT and no accrueLpFee booking on-chain (:446-453): the swapper pays the full
// embedded spread only; no reserves move. The decomposition below surfaces each component so the
// UI can show impact vs the 1:1-face baseline without hiding a binding clamp inside it.

import {
  INTERIOR_ENDPOINT,
  type PoolLeg,
  type PoolState,
  type Quote,
  type QuoteResponseWire,
  type RouteRequestWire,
  type WireMeta,
  hubEndpointWire,
  poolStateToWire,
  premiumBps,
  quoteFromWire,
  quoteLegAsync,
  routeAsync,
} from '../amm/aimm.js';
import { applySlip } from '../utils/maths.js';

/** SC.WAD */
export const WAD = 1e18;
/** PoolConstantsLib.sol:15: bit 2 of asset flags. Both legs must carry it (:425-426). */
export const LIABILITY_SWAP_ENABLED_BIT = 1 << 2;
/** PoolConstantsLib.sol:106: HAIRCUT_SUPPRESSOR_FULL_BPS = 2 * BPS. */
export const HAIRCUT_SUPPRESSOR_FULL_BPS = 20_000;

/** The slice of IPool.Asset the liability math reads. Build from getAsset output. Face units. */
export interface LiabLeg {
  symbol: string;
  reserves: number;
  liabilities: number;
  haircutSuppressorBps: number;
  /** Asset.liquidityIndexWad: face-per-share in WAD. Default WAD (1 share = 1 face). */
  indexWad?: number;
}

const idxOf = (leg: LiabLeg): number => leg.indexWad ?? WAD;

/** PoolIOLib.checkRiskFlags(asset.flags, LIABILITY_SWAP_ENABLED_BIT) as a predicate. */
export const liabilitySwapEnabled = (flags: number): boolean =>
  (flags & LIABILITY_SWAP_ENABLED_BIT) !== 0;

/** Exact mirror of PoolLiquidity.applyHaircut (:93-112) in face units.
 *  deficit = (L-R)/L scaled by (1 - suppressor/FULL), capped at 100%; haircut rounds UP so the
 *  dust stays with the pool. Identity when L == 0 or covered. */
export function haircutFace(
  amount: number,
  reserves: number,
  liabilities: number,
  haircutSuppressorBps: number,
): { actual: number; haircut: number } {
  if (!(haircutSuppressorBps >= 0 && haircutSuppressorBps <= HAIRCUT_SUPPRESSOR_FULL_BPS)) {
    throw new RangeError('haircutSuppressorBps outside [0, HAIRCUT_SUPPRESSOR_FULL_BPS]');
  }
  if (!(liabilities > 0) || reserves >= liabilities) return { actual: amount, haircut: 0 };
  // deficit ∈ [0,1], factor ∈ [0,1] (full suppressor = no haircut), ratio capped at 100%.
  const deficit = (liabilities - reserves) / liabilities;
  const factor = 1 - haircutSuppressorBps / HAIRCUT_SUPPRESSOR_FULL_BPS;
  const ratio = Math.min(deficit * factor, 1);
  const haircut = Math.ceil(amount * ratio);
  return { actual: amount - haircut, haircut };
}

export interface SwapLiabilityQuote {
  /** Face burned on the in leg (shares · idxIn). */
  liabIn: number;
  haircutIn: number;
  fairIn: number;
  /** Quoted conversion net of embedded spread/toll/skew, before the Lemma B clamp. */
  convQuoted: number;
  /** fairIn · markPrice: Lemma B re-denomination bound (_markCap :379). Decimal adjustment is
   *  implicit: both amounts and the WAD ratio here live in token units. */
  markCap: number;
  /** min(convQuoted, markCap): what actually converts. */
  conv: number;
  /** True when adaptive dispersion pushed the quoted conversion past the oracle mark. */
  markCapBinding: boolean;
  haircutOut: number;
  /** Final credited face on the out leg. */
  liabOut: number;
  /** liabOut / idxOut: shares minted post-dead-seed (deadOut ~ 0 on a seeded live leg). */
  lpAmountOut: number;
  /** 1 − received/redeemed-equivalent vs the 1:1-face baseline, bps of face moved. */
  impactBps: number;
  /** Decomposition, bps of the respective base: real components of impactBps. */
  haircutInBps: number;
  haircutOutBps: number;
  /** Half-spread actually deducted from the conversion output (path model). */
  convSpreadBps: number;
  /** Pure-curve movement along the fill. */
  convImpactBps: number;
  /** Size of the Lemma B clamp when binding, bps of convQuoted; else 0. */
  markClampBps: number;
}

/** Sync pipeline deleted with the TS pricer: conversion is backend SSOT, use
 *  quoteSwapLiabilityCoreAsync. Kept by name so old imports fail loud, never silently local. */
export function quoteSwapLiabilityCore(): SwapLiabilityQuote | null {
  throw new Error(
    'aimm TS pricer deleted: liability conversion over POST /v1/quote|route via quoteSwapLiabilityCoreAsync (backend SSOT)',
  );
}

/** Async mirror of the core pipeline with the conversion injected (backend quoter). */
export async function quoteSwapLiabilityCoreAsync(
  inLeg: LiabLeg,
  outLeg: LiabLeg,
  lpAmountIn: number,
  convert: (fairIn: number) => Promise<Quote>,
): Promise<SwapLiabilityQuote | null> {
  if (!(lpAmountIn > 0)) return null;
  const idxIn = idxOf(inLeg);
  const idxOut = idxOf(outLeg);
  const liabIn = (lpAmountIn * idxIn) / WAD;
  if (!(inLeg.liabilities > 0) || liabIn > inLeg.liabilities) return null;

  const { actual: fairIn, haircut: haircutIn } = haircutFace(
    liabIn,
    inLeg.reserves,
    inLeg.liabilities,
    inLeg.haircutSuppressorBps,
  );

  const q = await convert(fairIn);
  const markCap = fairIn * q.markPrice;
  const markCapBinding = q.amountOut > markCap;
  const conv = markCapBinding ? markCap : q.amountOut;

  const { actual: liabOut, haircut: haircutOut } = haircutFace(
    conv,
    outLeg.reserves,
    outLeg.liabilities,
    outLeg.haircutSuppressorBps,
  );
  const lpAmountOut = (liabOut * WAD) / idxOut;
  if (!(lpAmountOut > 0)) return null;

  const faceMoved = (lpAmountIn * idxIn) / WAD;
  const faceReceived = (lpAmountOut * idxOut) / WAD;
  return {
    liabIn,
    haircutIn,
    fairIn,
    convQuoted: q.amountOut,
    markCap,
    conv,
    markCapBinding,
    haircutOut,
    liabOut,
    lpAmountOut,
    impactBps: faceMoved > 0 ? (1 - faceReceived / faceMoved) * 1e4 : 0,
    haircutInBps: liabIn > 0 ? (haircutIn / liabIn) * 1e4 : 0,
    haircutOutBps: conv > 0 ? (haircutOut / conv) * 1e4 : 0,
    convSpreadBps: q.spreadBps / 2,
    convImpactBps: q.priceImpactBps,
    markClampBps:
      q.amountOut > 0 && markCapBinding ? ((q.amountOut - conv) / q.amountOut) * 1e4 : 0,
  };
}

export interface BackendConvertOpts {
  meta: WireMeta;
  baseDecimals: number;
  backendBase?: string;
}

/**
 * Backend conversion for the liability pipeline: one POST /v1/quote per walked leg,
 * except the spoke→spoke cross which routes over POST /v1/route (routing SSOT).
 * Unknown legs throw (fail closed: never a silent zero-Quote the pipeline would mint
 * nothing from). Composed in fill order over the backend's own outputs.
 */
export function backendConvert(
  state: PoolState,
  tokenIn: string,
  tokenOut: string,
  opts: BackendConvertOpts,
): (fairIn: number) => Promise<Quote> {
  const base = state.base;
  const inBase = tokenIn === base;
  const outBase = tokenOut === base;
  const decIn = inBase ? opts.baseDecimals : (state.legs[tokenIn]?.decimals ?? opts.baseDecimals);
  const legIn = state.legs[tokenIn];
  const legOut = state.legs[tokenOut];
  // A leg that touches the hub is settled against the HUB's endpoint (its coverage wall tolls a
  // sell into it, its vega enters the spread both ways). No hub book ⇒ no honest quote.
  const hub = state.hub ? hubEndpointWire(state.hub, opts.baseDecimals) : null;
  const toU128 = (tok: number, dec: number): string => {
    if (!Number.isFinite(tok) || tok < 0) throw new Error('backendConvert: non-finite amount');
    const scaled = Math.round(tok * 10 ** dec);
    if (!Number.isSafeInteger(scaled)) throw new Error('backendConvert: amount exceeds 2^53');
    return `0x${BigInt(scaled).toString(16)}`;
  };
  return async (fairIn: number): Promise<Quote> => {
    if (!inBase && outBase && legIn) {
      if (!hub) throw new Error('backendConvert: no hub book for a sell into the base');
      const w = await quoteLegAsync(legIn, fairIn, true, decIn, hub, opts.backendBase);
      return quoteFromWire(w, decIn, opts.baseDecimals, [tokenIn, tokenOut], fairIn);
    }
    if (inBase && !outBase && legOut) {
      if (!hub) throw new Error('backendConvert: no hub book for a buy out of the base');
      const w = await quoteLegAsync(legOut, fairIn, false, decIn, hub, opts.backendBase);
      return quoteFromWire(w, decIn, legOut.decimals, [tokenIn, tokenOut], fairIn);
    }
    if (!inBase && !outBase && legIn && legOut) {
      const wire = poolStateToWire('liab', undefined, state, opts.meta, opts.baseDecimals);
      const req: RouteRequestWire = {
        pools: [wire],
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: toU128(fairIn, decIn),
      };
      const routed = await routeAsync(req, opts.backendBase);
      const amountOut = Number(BigInt(routed.best_amount_out)) / 10 ** legOut.decimals;
      // Cross: the hub is INTERIOR on both hops, never the path's delivering endpoint.
      const w1 = await quoteLegAsync(
        legIn,
        fairIn,
        true,
        decIn,
        INTERIOR_ENDPOINT,
        opts.backendBase,
      );
      const q1 = quoteFromWire(w1, decIn, opts.baseDecimals, [tokenIn, base], fairIn);
      const baseMid = q1.amountOut;
      const w2 = await quoteLegAsync(
        legOut,
        baseMid,
        false,
        opts.baseDecimals,
        INTERIOR_ENDPOINT,
        opts.backendBase,
      );
      const q2 = quoteFromWire(w2, opts.baseDecimals, legOut.decimals, [base, tokenOut], baseMid);
      const avg = fairIn > 0 && amountOut > 0 ? amountOut / fairIn : 0;
      const mid = q1.midPrice * q2.midPrice;
      const mark = q1.markPrice * q2.markPrice;
      return {
        amountOut,
        grossOut: q2.grossOut,
        avgPrice: avg,
        midPrice: mid,
        markPrice: mark,
        midPremiumBps: premiumBps(mid, mark),
        netPremiumBps: premiumBps(avg, mark),
        priceImpactBps: q1.priceImpactBps + q2.priceImpactBps,
        spreadBps: q1.spreadBps + q2.spreadBps,
        lpFeeBps: q1.lpFeeBps + q2.lpFeeBps,
        protoFeeBps: 0,
        covTollBps: q2.covTollBps,
        maxIn: Number.POSITIVE_INFINITY,
        route: [tokenIn, base, tokenOut],
      };
    }
    throw new Error(`backendConvert: unknown leg ${tokenIn}->${tokenOut} on base ${base}`);
  };
}

/** Backend-priced liability swap: same pipeline as the core, conversion over POST /v1/quote. */
export function quoteSwapLiabilityAsync(
  state: PoolState,
  inLeg: LiabLeg,
  outLeg: LiabLeg,
  lpAmountIn: number,
  opts: BackendConvertOpts,
): Promise<SwapLiabilityQuote | null> {
  return quoteSwapLiabilityCoreAsync(
    inLeg,
    outLeg,
    lpAmountIn,
    backendConvert(state, inLeg.symbol, outLeg.symbol, opts),
  );
}

export type { PoolLeg, QuoteResponseWire, WireMeta };

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
