// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.

/** Exact field names of each ABI struct, as the ABI declares them. */
export type AssetFields =
  | 'reserves'
  | 'liabilities'
  | 'anchor'
  | 'minLiquidity'
  | 'liquidityIndexWad'
  | 'minDispersionPbps'
  | 'curveId'
  | 'minFeePbps'
  | 'vegaBps'
  | 'depositCapCode'
  | 'decimals'
  | 'deadSeedPow10'
  | 'flags'
  | 'kappaCovBps'
  | 'maxLiabWeightBps';

export type DepositResultFields = 'lpAmount' | 'actualDeposit' | 'deadLp';

export type FeedDataFields =
  | 'mark1e18'
  | 'sigmaPbps'
  | 'updatedAtSecs'
  | 'ttlSecs'
  | 'confidenceBps'
  | 'flags'
  | 'maxDeviationBps'
  | 'sourceTsMs';

export type FeeParamsFields = 'protoSharePct' | 'flashFeePbps';

export type HookSlotFields = 'target' | 'flags' | 'lastCreditAt';

export type OracleConfigFields =
  | 'feedId'
  | 'primary'
  | 'mode'
  | 'quoteUnit'
  | 'refBandBps'
  | 'refFeedId'
  | 'refPrimary';

export type RiskConfigFields = 'flags' | 'kappaCovBps' | 'depositCapCode' | 'maxLiabWeightBps';

export type RiskFencesFields =
  | 'minFeeHardMinPbps'
  | 'minFeeHardMaxPbps'
  | 'vegaHardMinBps'
  | 'vegaHardMaxBps'
  | 'haircutSuppressorHardMaxBps'
  | 'haircutSuppressorHardMinBps'
  | 'maxDeltaBps';

export type SwapQuoteFields =
  | 'amountOut'
  | 'amountIn'
  | 'spreadPbps'
  | 'protoFee'
  | 'lpFee'
  | 'skewIn'
  | 'skewOut'
  | 'markPrice'
  | 'midPrice'
  | 'covToll'
  | 'routeHops'
  | 'hopAmounts'
  | 'hopPrices';

export type WithdrawResultFields = 'amountOut';

/**
 * Compile-time equality of an interface's keys with a generated field union. Resolves to `true`
 * only on an exact match; otherwise to an object naming the offending keys, so `Assert` fails the
 * typecheck with a message that says which field drifted. It must NOT resolve to `never` on
 * mismatch: `never` satisfies every constraint, so the assertion would be silently inert.
 */
export type FieldsMatch<T, K extends string> = [Exclude<keyof T, K>] extends [never]
  ? [Exclude<K, keyof T>] extends [never]
    ? true
    : { missingFromInterface: Exclude<K, keyof T> }
  : { notInAbi: Exclude<keyof T, K> };

/** Forces the check: only `true` satisfies the constraint. */
export type Assert<T extends true> = T;
