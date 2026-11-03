// Leaf module: no ABI imports, so a caller can take it without the `@btr-protocol/sdk/pool` barrel.

/** `minLpOut` for `Pool.depositMin`: the shown shares less the caller's slippage (bps), floored. */
export const minLpOut = (shares: bigint, slippageBps: bigint): bigint =>
  (shares * (10_000n - slippageBps)) / 10_000n;
