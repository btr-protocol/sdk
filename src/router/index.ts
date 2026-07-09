// Off-chain swap execution builder. BTR has NO on-chain router: a routed/split swap is a sequence of
// plain `approve` + `Pool.swap` calls the user's wallet submits directly — batched atomically via
// EIP-5792 `wallet_sendCalls` where the wallet supports it, else sequentially. This module turns a
// route plan (computed off-chain, e.g. by front `lib/amm/router`) into that ordered call list.
//
// Multicall3 CANNOT execute these: `Pool.swap` pulls tokenIn from `msg.sender`, which under
// Multicall3.aggregate3 is the Multicall3 contract (no funds, no allowance) → revert. So the calls
// must originate from the user account — EIP-5792 batch or N direct txs.

import { encodeFn } from '../eth/abi.js';
import type { Address, Hex } from '../eth/types.js';
import { ERC20_ABI } from '../eth/erc20.js';
import { POOL_ABI } from '../abis/Pool.js';

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

/** Ordered [approvals…, swaps…] calls for a routed/split swap. Approvals are deduped per (token,pool)
 *  and max-sized (approve once, reuse forever). Native-in legs carry `value` instead of an approval. */
export function buildSwapCalls(legs: ExecLeg[], opts: BuildOpts): ExecCall[] {
  const approvals: ExecCall[] = [];
  const swaps: ExecCall[] = [];
  const seen = new Set<string>();

  for (const leg of legs) {
    if (!leg.native) {
      const key = `${leg.tokenIn.toLowerCase()}:${leg.pool.toLowerCase()}`;
      const need = opts.needsApproval ? opts.needsApproval(leg.tokenIn, leg.pool, leg.amountIn) : true;
      if (need && !seen.has(key)) {
        seen.add(key);
        approvals.push({
          to: leg.tokenIn,
          data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [leg.pool, MAX_UINT256] }),
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
