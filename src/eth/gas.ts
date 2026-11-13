/**
 * Gas LIMIT for a state-changing call, built from its `eth_estimateGas` result.
 *
 * An estimate is the minimum that succeeds against the block it was taken on. Pool v2 deposits
 * and withdraws read the clock and the marks, so one block later the same call can need more
 * gas: the inner call's 63/64 cap then runs out and the tx reverts out-of-gas while still
 * billing the whole limit (Monad bills the limit). A fixed buffer over the estimate covers that
 * drift; the cap keeps a runaway estimate from turning into an oversized limit.
 *
 * Ceiling division, so the buffered value never lands below `estimate × factor`.
 */
export const GAS_LIMIT_CAP = 16_777_216n;
export const GAS_BUFFER_FACTOR = 1.25;

export function gasWithBuffer(
  estimate: bigint,
  factor: number = GAS_BUFFER_FACTOR,
  cap: bigint = GAS_LIMIT_CAP,
): bigint {
  const bps = BigInt(Math.round(factor * 10_000));
  const buffered = (estimate * bps + 9_999n) / 10_000n;
  return buffered < cap ? buffered : cap;
}
