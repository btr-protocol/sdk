// Off-chain swap execution builder. BTR has NO on-chain router: a routed/split swap is a sequence of
// plain `approve` + `Pool.swap` calls the user's wallet submits directly — batched atomically via
// EIP-5792 `wallet_sendCalls` where the wallet supports it, else sequentially. This module turns a
// route plan (computed off-chain, e.g. by front `lib/amm/router`) into that ordered call list.
//
// Multicall3 CANNOT execute these: `Pool.swap` pulls tokenIn from `msg.sender`, which under
// Multicall3.aggregate3 is the Multicall3 contract (no funds, no allowance) → revert. So the calls
// must originate from the user account — EIP-5792 batch or N direct txs.

import { POOL_ABI } from '../abis/Pool.js';
import type { SwapPlan } from '../amm/router.js';
import { encodeFn } from '../eth/abi.js';
import { ERC20_ABI } from '../eth/erc20.js';
import type { Address, Hex } from '../eth/types.js';
import { NATIVE_TOKEN } from '../pool/index.js';
import { parseUnits } from '../utils/format.js';

/** One executable swap leg. For a split, pass several (parallel, each funded from the user's tokenIn).
 *  For a cross-pool 2-hop the caller passes two legs where leg2.amountIn is set conservatively to
 *  leg1.minOut (the exact bridged amount isn't known until leg1 executes; the small remainder stays
 *  with the user). */
export interface ExecLeg {
  pool: Address; // pool clone that runs this swap
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint; // per-leg slippage floor
  native?: boolean; // tokenIn is the native asset (no approve; carried as msg.value)
}

/** An encoded call ready for eth_sendTransaction / wallet_sendCalls. */
export interface ExecCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface BuildOpts {
  recipient: Address; // where tokenOut lands (usually the user)
  /** Return false to SKIP a token→pool approval (e.g. cached allowance already covers it). Called once
   *  per unique (tokenIn, pool). Default: emit a max approval for every non-native leg. */
  needsApproval?: (tokenIn: Address, pool: Address, amountIn: bigint) => boolean;
}

const MAX_UINT256 = (1n << 256n) - 1n;

export interface TokenMeta {
  address: Address;
  decimals: number;
}

export interface PlanLegOpts {
  slippageFrac: number; // per-leg slippage floor (0.005 = 0.5%)
  tokenOf: (symbol: string) => TokenMeta | undefined; // route symbols → on-chain meta
}

const toUnits = (v: number, decimals: number): bigint =>
  v > 0 ? parseUnits(v.toFixed(Math.min(decimals, 18)), decimals) : 0n;
const isNative = (a: Address): boolean => a.toLowerCase() === NATIVE_TOKEN.toLowerCase();

/** Map a router plan (amm/router rankSwap `best`) → ExecLeg[], largest part first (so the
 *  sequential fallback fills the biggest slice first). Direct part = 1 leg; cross part = 2 legs
 *  where leg2.amountIn = leg1.minOut (the exact bridged amount isn't known until leg1 executes).
 *  Native-sentinel tokenIn (EIP-7528) flags the leg for msg.value instead of an approval.
 *  Null when any pool address or token meta is missing. */
export function planToLegs(plan: SwapPlan, opts: PlanLegOpts): ExecLeg[] | null {
  const slip = opts.slippageFrac;
  const legs: ExecLeg[] = [];
  for (const part of [...plan.parts].sort((a, b) => b.fraction - a.fraction)) {
    const rl = part.route.legs;
    const partIn = part.fraction * plan.amountIn;
    if (rl.length === 1) {
      const tin = opts.tokenOf(rl[0].tokenIn);
      const tout = opts.tokenOf(rl[0].tokenOut);
      if (!rl[0].poolAddr || !tin || !tout) return null;
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: tin.address,
        tokenOut: tout.address,
        amountIn: toUnits(partIn, tin.decimals),
        minOut: toUnits(part.quote.amountOut * (1 - slip), tout.decimals),
        native: isNative(tin.address),
      });
    } else {
      const t1in = opts.tokenOf(rl[0].tokenIn);
      const tmid = opts.tokenOf(rl[0].tokenOut);
      const t2out = opts.tokenOf(rl[1].tokenOut);
      if (!rl[0].poolAddr || !rl[1].poolAddr || !t1in || !tmid || !t2out) return null;
      const leg1MinOut = toUnits(part.quote.fills[0].amountOut * (1 - slip), tmid.decimals);
      legs.push({
        pool: rl[0].poolAddr as Address,
        tokenIn: t1in.address,
        tokenOut: tmid.address,
        amountIn: toUnits(partIn, t1in.decimals),
        minOut: leg1MinOut,
        native: isNative(t1in.address),
      });
      legs.push({
        pool: rl[1].poolAddr as Address,
        tokenIn: tmid.address,
        tokenOut: t2out.address,
        amountIn: leg1MinOut,
        minOut: toUnits(part.quote.amountOut * (1 - slip), t2out.decimals),
        native: isNative(tmid.address),
      });
    }
  }
  return legs;
}

/** Ordered [approvals…, swaps…] calls for a routed/split swap. Approvals are deduped per (token,pool)
 *  and max-sized (approve once, reuse forever). Native-in legs carry `value` instead of an approval. */
export function buildSwapCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const approvals: ExecCall[] = [];
  const swaps: ExecCall[] = [];
  const seen = new Set<string>();

  for (const leg of legs) {
    if (!leg.native) {
      const key = `${leg.tokenIn.toLowerCase()}:${leg.pool.toLowerCase()}`;
      const need = opts.needsApproval
        ? opts.needsApproval(leg.tokenIn, leg.pool, leg.amountIn)
        : true;
      if (need && !seen.has(key)) {
        seen.add(key);
        approvals.push({
          to: leg.tokenIn,
          data: encodeFn({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [leg.pool, MAX_UINT256],
          }),
          value: 0n,
        });
      }
    }
    swaps.push({
      to: leg.pool,
      data: encodeFn({
        abi: POOL_ABI,
        functionName: 'swap',
        args: [leg.tokenIn, leg.tokenOut, leg.amountIn, leg.minOut, opts.recipient],
      }),
      value: leg.native ? leg.amountIn : 0n,
    });
  }
  // Approvals first so a same-batch swap sees the allowance.
  return [...approvals, ...swaps];
}

/** Σ msg.value across the calls (native-in legs) — the total to attach to a batched send. */
export function totalValue(calls: ExecCall[]): bigint {
  return calls.reduce((a, c) => a + c.value, 0n);
}
