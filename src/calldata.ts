/**
 * The one encoder per pool / ERC-20 write selector (router legs, pool actions, CLI, front). ABI-only
 * imports: `calls.ts` pulls the Admin + Faucet ABIs, which the swap and pool bundles must not carry.
 */

import { POOL_ABI } from './abis/Pool.js';
import { ROUTER_ABI } from './abis/Router.js';
import { type Abi, encodeFn } from './eth/abi.js';
import { ERC20_ABI } from './eth/erc20.js';
import { WNATIVE_ABI } from './eth/weth.js';
import type { Address, Hex } from './eth/types.js';

/** `approve(spender, amount)`: the one ERC-20 approve encoder (router legs, pool deposits, front). */
export const approveCallData = (spender: Address, amount: bigint): Hex =>
  encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] });

/** `depositMin(token, amount, minLpOut)`. A zero or missing floor guards nothing: refused. */
export function depositCallData(token: Address, amount: bigint, minLpOut: bigint): Hex {
  if (!(minLpOut > 0n)) throw new Error(`minLpOut must be a positive floor, got ${minLpOut}`);
  return encodeFn({ abi: POOL_ABI, functionName: 'depositMin', args: [token, amount, minLpOut] });
}

/** `swapLiability(from, to, lpAmountIn, minLpAmountOut, deadline)`: the one encoder every
 *  liability-swap call goes through (deposit/redeem transfer routes, standalone debt swap). */
export function swapLiabilityCallData(
  from: Address,
  to: Address,
  lpAmountIn: bigint,
  minLpAmountOut: bigint,
  deadline: bigint,
): Hex {
  return encodeFn({
    abi: POOL_ABI,
    functionName: 'swapLiability',
    args: [from, to, lpAmountIn, minLpAmountOut, deadline],
  });
}

/** v1 pools' plain `deposit(token, amount)`: no on-chain floor, the caller's simulated floor is the guard. */
export const depositV1CallData = (token: Address, amount: bigint): Hex =>
  encodeFn({ abi: POOL_ABI, functionName: 'deposit', args: [token, amount] });

/** `withdraw(token, lpAmount, minAmountOut, deadline)`: the one same-leg exit encoder. */
export const withdrawCallData = (
  token: Address,
  lpAmount: bigint,
  minAmountOut: bigint,
  deadline: bigint,
  abi: Abi = POOL_ABI,
): Hex =>
  encodeFn({
    abi,
    functionName: 'withdraw',
    args: [token, lpAmount, minAmountOut, deadline],
  });

/** `swap_qe(tokenIn, tokenOut, amountIn, minOut, recipient, deadline)`: the one pool swap encoder. */
export const swapQeCallData = (
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  minOut: bigint,
  recipient: Address,
  deadline: bigint,
): Hex =>
  encodeFn({
    abi: POOL_ABI,
    functionName: 'swap_qe',
    args: [tokenIn, tokenOut, amountIn, minOut, recipient, deadline],
  });

/** `withdrawTo(tokenFrom, tokenTo, lpAmount, minAmountOut, deadline)`: the one cross-leg exit encoder. */
export const withdrawToCallData = (
  tokenFrom: Address,
  tokenTo: Address,
  lpAmount: bigint,
  minAmountOut: bigint,
  deadline: bigint,
): Hex =>
  encodeFn({
    abi: POOL_ABI,
    functionName: 'withdrawTo',
    args: [tokenFrom, tokenTo, lpAmount, minAmountOut, deadline],
  });

/** Router `swap(parts, floors, recipient, deadline)`. */
export const routerSwapCallData = (
  parts: readonly unknown[],
  floors: readonly unknown[],
  recipient: Address,
  deadline: bigint,
): Hex =>
  encodeFn({ abi: ROUTER_ABI, functionName: 'swap', args: [parts, floors, recipient, deadline] });

export const wrapCallData = (): Hex => encodeFn({ abi: WNATIVE_ABI, functionName: 'deposit' });
export const unwrapCallData = (amount: bigint): Hex =>
  encodeFn({ abi: WNATIVE_ABI, functionName: 'withdraw', args: [amount] });
