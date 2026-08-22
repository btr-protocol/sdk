/**
 * Pool Module - On-chain data fetching and transaction execution
 * Works in both frontend (with injected wallet) and backend (with private key)
 */

import { POOL_ABI } from '../abis/Pool.js';
import { decodeFn, encodeFn } from '../eth/abi';
import { multicallStrict } from '../eth/multicall';
import type { Address, Eip1193Provider, Hex } from '../eth/types';
import type { Assert, AssetFields, FieldsMatch, SwapQuoteFields } from '../abis/structs.generated.js';

// ─────────────────────────────────────────────────────────────
// Pool ABI (View Functions Only)
// ─────────────────────────────────────────────────────────────

export { POOL_ABI } from '../abis/Pool.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** `IPool.Asset`, field-for-field as `getAsset` returns it (POOL_ABI is the SSoT; the layout twin
 *  is `POOL_STRUCTS.Asset` in ./storage). */
export interface Asset {
  reserves: bigint;
  liabilities: bigint;
  anchor: Address;
  minLiquidity: bigint;
  liquidityIndexWad: bigint;
  minDispersionPbps: number;
  /** Pricing-shape pointer into PoolStorage.curves (shared preset table). Never 0 on a listed leg:
   *  `PoolConfig.validatePresetAssign` refuses the assignment, so there is no curve-less quote. */
  presetId: number;
  minFeePbps: number;
  vegaBps: number;
  haircutSuppressorBps: number;
  decimals: number;
  deadSeedPow10: number;
  /** Halt/enable bits. Was `RiskConfig.flags` in the deleted `riskConfigs` mapping. */
  flags: number;
  /** κ (bps): convex coverage-wall strength. 0 = off (volatiles). Was `RiskConfig.kappaCovBps`. */
  kappaCovBps: number;
}

/** Fails the typecheck if `Asset` and the ABI's struct stop agreeing on field names. */
export type _AssetMatchesAbi = Assert<FieldsMatch<Asset, AssetFields>>;

export interface SwapQuote {
  amountOut: bigint;
  amountIn: bigint;
  spreadPbps: number;
  protoFee: bigint;
  lpFee: bigint;
  skewIn: number;
  skewOut: number;
  /** Path oracle mark, exact WAD (1e18), tokenOut per tokenIn. */
  markPrice: bigint;
  /** Path executable mid, exact WAD (1e18): the mark displaced by inventory skew, which is what the
   *  book quotes around. (exec - mid) is extractable value, (mid - mark) is the skew premium. */
  midPrice: bigint;
  /** Coverage toll withheld from the gross output before the fee, tokenOut units. */
  covToll: bigint;
  routeHops: Address[];
  hopAmounts: bigint[];
  /** Per-leg realised execution price, WAD, oriented anchor-per-child. Analytics only: the pool
   *  populates it on `getSwapQuote` and leaves it empty on the swap-exec path. */
  hopPrices: bigint[];
}

export interface PoolAsset {
  token: Address;
  symbol: string;
  name: string;
  decimals: number;
  reserves: bigint;
  liabilities: bigint;
  coverage: bigint;
}

export interface PoolData {
  address: Address;
  name: string;
  assets: PoolAsset[];
}

// ─────────────────────────────────────────────────────────────
// Pool Data Fetching
// ─────────────────────────────────────────────────────────────

/**
 * Fetch asset data from pool contract
 */
export async function getAsset(
  provider: Eip1193Provider,
  poolAddress: Address,
  tokenAddress: Address,
): Promise<Asset> {
  const calldata = encodeFn({ abi: POOL_ABI, functionName: 'getAsset', args: [tokenAddress] });

  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data: calldata }, 'latest'],
  })) as Hex;

  return decodeFn({ abi: POOL_ABI, functionName: 'getAsset', data: result });
}

/**
 * Fetch coverage ratio for an asset
 */
export async function getCoverageRatio(
  provider: Eip1193Provider,
  poolAddress: Address,
  tokenAddress: Address,
): Promise<bigint> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'getCoverageRatio',
    args: [tokenAddress],
  });

  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data: calldata }, 'latest'],
  })) as Hex;

  return decodeFn({ abi: POOL_ABI, functionName: 'getCoverageRatio', data: result });
}

export type {
  LiabLeg,
  SwapLiabilityQuote,
} from './liability.js';
export {
  HAIRCUT_SUPPRESSOR_FULL_BPS,
  LIABILITY_SWAP_ENABLED_BIT,
  WAD as WAD_F,
  haircutFace,
  liabilitySwapEnabled,
  minLpAmountOut,
  quoteSwapLiability,
  quoteSwapLiabilityCore,
} from './liability.js';
export type { YieldHookKind } from './hooks.js';
export { YIELD_HOOK_KINDS, YIELD_HOOK_ADAPTER } from './hooks.js';
export type { HookSlot, OracleConfig, RiskConfig } from './storage.js';
export {
  POOL_STORAGE,
  POOL_STRUCTS,
  HOOK_PRE_OUTFLOW,
  HOOK_POST_INFLOW,
  HOOK_FLAGS_MASK,
  mappingBase,
  mappingBaseU16,
  resolveTokenStorageKey,
  readAssetPresetId,
  readCurve,
  readOracleConfig,
  readRiskConfig,
  readAssetHook,
  decodeHookSlot,
  getStorageAt,
} from './storage.js';

/**
 * Fetch LP balance for a user
 */
export async function getLPBalance(
  provider: Eip1193Provider,
  poolAddress: Address,
  userAddress: Address,
  tokenAddress: Address,
): Promise<bigint> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'getLPBalance',
    args: [userAddress, tokenAddress],
  });

  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data: calldata }, 'latest'],
  })) as Hex;

  return decodeFn({ abi: POOL_ABI, functionName: 'getLPBalance', data: result });
}

/**
 * Fetch swap quote
 */
export async function getSwapQuote(
  provider: Eip1193Provider,
  poolAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<SwapQuote> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'getSwapQuote',
    args: [tokenIn, tokenOut, amountIn],
  });

  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data: calldata }, 'latest'],
  })) as Hex;

  return decodeFn({ abi: POOL_ABI, functionName: 'getSwapQuote', data: result });
}

/**
 * Fetch complete pool data for multiple assets
 */
export async function getPoolData(
  provider: Eip1193Provider,
  poolAddress: Address,
  tokens: Array<{ address: Address; symbol: string; name: string }>,
  poolName: string,
): Promise<PoolData> {
  // One aggregate3 for all 2N reads. allowFailure=false, so a reverting leg reverts the whole
  // eth_call and throws — same contract as the per-token loop this replaced.
  const res = await multicallStrict<any>(
    provider,
    tokens.flatMap(t => [
      { address: poolAddress, abi: POOL_ABI, functionName: 'getAsset', args: [t.address] },
      { address: poolAddress, abi: POOL_ABI, functionName: 'getCoverageRatio', args: [t.address] },
    ]),
  );

  const assets: PoolAsset[] = tokens.map((token, i) => {
    const asset = res[i * 2] as Asset;
    return {
      token: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: Number(asset.decimals),
      reserves: asset.reserves,
      liabilities: asset.liabilities,
      coverage: res[i * 2 + 1] as bigint,
    };
  });

  return {
    address: poolAddress,
    name: poolName,
    assets,
  };
}

// ─────────────────────────────────────────────────────────────
// Transaction Functions
// ─────────────────────────────────────────────────────────────

/** EIP-7528 native-asset sentinel (shared/evm `Constants.NATIVE`). Pool wraps to wnative on pull. */
export const NATIVE_TOKEN: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const isNative = (token: Address) => token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
const txValue = (token: Address, amount: bigint): Hex =>
  isNative(token) ? `0x${amount.toString(16)}` : '0x0';

/** Opt-out sentinel for the trailing `deadline` param. `beforeDeadline` is a bare
 *  `block.timestamp > deadline` compare, so any far-future value opts out; uint32-max is the
 *  cheapest one. type(uint256).max is 32 nonzero calldata bytes (512 gas), this is 4 nonzero +
 *  28 zero (176 gas) — same semantics, 336 gas less. Pool.sol natspec still says
 *  type(uint256).max; that is descriptive, not enforced.
 *  ponytail: expires 2106-02-07, widen to uint40 if anything is still running. */
export const NO_DEADLINE: bigint = 0xffffffffn;
/** Default tx validity window (seconds) when no deadline is supplied. */
export const DEFAULT_DEADLINE_S = 600;
/** Unix-seconds deadline `DEFAULT_DEADLINE_S` from now. */
export const defaultDeadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_S);

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
  /** Unix-seconds expiry; defaults to now + DEFAULT_DEADLINE_S. Pass NO_DEADLINE to opt out. */
  deadline?: bigint;
}

export interface DepositParams {
  token: Address;
  amount: bigint;
}

export interface WithdrawParams {
  token: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
  /** Unix-seconds expiry; defaults to now + DEFAULT_DEADLINE_S. Pass NO_DEADLINE to opt out. */
  deadline?: bigint;
}

/**
 * Execute a swap transaction
 * NB: Caller must approve tokenIn to poolAddress before calling
 */
export async function swap(
  provider: Eip1193Provider,
  poolAddress: Address,
  params: SwapParams,
): Promise<Hex> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'swap',
    args: [
      params.tokenIn,
      params.tokenOut,
      params.amountIn,
      params.minAmountOut,
      params.recipient,
      params.deadline ?? defaultDeadline(),
    ],
  });

  // Send transaction (provider must support eth_sendTransaction)
  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        to: poolAddress,
        data: calldata,
        value: txValue(params.tokenIn, params.amountIn),
      },
    ],
  })) as Hex;
}

/**
 * Execute a deposit transaction
 * NB: Caller must approve token to poolAddress before calling
 */
export async function deposit(
  provider: Eip1193Provider,
  poolAddress: Address,
  params: DepositParams,
): Promise<Hex> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'deposit',
    args: [params.token, params.amount],
  });

  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        to: poolAddress,
        data: calldata,
        value: txValue(params.token, params.amount),
      },
    ],
  })) as Hex;
}

/**
 * Execute a withdraw transaction
 */
export async function withdraw(
  provider: Eip1193Provider,
  poolAddress: Address,
  params: WithdrawParams,
): Promise<Hex> {
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'withdraw',
    args: [params.token, params.lpAmount, params.minAmountOut, params.deadline ?? defaultDeadline()],
  });

  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        to: poolAddress,
        data: calldata,
        value: '0x0',
      },
    ],
  })) as Hex;
}

/** Same guard for the quote tuple; `routeHops`/`hopAmounts`/`hopPrices` are ABI fields too. */
export type _SwapQuoteMatchesAbi = Assert<FieldsMatch<SwapQuote, SwapQuoteFields>>;
