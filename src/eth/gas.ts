import { estimateGas } from './rpc';
import type { Eip1193Provider, TransactionRequest } from './types';

/**
 * Gas LIMIT for a state-changing call, built from its `eth_estimateGas` result.
 *
 * An estimate is the minimum that succeeds against the block it was taken on. Pool v2 deposits
 * and withdraws read the clock and the marks, so one block later the same call can need more
 * gas: the inner call's 63/64 cap then runs out and the tx reverts out-of-gas while still
 * billing the whole limit (Monad bills the limit). A fixed buffer over the estimate covers that
 * drift; the cap bounds the buffer, never the estimate itself.
 *
 * Ceiling division on an integer basis-point factor, so the buffered value never lands below
 * `estimate × factor`: a factor with more than 4 decimals is rounded UP to the next bp (1.00001 ->
 * 1.0001), never down.
 */
export const GAS_LIMIT_CAP = 16_777_216n;
export const GAS_BUFFER_FACTOR = 1.25;

export function gasWithBuffer(
  estimate: bigint,
  factor: number = GAS_BUFFER_FACTOR,
  cap: bigint = GAS_LIMIT_CAP,
): bigint {
  if (!Number.isFinite(factor) || factor < 1) {
    throw new RangeError(`gas buffer factor must be finite and >= 1, got ${factor}`);
  }
  if (estimate > cap) {
    throw new RangeError(`gas estimate ${estimate} exceeds the cap ${cap}`);
  }
  // toFixed(6) absorbs float noise (1.1 * 10000 = 11000.000000000002) before the ceil.
  const bps = BigInt(Math.ceil(Number((factor * 10_000).toFixed(6))));
  const buffered = (estimate * bps + 9_999n) / 10_000n;
  return buffered < cap ? buffered : cap;
}

/** `eth_estimateGas` for `tx`, then {@link gasWithBuffer}: the limit a send should carry. The
 *  revert of a failed estimate is thrown as the transport raised it; callers decode it. */
export async function estimateCallGas(
  provider: Eip1193Provider,
  tx: Partial<TransactionRequest>,
  factor: number = GAS_BUFFER_FACTOR,
): Promise<bigint> {
  return gasWithBuffer(await estimateGas(provider, tx), factor);
}
