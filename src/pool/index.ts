/**
 * Pool Module - On-chain data fetching and transaction execution
 * Works in both frontend (with injected wallet) and backend (with private key)
 */

import { POOL_ABI } from '../abis/Pool.js';
import { decodeFn, encodeFn } from '../eth/abi';
import type { Address, Eip1193Provider, Hex } from '../eth/types';

// ─────────────────────────────────────────────────────────────
// Pool ABI (View Functions Only)
// ─────────────────────────────────────────────────────────────

export { POOL_ABI } from '../abis/Pool.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Asset {
  reserves: bigint;
  liabilities: bigint;
  minLiquidity: bigint;
  liquidityIndex: bigint;
  lastUpdate: number;
  minDispersion: number;
  anchor: Address;
  minFeeBps: number;
  maxFeeBps: number;
  maxDispersion: number;
  anchorDepth: number;
  decimals: number;
  gamma: number;
  vega: number;
  haircutSuppressor: number;
  reservationPrice: bigint;
  reservationPriceMax: bigint;
  pegB64: bigint;
}

export interface SwapQuote {
  amountOut: bigint;
  amountIn: bigint;
  spreadBps: number;
  protoFee: bigint;
  lpFee: bigint;
  skewIn: number;
  skewOut: number;
  routeHops: Address[];
  hopAmounts: bigint[];
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

export type { HookSlot, LiquidityProfile, OracleConfig, RiskConfig } from './storage.js';
export {
  POOL_STORAGE,
  HOOK_PRE_OUTFLOW,
  HOOK_POST_INFLOW,
  HOOK_FLAGS_MASK,
  mappingBase,
  resolveTokenStorageKey,
  readLiquidityProfile,
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
  const assets: PoolAsset[] = [];

  for (const token of tokens) {
    const [asset, coverage] = await Promise.all([
      getAsset(provider, poolAddress, token.address),
      getCoverageRatio(provider, poolAddress, token.address),
    ]);

    assets.push({
      token: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: Number(asset.decimals),
      reserves: asset.reserves,
      liabilities: asset.liabilities,
      coverage,
    });
  }

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

export interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
}

export interface DepositParams {
  token: Address;
  amount: bigint;
}

export interface WithdrawParams {
  token: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
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
    args: [params.tokenIn, params.tokenOut, params.amountIn, params.minAmountOut, params.recipient],
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
    args: [params.token, params.lpAmount, params.minAmountOut],
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
