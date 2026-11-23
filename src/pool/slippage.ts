// Leaf module: no ABI imports, so a caller can take it without the `@btr-protocol/sdk/pool` barrel.

/** `minLpOut` for `Pool.depositMin`: the shown shares less the caller's slippage (bps), floored. */
export const minLpOut = (shares: bigint, slippageBps: bigint): bigint =>
  (shares * (10_000n - slippageBps)) / 10_000n;

/** Front default tolerance (`DEFAULT_SLIPPAGE.fixedPct` 0.5%, front/src/config/settings.tsx). */
export const DEFAULT_SLIPPAGE_BPS = 50;
/** Front hard cap (`MAX_SLIPPAGE_PCT` 99.9%): at or above 100% a floor is zero. */
export const MAX_SLIPPAGE_BPS = 9_990;
/** MCP cap: an agent build has no human confirm step, so its floor sits within 5% of the preview. */
export const MCP_MAX_SLIPPAGE_BPS = 500;

/** Floor's distance below the preview in bps, floored: `(preview − min)·10000 / preview`. */
export const lossBps = (preview: bigint, min: bigint): number =>
  preview > 0n ? Number(((preview - min) * 10_000n) / preview) : 0;

/** `--slippage-bps` value: integer in (0, 10000) and at most `cap`; else throws. */
export function slippageBps(v: string | number | undefined, cap = MAX_SLIPPAGE_BPS): number {
  // Digits only: Number() also takes '0x1f4', '5e2' and ' 500 '.
  if (typeof v === 'string' && !/^\d+$/.test(v))
    throw new Error('--slippage-bps must be an integer in (0, 10000)');
  const bp = v === undefined ? DEFAULT_SLIPPAGE_BPS : Number(v);
  if (!(Number.isInteger(bp) && bp > 0 && bp < 10_000))
    throw new Error('--slippage-bps must be an integer in (0, 10000)');
  if (bp > cap) throw new Error(`--slippage-bps above the ${cap} cap`);
  return bp;
}

/** The floor to sign off an on-chain `preview`: `preview·(1 − bps)`, or the caller's `minOut` when
 *  it sits in [preview·(1 − cap), preview]. A zero preview or floor refuses: never a zero floor. */
export function floorFromPreview(
  preview: bigint,
  bps: number,
  minOut?: bigint,
  cap = MAX_SLIPPAGE_BPS,
): bigint {
  if (!(preview > 0n)) throw new Error('on-chain preview is zero: nothing to floor');
  if (minOut !== undefined) {
    const lowest = minLpOut(preview, BigInt(cap));
    if (minOut < lowest || minOut <= 0n)
      throw new Error(
        `--min-out ${minOut} below preview ${preview} less the ${cap} bps cap (${lowest})`,
      );
    if (minOut > preview)
      throw new Error(`--min-out ${minOut} above the on-chain preview ${preview}: would revert`);
    return minOut;
  }
  const floor = minLpOut(preview, BigInt(bps));
  if (!(floor > 0n)) throw new Error('derived floor is zero: amount too small');
  return floor;
}
