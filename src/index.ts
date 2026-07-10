/**
 * BTR DEX SDK
 * Modular SDK for interacting with BTR DEX - pool data/swap helpers, router call builder, guardians
 *
 * @example Basic usage with EIP-1193 provider
 * ```ts
 * import { getSwapQuote, swap } from '@btr-protocol/sdk/pool';
 *
 * const provider = window.ethereum; // EIP-1193 provider
 *
 * const quote = await getSwapQuote(provider, poolAddress, tokenIn, tokenOut, amountIn);
 * await swap(provider, poolAddress, {
 *   tokenIn,
 *   tokenOut,
 *   amountIn,
 *   minAmountOut: quote.amountOut, // apply your own slippage tolerance
 *   recipient: yourAddress,
 * });
 * ```
 *
 * @example Circuit breaker guardian (backend)
 * ```ts
 * import { CircuitBreakerGuardian } from '@btr-protocol/sdk/guardians';
 * import { POOL_ABI } from '@btr-protocol/sdk/abis';
 *
 * const guardian = new CircuitBreakerGuardian(provider, {
 *   poolAddress: '0x...',
 *   assets: [...],
 *   maxDivergence: 100, // 1%
 * }, POOL_ABI);
 *
 * await guardian.start();
 * ```
 *
 * @module @btr-protocol/sdk
 */

// Re-export from utils (excluding types that conflict with pool module)
export {
  BPS_PRECISION,
  PRECISION_1E18,
  PRECISION_1E8,
  DEFAULT_GAS_LIMIT,
  SWAP_GAS_LIMIT,
  DEPOSIT_GAS_LIMIT,
  WITHDRAW_GAS_LIMIT,
  ONE_MINUTE,
  FIVE_MINUTES,
  ONE_HOUR,
  ONE_DAY,
  DEFAULT_ORACLE_STALENESS,
  DEFAULT_PRICE_DIVERGENCE_BPS,
  DEFAULT_CB_CHECK_INTERVAL,
  DEFAULT_CB_COOLDOWN,
  SUPPORTED_CHAINS,
  type TokenAddress,
  type PoolAddress,
  type OraclePrice,
  type CircuitBreakerConfig,
  type GuardianConfig,
} from './utils/constants.js';
export * from './utils/typing.js';
export * from './utils/safe.js';
export * from './utils/validation.js';
export * from './utils/business.js';
export * from './utils/maths.js';
export * from './utils/format.js';
export * from './utils/encoding.js';
export * from './utils/pair.js';

// Shared types (TimeFrame enum + helpers)
export * from './types/index.js';

// Guardians
export * from './guardians/index.js';

// Pool data and transactions (canonical source for POOL_ABI, SwapQuote, PoolAsset)
export * from './pool/index.js';
export * from './router/index.js';

// Off-chain AIMM pricer + route-finding (quoteExactIn, rankSwap, poolStateFrom)
export * from './amm/index.js';

// Eth utilities and clients
export * from './eth/index.js';
export type { Client } from './eth/client.js';
export {
  createWalletClient,
  createPublicClient,
  createHttpProvider,
  createPrivateKeyClient,
  privateKeyToAddress,
} from './eth/client.js';
