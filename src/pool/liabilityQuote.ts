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
import { toUnits } from '../utils/format.js';
import {
  type LiabLeg,
  type SwapLiabilityQuote,
  WAD,
  claimRate,
  covBitsOf,
  covWallsF,
  feeCredit,
  idxOf,
} from './liability.js';

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
  // Both claim tolls (`swapLiability`: the in-leg debit, the out-leg credit) grow the credited book
  // the wall check below sizes. A conversion that does not report them has not priced them: fail
  // closed, never a zero toll that admits a credit the chain's `requireWalls` rejects.
  if (q.debitToll === undefined || q.creditToll === undefined) {
    throw new Error('quoteSwapLiabilityCoreAsync: claim conversion without debit_toll/credit_toll');
  }
  const { debitToll, creditToll } = q;
  const markCap = fairIn * q.markPrice;
  const markCapBinding = q.amountOut > markCap;
  const conv = markCapBinding ? markCap : q.amountOut;

  const liabOut = conv / poolC;
  // The credited leg's claims grow with no reserve moving: coverage falls, never onto c_min
  // (`PoolLiquidityLib.swapLiability` requireWalls), else the chain reverts.
  const outBits = covBitsOf(outLeg);
  if (outBits === null) return null;
  if (
    covWallsF(
      outBits,
      outLeg.reserves,
      outLeg.liabilities,
      outLeg.reserves,
      outLeg.liabilities + (conv + debitToll + creditToll) / poolC,
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
    debitToll,
    creditToll,
    convSpreadBps: q.spreadBps / 2,
    convImpactBps: q.priceImpactBps,
    markClampBps:
      q.amountOut > 0 && markCapBinding ? ((q.amountOut - conv) / q.amountOut) * 1e4 : 0,
  };
}

/** Which law prices the conversion: `swap` the pool's swap law; `exit` a cross withdraw's claim
 *  law (out-leg toll, from-leg debit reported in `Quote.debitToll`); `credit` a liability swap's
 *  (`Quote.amountOut` is the re-credited value after both claim tolls). */
type ConvertMode = 'swap' | 'exit' | 'credit';

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
  chainCWad: bigint | null | undefined,
): { credit: boolean; face: string; c_wad: string; toll_wad?: string } {
  if (!(poolC !== undefined && Number.isFinite(poolC) && poolC > 0)) {
    throw new Error(`backendConvert: claim ${tokenIn}->${tokenOut} needs the pool rate C`);
  }
  return {
    credit,
    // Chain floors `withdrawValue` and `fairValue` (`PoolLiquidityLib.sol:434,528`): both words
    // round toward the pool, never up (a rounded-up face prices a claim the burn does not carry).
    face: `0x${floorUnits(fairIn / poolC, decIn).toString(16)}`,
    // The chain's own word when the rate IS that word (a double cannot hold a 18-digit WAD: the round
    // trip drifts by ~1e-14); else the floored model rate.
    c_wad: `0x${(chainCWad && chainCWad > 0n && Number(chainCWad) / 1e18 === poolC ? chainCWad : floorUnits(poolC, 18)).toString(16)}`,
    // An exit always names its toll; an unloaded one (absent/null) is unknown, never 0.
    ...(exit ? { toll_wad: `0x${exitToll(tollWad, tokenIn, tokenOut).toString(16)}` } : {}),
  };
}

/** `floor(v · 10^d)`, shaved a few ulps so an f64 product that rounded up across an integer never
 *  lands above the exact floor (an exact integer can come out one unit under: toward the pool). */
function floorUnits(v: number, d: number): bigint {
  return toUnits(v * (1 - 2 ** -46), d);
}

function exitToll(tollWad: bigint | null | undefined, tokenIn: string, tokenOut: string): bigint {
  if (tollWad == null || tollWad < 0n) {
    throw new Error(`backendConvert: exit ${tokenIn}->${tokenOut} needs the pool's exit toll`);
  }
  return tollWad;
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
            state.solvencyOk === false ? null : state.solvencyCWad,
          );
    const w = await quotePathAsync(
      {
        pool: poolStateToWire('pool', addr, state, opts.meta, opts.baseDecimals),
        token_in: tokenIn,
        token_out: tokenOut,
        // A claim's `fairValue` is floored on chain (`:528`); a plain swap keeps its nearest unit.
        amount_in: `0x${(claim ? floorUnits(fairIn, decIn) : BigInt(Math.round(fairIn * 10 ** decIn))).toString(16)}`,
        ...(claim ? { claim } : {}),
      },
      opts.backendBase,
    );
    return quoteFromWire(w, decOut, [tokenIn, tokenOut], fairIn, false, decIn);
  };
}

/** Backend-priced liability swap: same pipeline as the core, rate off `state`, conversion over
 *  POST /v1/quote-path. Null when the pool has no rate (a mark is unusable: the chain reverts). */
export async function quoteSwapLiabilityAsync(
  state: PoolState,
  inLeg: LiabLeg,
  outLeg: LiabLeg,
  lpAmountIn: number,
  opts: BackendConvertOpts,
): Promise<SwapLiabilityQuote | null> {
  const c = claimRate(state);
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
