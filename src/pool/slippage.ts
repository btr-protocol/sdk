// Leaf module: no ABI imports, so a caller can take it without the `@btr-protocol/sdk/pool` barrel.

/** `minLpOut` for `Pool.depositMin`: the shown shares less the caller's slippage (bps), floored. */
export const minLpOut = (shares: bigint, slippageBps: bigint): bigint =>
  (shares * (10_000n - slippageBps)) / 10_000n;

/** Front default tolerance (`DEFAULT_SLIPPAGE.fixedPct` 0.5%, front/src/config/settings.tsx). */
export const DEFAULT_SLIPPAGE_BPS = 50;
/** Front hard cap (`MAX_SLIPPAGE_PCT` 99.9%): at or above 100% a floor is zero. */
export const MAX_SLIPPAGE_BPS = 9_990;

/** `--slippage-bps` value: integer in (0, 10000) and at most {@link MAX_SLIPPAGE_BPS}; else throws. */
export function slippageBps(v: string | number | undefined): number {
  const bp = v === undefined ? DEFAULT_SLIPPAGE_BPS : Number(v);
  if (!(Number.isInteger(bp) && bp > 0 && bp < 10_000))
    throw new Error('--slippage-bps must be an integer in (0, 10000)');
  if (bp > MAX_SLIPPAGE_BPS) throw new Error(`--slippage-bps above the ${MAX_SLIPPAGE_BPS} cap`);
  return bp;
}

/** The floor to sign off an on-chain `preview`: `preview·(1 − bps)`, or the caller's `minOut` when
 *  it sits in [preview·(1 − cap), preview]. A zero preview or floor refuses: never a zero floor. */
export function floorFromPreview(preview: bigint, bps: number, minOut?: bigint): bigint {
  if (!(preview > 0n)) throw new Error('on-chain preview is zero: nothing to floor');
  if (minOut !== undefined) {
    const lowest = minLpOut(preview, BigInt(MAX_SLIPPAGE_BPS));
    if (minOut < lowest || minOut <= 0n)
      throw new Error(
        `--min-out ${minOut} below preview ${preview} less the ${MAX_SLIPPAGE_BPS} bps cap (${lowest})`,
      );
    if (minOut > preview)
      throw new Error(`--min-out ${minOut} above the on-chain preview ${preview}: would revert`);
    return minOut;
  }
  const floor = minLpOut(preview, BigInt(bps));
  if (!(floor > 0n)) throw new Error('derived floor is zero: amount too small');
  return floor;
}
