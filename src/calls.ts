/**
 * Call builders for the writes the front, CLI and MCP make outside the swap/deposit/withdraw router
 * builders: one `TxCall` each, signed by `send` or handed out unsigned. ABIs that the backend
 * serves per pool generation are passed in (`abi`); the committed snapshot is the default.
 */

import { ADMIN_ABI } from './abis/Admin.js';
import { FAUCET_ABI } from './abis/Faucet.js';
import { POOL_ABI } from './abis/Pool.js';
import type { BatchOp } from './abis/solidity.generated.js';
import { type Abi, encodeFn } from './eth/abi.js';
import type { TxCall } from './eth/send.js';
import { ERC20_ABI } from './eth/erc20.js';
import type { Address, Hex } from './eth/types.js';

/** `functionName(args)` on `to`: the generic call every named builder below is. */
export const fnCall = (
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): TxCall => ({ to, data: encodeFn({ abi, functionName, args: [...args] }) });

export interface PoolToken {
  pool: Address;
  token: Address;
}

/** `Admin.batchRiskOp(pools, tokens, op, src)`: one owner tx over every (pool, token) leg. */
export const batchRiskOpCall = (
  admin: Address,
  pairs: readonly PoolToken[],
  op: BatchOp,
  src: number,
  abi: Abi = ADMIN_ABI,
): TxCall =>
  fnCall(admin, abi, 'batchRiskOp', [pairs.map((p) => p.pool), pairs.map((p) => p.token), op, src]);

/** `Admin.claimTreasury(pool, token)`, one call per leg. */
export const claimTreasuryCalls = (
  admin: Address,
  pairs: readonly PoolToken[],
  abi: Abi = ADMIN_ABI,
): TxCall[] => pairs.map((p) => fnCall(admin, abi, 'claimTreasury', [p.pool, p.token]));

/** Testnet faucet `claim(token)`, one call per token. */
export const faucetClaimCalls = (faucet: Address, tokens: readonly Address[]): TxCall[] =>
  tokens.map((t) => fnCall(faucet, FAUCET_ABI, 'claim', [t]));

/** Testnet faucet `register()`. */
export const faucetRegisterCall = (faucet: Address): TxCall =>
  fnCall(faucet, FAUCET_ABI, 'register');

/** Pool exit with an explicit floor and deadline: `withdrawTo(token, toToken, lp, minOut, deadline)`
 *  when `toToken` is set, else `withdraw(token, lp, minOut, deadline)`. */
export const poolExitCall = (
  pool: Address,
  leg: { token: Address; toToken?: Address },
  lp: bigint,
  minOut: bigint,
  deadline: bigint,
  abi: Abi = POOL_ABI,
): TxCall =>
  leg.toToken
    ? fnCall(pool, abi, 'withdrawTo', [leg.token, leg.toToken, lp, minOut, deadline])
    : fnCall(pool, abi, 'withdraw', [leg.token, lp, minOut, deadline]);

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
): Hex =>
  encodeFn({
    abi: POOL_ABI,
    functionName: 'withdraw',
    args: [token, lpAmount, minAmountOut, deadline],
  });
