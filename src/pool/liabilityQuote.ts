// LP-claim swap quote: the backend-priced conversion pipeline (`swapLiability` mirror). Its own
// module so the pool tables, which only read book math (`liability.ts`), do not bundle it.
import {
  type PoolLeg,
  type PoolState,
  type Quote,
  type QuoteResponseWire,
  type WireMeta,
  poolStateToWire,
  quoteFromWire,
  quotePathAsync,
  servableAddr,
} from '../amm/aimm.js';
import {
  type LiabLeg,
  type SwapLiabilityQuote,
  WAD,
  covWallsF,
  idxOf,
  feeCredit,
  poolSolvency,
} from './liability.js';

/** Sync pipeline deleted with the TS pricer: conversion is backend SSOT, use
 *  quoteSwapLiabilityCoreAsync. Kept by name so old imports fail loud, never silently local. */
export function quoteSwapLiabilityCore(): SwapLiabilityQuote | null {
  throw new Error(
    'aimm TS pricer deleted: liability conversion over POST /v1/quote|quote-path via quoteSwapLiabilityCoreAsync (backend SSOT)',
  );
}

/** Async mirror of `swapLiability` with the conversion injected (backend quoter). `poolC` is the
 *  pool rate (`poolSolvency`); a non-finite or non-positive rate is the chain's `FeedUnavailable`. */
export async function quoteSwapLiabilityCoreAsync(
  inLeg: LiabLeg,
  outLeg: LiabLeg,
  lpAmountIn: number,
  poolC: number,
  convert: (fairIn: number, poolC: number) => Promise<Quote | null>,
): Promise<SwapLiabilityQuote | null> {
  if (!(lpAmountIn > 0) || !(Number.isFinite(poolC) && poolC > 0)) return null;
  const idxIn = idxOf(inLeg);
  const idxOut = idxOf(outLeg);
  if (!(idxIn > 0) || !(idxOut > 0)) return null;
  const liabIn = (lpAmountIn * idxIn) / WAD;
  if (!(inLeg.liabilities > 0) || liabIn > inLeg.liabilities) return null;

  const fairIn = liabIn * poolC;
  const haircutIn = liabIn > fairIn ? liabIn - fairIn : 0;

  const q = await convert(fairIn, poolC);
  if (!q) return null;
  const markCap = fairIn * q.markPrice;
  const markCapBinding = q.amountOut > markCap;
  const conv = markCapBinding ? markCap : q.amountOut;

  const liabOut = conv / poolC;
  // The credited leg's claims grow with no reserve moving: coverage falls, never onto c_min
  // (`PoolLiquidityLib.swapLiability` requireWalls), else the chain reverts.
  if (
    covWallsF(
      outLeg.covBits ?? 0,
      outLeg.reserves,
      outLeg.liabilities,
      outLeg.reserves,
      outLeg.liabilities + (conv + (q.debitToll ?? 0) + (q.creditToll ?? 0)) / poolC,
    )
  )
    return null;
  // creditRate stamps C to 1e9 precision before fee booking, just as on chain.
  const stampedC = Math.floor(poolC * 1e9) / 1e9;
  const lpFeeCredit = feeCredit((q.grossOut * q.lpFeeBps) / 1e4, outLeg.liabilities, stampedC);
  const indexOutWad = Math.min(
    idxOut * (outLeg.liabilities > 0 ? 1 + lpFeeCredit / outLeg.liabilities : 1),
    Number((1n << 72n) - 1n),
  );
  const protoFeeCredit = feeCredit(
    (q.grossOut * q.protoFeeBps) / 1e4,
    outLeg.liabilities + lpFeeCredit,
    stampedC,
  );
  const lpAmountOut = (liabOut * WAD) / indexOutWad;
  if (!(lpAmountOut > 0)) return null;

  const faceMoved = (lpAmountIn * idxIn) / WAD;
  const faceReceived = (lpAmountOut * idxOut) / WAD;
  return {
    liabIn,
    haircutIn,
    fairIn,
    poolC,
    convQuoted: q.amountOut,
    markCap,
    conv,
    markCapBinding,
    liabOut,
    lpAmountOut,
    lpFeeCredit,
    protoFeeCredit,
    indexOutWad,
    impactBps: faceMoved > 0 ? (1 - faceReceived / faceMoved) * 1e4 : 0,
    haircutInBps: liabIn > 0 ? (haircutIn / liabIn) * 1e4 : 0,
    debitToll: q.debitToll ?? 0,
    creditToll: q.creditToll ?? 0,
    convSpreadBps: q.spreadBps / 2,
    convImpactBps: q.priceImpactBps,
    markClampBps:
      q.amountOut > 0 && markCapBinding ? ((q.amountOut - conv) / q.amountOut) * 1e4 : 0,
  };
}

/** Which law prices the conversion: `swap` the pool's swap law; `exit` a cross withdraw's claim
 *  law (out-leg toll, from-leg debit reported in `Quote.debitToll`); `credit` a liability swap's
 *  (`Quote.amountOut` is the re-credited value after both claim tolls). */
export type ConvertMode = 'swap' | 'exit' | 'credit';

/** `claim` wire of `PathRequestWire`: the claim face burned is `fairIn / C` (`fairIn = face·C`). */
function claimWire(
  credit: boolean,
  fairIn: number,
  poolC: number | undefined,
  decIn: number,
  tokenIn: string,
  tokenOut: string,
  tollWad: bigint | null | undefined,
  exit: boolean,
): { credit: boolean; face: string; c_wad: string; toll_wad?: string } {
  if (!(poolC !== undefined && Number.isFinite(poolC) && poolC > 0)) {
    throw new Error(`backendConvert: claim ${tokenIn}->${tokenOut} needs the pool rate C`);
  }
  return {
    credit,
    face: `0x${BigInt(Math.round((fairIn / poolC) * 10 ** decIn)).toString(16)}`,
    c_wad: `0x${BigInt(Math.round(poolC * 1e18)).toString(16)}`,
    // An exit always names its toll: absent/null/0 on the state is "no toll", not the backend default.
    ...(exit
      ? { toll_wad: `0x${(tollWad != null && tollWad > 0n ? tollWad : 0n).toString(16)}` }
      : {}),
  };
}

export interface BackendConvertOpts {
  meta: WireMeta;
  baseDecimals: number;
  backendBase?: string;
  /** Required on-chain address for served-mode pricing. */
  poolAddress: string;
}

/**
 * Backend conversion for the liability pipeline: ONE POST /v1/quote-path over the pool's books.
 * The backend walks the anchor-tree path between the two tokens, applies the pair's class rows and
 * settles once, as the chain does, so no leg dispatch or hub selection happens here.
 * Unknown legs throw (fail closed: never a silent zero-Quote the pipeline would mint nothing
 * from); an off-scale quote resolves null (no honest price for this pair).
 */
export function backendConvert(
  state: PoolState,
  tokenIn: string,
  tokenOut: string,
  opts: BackendConvertOpts,
  mode: ConvertMode = 'swap',
): (fairIn: number, poolC?: number) => Promise<Quote | null> {
  const dec = (t: string): number | undefined =>
    t === state.base ? opts.baseDecimals : state.legs[t]?.decimals;
  const decIn = dec(tokenIn);
  const decOut = dec(tokenOut);
  return async (fairIn: number, poolC?: number): Promise<Quote | null> => {
    const addr = servableAddr(opts.poolAddress);
    if (addr === null)
      throw new Error(`backendConvert: pool ${state.base} has no servable address`);
    if (decIn === undefined || decOut === undefined || tokenIn === tokenOut) {
      throw new Error(`backendConvert: unknown leg ${tokenIn}->${tokenOut} on base ${state.base}`);
    }
    const claim =
      mode === 'swap'
        ? undefined
        : claimWire(
            mode === 'credit',
            fairIn,
            poolC,
            decIn,
            tokenIn,
            tokenOut,
            state.exitTollWad,
            mode === 'exit',
          );
    const w = await quotePathAsync(
      {
        pool: poolStateToWire('pool', addr, state, opts.meta, opts.baseDecimals),
        token_in: tokenIn,
        token_out: tokenOut,
        amount_in: `0x${BigInt(Math.round(fairIn * 10 ** decIn)).toString(16)}`,
        ...(claim ? { claim } : {}),
      },
      opts.backendBase,
    );
    return quoteFromWire(w, decOut, [tokenIn, tokenOut], fairIn, false, decIn);
  };
}

/** Backend-priced liability swap: same pipeline as the core, rate off `state`, conversion over
 *  POST /v1/quote. Null when the pool has no rate (a mark is unusable: the chain reverts). */
export async function quoteSwapLiabilityAsync(
  state: PoolState,
  inLeg: LiabLeg,
  outLeg: LiabLeg,
  lpAmountIn: number,
  opts: BackendConvertOpts,
): Promise<SwapLiabilityQuote | null> {
  const c = poolSolvency(state);
  if (c === null) return null;
  return quoteSwapLiabilityCoreAsync(
    inLeg,
    outLeg,
    lpAmountIn,
    c,
    backendConvert(state, inLeg.symbol, outLeg.symbol, opts, 'credit'),
  );
}

export type { PoolLeg, QuoteResponseWire, WireMeta };
