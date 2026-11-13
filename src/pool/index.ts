/**
 * Pool Module - On-chain data fetching and transaction execution
 * Works in both frontend (with injected wallet) and backend (with private key)
 */

import { POOL_ABI } from '../abis/Pool.js';
import type {
  Assert,
  AssetFields,
  FieldsMatch,
  SwapQuoteFields,
} from '../abis/structs.generated.js';
import type { PoolState } from '../amm/aimm.js';
import { decodeErrorResult, decodeFn, encodeFn } from '../eth/abi';
import { ContractRevertError } from '../eth/contract';
import { estimateCallGas } from '../eth/gas';
import { multicallStrict } from '../eth/multicall';
import { getAccounts, getChainId, rpcErrorData } from '../eth/rpc';
import { type Address, type Eip1193Provider, type Hex, NATIVE_TOKEN } from '../eth/types';
import { MAX_CLOCK_SKEW_S } from '../utils/constants';
import { toUnits } from '../utils/format.js';
import { toAsset } from './asset.js';

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
  /** Shared curve id (`readCurve`; the v5 blob sits at `curvePointer`). Never 0 on a listed leg:
   *  `PoolConfigLib.validateCurveAssign` refuses the assignment, so there is no curve-less quote. */
  curveId: number;
  minFeePbps: number;
  /** Scale: see `AimmProfile.vega`. */
  vegaBps: number;
  /** GEN-4 deposit cap: `m<<4|e` whole base tokens. 0 = legacy uncapped. */
  depositCapCode: number;
  decimals: number;
  deadSeedPow10: number;
  /** Halt/enable bits; 12..15 = the depeg code (`DEPEG_STEP_BPS` each). */
  flags: number;
  /** Per-leg ceiling on this leg's share of the pool claim book (bps of B). 0 = disabled (default). */
  maxLiabWeightBps: number;
  /** Oracle wiring: store lane 0..5 | INTERNAL 6 | UOA 7 (`decodeLegOracle`). */
  oracleBits: number;
  /** Coverage-law terms, raw (`decodeCovBits`); `getRiskConfig` reports them in bps. */
  covBits: number;
  /** The negative barrier's knee, raw (`decodeKneeBits`); read only behind `KNEE_BIT` in `flags`. */
  kneeBits: number;
}

/** Fails the typecheck if `Asset` and the ABI's struct stop agreeing on field names. */
export type _AssetMatchesAbi = Assert<FieldsMatch<Asset, AssetFields>>;

export { toAsset } from './asset.js';

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

  return toAsset(decodeFn({ abi: POOL_ABI, functionName: 'getAsset', data: result }));
}

/** Pool rate and exit toll from one sweep. `exitTollWad` is raw WAD (a real zero included) and is the
 *  settlement toll only while `ok`; degraded (`ok = false`) the sweep's word reads 0 while the exit
 *  charges the lower-pass toll, so it is returned as null (unknown), never as a 0 toll.
 *  `observedAtMs` stamps the read for {@link withPoolSolvency}'s freshness check. */
export async function getPoolSolvency(
  provider: Eip1193Provider,
  poolAddress: Address,
): Promise<{ cWad: bigint; ok: boolean; exitTollWad: bigint | null; observedAtMs: number }> {
  const data = encodeFn({ abi: POOL_ABI, functionName: 'poolSolvencyWad' });
  // Stamped BEFORE the call: the words are at least this old, so the round trip counts as age.
  const observedAtMs = Date.now();
  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data }, 'latest'],
  })) as Hex;
  const [cWad, ok, exitTollWad] = decodeFn<[bigint, boolean, bigint]>({
    abi: POOL_ABI,
    functionName: 'poolSolvencyWad',
    data: result,
  });
  return { cWad, ok, exitTollWad: ok ? exitTollWad : null, observedAtMs };
}

/** `PoolState` carrying both `poolSolvencyWad` words the LP exit quotes need: `solvencyOk` (the
 *  `ok` word) and `exitTollWad` (the toll word, the settlement toll only while `ok`), stamped with
 *  the read time (`solvencyAtMs`; `sol.observedAtMs`, else now). */
export function withPoolSolvency<S extends PoolState>(
  state: S,
  sol: { ok: boolean; exitTollWad: bigint | null; observedAtMs?: number },
): S {
  return {
    ...state,
    solvencyOk: sol.ok,
    exitTollWad: sol.ok ? sol.exitTollWad : null,
    solvencyAtMs: sol.observedAtMs ?? Date.now(),
  };
}

/** `Pool.previewWithdraw(tk, lp)`: the same-asset payout for `lp` RAW LP shares, in raw `tk` units,
 *  net of the settlement C toll (`exitCap`'s sweep). Raw in, raw out: wire it into
 *  `LpRouteOpts.previewWithdraw` (display shares) through {@link previewWithdrawFor}. */
export async function getPreviewWithdraw(
  provider: Eip1193Provider,
  poolAddress: Address,
  tokenAddress: Address,
  lp: bigint,
): Promise<{ amountOut: bigint; haircut: bigint }> {
  const data = encodeFn({
    abi: POOL_ABI,
    functionName: 'previewWithdraw',
    args: [tokenAddress, lp],
  });
  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to: poolAddress, data }, 'latest'],
  })) as Hex;
  const [amountOut, haircut] = decodeFn<[bigint, bigint]>({
    abi: POOL_ABI,
    functionName: 'previewWithdraw',
    data: result,
  });
  return { amountOut, haircut };
}

/** The `LpRouteOpts.previewWithdraw` callback over {@link getPreviewWithdraw}: display LP shares to
 *  raw at the underlying's decimals (`LPToken.decimals` mirrors it), floored as the burn encodes
 *  them, then the raw preview. `resolve` names the token address and decimals of a pool's symbol;
 *  null (unknown leg, no pool address) or a failed call leaves the preview unread (null). */
export function previewWithdrawFor(
  provider: Eip1193Provider,
  resolve: (symbol: string, pool: { addr?: string }) => { token: Address; decimals: number } | null,
): (pool: { addr?: string }, symbol: string, lpShares: number) => Promise<bigint | null> {
  return async (pool, symbol, lpShares) => {
    const r = resolve(symbol, pool);
    if (!r || !pool.addr) return null;
    const lp = toUnits(lpShares, r.decimals);
    if (lp <= 0n) return null;
    try {
      return (await getPreviewWithdraw(provider, pool.addr as Address, r.token, lp)).amountOut;
    } catch {
      return null;
    }
  };
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

export type { LiabLeg, SwapLiabilityQuote } from './liability.js';
export {
  WAD as WAD_F,
  exitCap,
  exitValue,
  legCoverage,
  liabilitySwapEnabled,
  minLpAmountOut,
  poolSolvency,
} from './liability.js';
export {
  quoteSwapLiabilityAsync,
  quoteSwapLiabilityCore,
  quoteSwapLiabilityCoreAsync,
} from './liabilityQuote.js';
export type { Custody, HookSlot, OracleConfig, RiskConfig } from './storage.js';
export type { CovTerms, KneeTerms } from './cov.js';
export { decodeCovBits, decodeKneeBits, kappaBps } from './cov.js';
export {
  MARK_WORD_V4,
  MARK_WORD_WIRE2,
  POOL_STRUCTS,
  decodeCustody,
  decodeMarkWord,
  decodeLegOracle,
  decodeStoreWord,
  decodeP8Classes,
  laneFloat,
  MARK_STORE_V5,
  MARK_STORE_V10,
  markStoreOf,
  markStoreAbiOf,
  wireOf,
  p8ClassOf,
  p8StoreWord,
  p8TierSlot,
  POOL_STORAGE_V5,
  readMarks,
  HOOK_PRE_OUTFLOW,
  HOOK_FLAGS_MASK,
  mappingBase,
  curvePointer,
  readCurve,
  readOracleConfig,
  readLegCov,
  assetStructOf,
  DEPEG_STEP_BPS,
  KNEE_BIT,
  getStorageAt,
  POOL_AREA_V10,
  POOL_STORAGE_V10,
  assetSlot,
  curveSlot,
  layoutOf,
  readClassHead,
  readCustody,
  recordSlot,
  SWAP_GATE_SLOTS,
  readSwapGateMember,
  swapGateAdmits,
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

  const q = decodeFn<SwapQuote>({ abi: POOL_ABI, functionName: 'getSwapQuote', data: result });
  // The decoder returns bigint for every int/uint; the uint16/int8 fields are typed number.
  return {
    ...q,
    spreadPbps: Number(q.spreadPbps),
    skewIn: Number(q.skewIn),
    skewOut: Number(q.skewOut),
  };
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
  // eth_call and throws, same contract as the per-token loop this replaced.
  const res = await multicallStrict<Asset | bigint>(
    provider,
    tokens.flatMap((t) => [
      { address: poolAddress, abi: POOL_ABI, functionName: 'getAsset', args: [t.address] },
      { address: poolAddress, abi: POOL_ABI, functionName: 'getCoverageRatio', args: [t.address] },
    ]),
  );

  const assets: PoolAsset[] = tokens.map((token, i) => {
    const asset = toAsset(res[i * 2]);
    return {
      token: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: asset.decimals,
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

export { NATIVE_TOKEN };
const isNative = (token: Address) => token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
const txValue = (token: Address, amount: bigint): Hex =>
  isNative(token) ? `0x${amount.toString(16)}` : '0x0';
/** Default tx validity window (seconds) when no deadline is supplied. */
const DEFAULT_DEADLINE_S = 600;
/** Widest validity window a send may carry, explicit deadlines included: past it a signed swap is
 *  an option a searcher can hold. */
export const MAX_DEADLINE_S = 1_800;
/** Largest |chain time − device clock| {@link syncChainClock} accepts. A wider gap is a wrong
 *  device clock or a lying RPC; either way the deadline it would anchor is not known. */
export { MAX_CLOCK_SKEW_S };
/** Chain time minus this device's clock, seconds, from the last {@link syncChainClock}. */
let chainSkewS = 0;

const chainNowS = (): number => Math.floor(Date.now() / 1000) + chainSkewS;

/**
 * Anchor every deadline to CHAIN time: reads the latest block's timestamp through `provider`
 * (pass the wallet's, or an independent quorum: never the quote server's relay) and keeps its
 * offset from this device's clock. Refuses (throws) when the read fails, answers no timestamp,
 * or differs from the device clock by more than `maxSkewS`: an RPC that lies about time would
 * otherwise set the deadline, and a device hours off would hand out an hours-wide window. A
 * refused sync leaves the previous offset. Unsynced (a server on NTP) the device clock stands.
 */
export async function syncChainClock(
  provider: Eip1193Provider,
  maxSkewS: number = MAX_CLOCK_SKEW_S,
): Promise<void> {
  const block = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
  })) as { timestamp?: unknown } | null;
  const ts = typeof block?.timestamp === 'string' ? Number(BigInt(block.timestamp)) : Number.NaN;
  if (!(Number.isSafeInteger(ts) && ts > 0)) throw new Error('chain clock: no block timestamp');
  const skew = ts - Math.floor(Date.now() / 1000);
  if (!(Math.abs(skew) <= maxSkewS)) {
    throw new Error(
      `chain clock: chain time is ${skew}s off this device (bound ${maxSkewS}s); fix the device clock or the RPC`,
    );
  }
  chainSkewS = skew;
}

/** Unix-seconds deadline `DEFAULT_DEADLINE_S` from now, on chain time once synced. */
export const defaultDeadline = (): bigint => BigInt(chainNowS() + DEFAULT_DEADLINE_S);

/** The deadline a send encodes: `deadline` or {@link defaultDeadline}. Throws when it is negative
 *  or more than {@link MAX_DEADLINE_S} past chain time. */
export function sendDeadline(deadline?: bigint): bigint {
  const d = deadline ?? defaultDeadline();
  if (d < 0n) throw new Error('deadline must be >= 0');
  if (d > BigInt(chainNowS() + MAX_DEADLINE_S)) {
    throw new Error(`deadline more than ${MAX_DEADLINE_S}s past chain time`);
  }
  return d;
}

interface SwapParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  recipient: Address;
  /** Unix-seconds expiry; defaults to now + DEFAULT_DEADLINE_S. Capped at MAX_DEADLINE_S past chain time. */
  deadline?: bigint;
  /** Refuse to send unless the endpoint reports THIS chain. Optional: absent, no check. */
  expectedChainId?: number;
}

interface DepositParams {
  token: Address;
  amount: bigint;
  /** `Pool.depositMin` share floor. Required and positive: a plain `deposit` mints at any price. */
  minLpOut: bigint;
  /** Refuse to send unless the endpoint reports THIS chain. Optional: absent, no check. */
  expectedChainId?: number;
}

interface WithdrawParams {
  token: Address;
  lpAmount: bigint;
  minAmountOut: bigint;
  /** Unix-seconds expiry; defaults to now + DEFAULT_DEADLINE_S. Capped at MAX_DEADLINE_S past chain time. */
  deadline?: bigint;
  /** Refuse to send unless the endpoint reports THIS chain. Optional: absent, no check. */
  expectedChainId?: number;
}

/** Pre-send chain guard: a wallet that switched networks after the quote would otherwise send
 *  the same calldata on the wrong chain. The front checks this too; the SDK refuses here so a
 *  direct caller is bound as well. Same wording as `signTransaction`'s `expectedChainId`. */
async function checkExpectedChain(
  provider: Eip1193Provider,
  expectedChainId: number | undefined,
): Promise<void> {
  if (expectedChainId === undefined) return;
  const chainId = await getChainId(provider);
  if (chainId !== expectedChainId) {
    throw new Error(`chain mismatch: endpoint reports ${chainId}, expected ${expectedChainId}`);
  }
}

/** Send a pool call with its gas LIMIT = estimate × buffer (`gasWithBuffer`). The wallet would
 *  otherwise estimate on its own, with no margin: a pool call read one block later can need more
 *  gas than the estimate, and the revert still bills the limit. The estimate runs from the
 *  connected account, the sender the wallet will use. Fails closed: an estimate that errors (revert,
 *  timeout, node down, estimate above the cap) throws and nothing is sent. The front does not call
 *  this writer (it sends through its own wallet path, which sends unbuffered on a non-revert
 *  estimate failure), so the fail-closed rule binds direct sdk callers only. */
async function sendPoolCall(
  provider: Eip1193Provider,
  to: Address,
  data: Hex,
  value: Hex,
): Promise<Hex> {
  const [from] = await getAccounts(provider);
  if (!from) throw new Error('No account connected');
  const tx = { from, to, data, value };
  let gas: bigint;
  try {
    gas = await estimateCallGas(provider, tx);
  } catch (e) {
    throw decodePoolRevert(e);
  }
  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [{ ...tx, gas: `0x${gas.toString(16)}` }],
  })) as Hex;
}

/** An estimate that reverted names the pool's own custom error (`ThresholdViolation(...)`), the
 *  way `Contract` does, instead of an opaque "execution reverted". Anything else passes through. */
function decodePoolRevert(e: unknown): unknown {
  const data = rpcErrorData(e);
  if (!data) return e;
  let d: ReturnType<typeof decodeErrorResult>;
  try {
    d = decodeErrorResult(POOL_ABI, data);
  } catch {
    return e; // clipped revert data: the revert is still the answer, keep the transport's error
  }
  if (!d) return e;
  const args = d.args.length ? `(${d.args.map(String).join(', ')})` : '';
  return new ContractRevertError(
    d.name,
    d.args,
    `pool reverted: ${d.name}${args}`,
    undefined,
    data,
  );
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
  await checkExpectedChain(provider, params.expectedChainId);
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'swap_qe',
    args: [
      params.tokenIn,
      params.tokenOut,
      params.amountIn,
      params.minAmountOut,
      params.recipient,
      sendDeadline(params.deadline),
    ],
  });

  return sendPoolCall(provider, poolAddress, calldata, txValue(params.tokenIn, params.amountIn));
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
  await checkExpectedChain(provider, params.expectedChainId);
  if (typeof params.minLpOut !== 'bigint' || params.minLpOut <= 0n)
    throw new Error('deposit: minLpOut must be a positive share floor');
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'depositMin',
    args: [params.token, params.amount, params.minLpOut],
  });

  return sendPoolCall(provider, poolAddress, calldata, txValue(params.token, params.amount));
}

export { minLpOut } from './slippage';

/**
 * `functionName(args)` on the pool as `from` would run it right now: an `eth_call` of the real
 * entrypoint, decoded. The chain's own answer for a send, every toll, rate and dead-share seed
 * included, so a floor checked against it cannot drift from a replica. Pass the WALLET's provider:
 * the point is an answer the quote service did not author.
 */
export async function simulatePoolCall<T>(
  provider: Eip1193Provider,
  poolAddress: Address,
  from: Address,
  functionName: string,
  args: readonly unknown[],
  value: Hex = '0x0',
): Promise<T> {
  const data = encodeFn({ abi: POOL_ABI, functionName, args });
  const result = (await provider.request({
    method: 'eth_call',
    params: [{ from, to: poolAddress, data, value }, 'latest'],
  })) as Hex;
  return decodeFn<T>({ abi: POOL_ABI, functionName, data: result });
}

/**
 * The shares `deposit(token, amount)` would mint for `from` right now ({@link simulatePoolCall}).
 * Needs `from`'s balance and allowance to the pool (the pull runs first): call it after the
 * approval has mined. Feed `minLpOut(shares, slippageBps)` to `depositMin`.
 */
export async function simulateDeposit(
  provider: Eip1193Provider,
  poolAddress: Address,
  from: Address,
  token: Address,
  amount: bigint,
): Promise<bigint> {
  const r = await simulatePoolCall<{ lpAmount: bigint }>(
    provider,
    poolAddress,
    from,
    'deposit',
    [token, amount],
    txValue(token, amount),
  );
  return r.lpAmount;
}

/**
 * Execute a withdraw transaction
 */
export async function withdraw(
  provider: Eip1193Provider,
  poolAddress: Address,
  params: WithdrawParams,
): Promise<Hex> {
  await checkExpectedChain(provider, params.expectedChainId);
  const calldata = encodeFn({
    abi: POOL_ABI,
    functionName: 'withdraw',
    args: [params.token, params.lpAmount, params.minAmountOut, sendDeadline(params.deadline)],
  });

  return sendPoolCall(provider, poolAddress, calldata, '0x0');
}

/** Same guard for the quote tuple; `routeHops`/`hopAmounts`/`hopPrices` are ABI fields too. */
export type _SwapQuoteMatchesAbi = Assert<FieldsMatch<SwapQuote, SwapQuoteFields>>;
