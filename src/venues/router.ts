// Lean exact-in router over the deployed BTR pools (eth_call quotes only).
// Winner-take-all: best single-hop, else simple USDC-hub 2-hop.
// Does NOT replace the off-chain AIMM router (../router): on-chain quotes only.

import { decodeErrorResult } from '../eth/abi.js';
import {
  type Address,
  ERC20_ABI,
  type Eip1193Provider,
  type Hex,
  RpcRevertError,
  ZERO_ADDRESS,
  encodeFn,
} from '../eth/index.js';
import { type MulticallResult, multicall } from '../eth/multicall.js';
import { POOL_ABI, type SwapQuote, defaultDeadline } from '../pool/index.js';
import { type VenueKind, eqAddr, hasToken, staticVenuePools } from './registry.js';

export interface VenueExecCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface VenueLegQuote {
  venue: VenueKind;
  pool: Address;
  tag: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  calldata?: Hex;
}

export interface BestVenueQuote {
  venue: VenueKind | 'hub';
  pool: Address;
  tag: string;
  amountOut: bigint;
  amountIn: bigint;
  tokenIn: Address;
  tokenOut: Address;
  /** Single-hop swap calldata, built with the caller's mandatory `recipient` and `minOut`. */
  calldata?: Hex;
  /** Present for USDC-hub 2-hop. */
  legs?: VenueLegQuote[];
}

/** Why a venue dropped out of the quote set. `halt` is the pool refusing on policy
 *  (depeg, stale feed, paused, outside reservation); `transport` is the RPC failing to
 *  answer. Collapsing the two silently delists a halted venue as if it were merely
 *  unreachable, which is how a deliberate protocol stop turns into a routing no-op. */
export interface VenueSkip {
  kind: 'halt' | 'transport';
  pool: Address;
  tag: string;
  /** Decoded custom-error name for `halt`, transport error message otherwise. */
  reason: string;
}

export interface QuoteBestOpts {
  /** Chain the quotes are for. REQUIRED and has no default: the venue set is per-chain, and a
   *  defaulted chain quotes one chain's pools for a caller running on another. */
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  provider: Eip1193Provider;
  /**
   * Recipient baked into the executable swap calldata. REQUIRED and must be non-zero:
   * `Pool.swap` does not reject `recipient == 0`, and `PoolIOLib.push` on the native
   * sentinel does `safeTransferETH(0)`, which SUCCEEDS. A defaulted zero recipient is a
   * swap that pays the burn address, so there is no safe default to fall back to.
   */
  recipient: Address;
  /**
   * Absolute minimum output baked into the calldata. REQUIRED: a defaulted 0 is calldata
   * with no slippage protection at all. Pass `0n` explicitly for discovery-only quotes
   * whose calldata is never broadcast, so the choice is visible at the call site.
   */
  minOut: bigint;
  /** Notified for every venue that failed to quote. Default: warn on `halt`, ignore transport. */
  onSkip?: (skip: VenueSkip) => void;
}

const defaultOnSkip = (s: VenueSkip): void => {
  if (s.kind === 'halt') console.warn(`[venues] ${s.tag} (${s.pool}) halted: ${s.reason}`);
};

/** Classify a failed pool read as a protocol halt (decodable custom error) or transport noise. */
function classifySkip(e: unknown, pool: Address, tag: string): VenueSkip {
  if (e instanceof RpcRevertError) {
    const data = typeof e.data === 'string' ? e.data : undefined;
    const decoded = data ? decodeErrorResult(POOL_ABI, data) : undefined;
    // A revert we cannot decode is still the pool refusing, not the transport failing.
    return { kind: 'halt', pool, tag, reason: decoded?.name ?? e.message };
  }
  return { kind: 'transport', pool, tag, reason: e instanceof Error ? e.message : String(e) };
}

// ── Per-venue single-hop quoter, batched: ONE aggregate3 for the whole candidate set ──

/** Rebuild the error a failed aggregate3 leg would have thrown on its own: revert data rides
 *  `returnData`, so a deliberate halt keeps its decodable name instead of reading as noise. */
function legFailure(r: MulticallResult | undefined): unknown {
  if (!r) return new Error('multicall returned fewer rows than calls');
  if (r.returnData && r.returnData !== '0x')
    return new RpcRevertError('execution reverted', 3, r.returnData);
  return r.error ?? new Error('multicall leg failed');
}

/** Quote every single-hop candidate for (tokenIn → tokenOut).
 *  ONE Multicall3 aggregate3 for all candidate pools - never one eth_call per venue. */
export async function quoteAllExactIn(opts: QuoteBestOpts): Promise<VenueLegQuote[]> {
  const { chainId, tokenIn, tokenOut, amountIn, provider, recipient, minOut } = opts;
  if (eqAddr(tokenIn, tokenOut) || amountIn <= 0n) return [];

  // Guard the value the type system cannot: `recipient` is required, but a caller
  // threading through an unset address still lands here. Swap output sent to address(0)
  // is unrecoverable, so refuse to BUILD the calldata rather than let it be signed.
  if (!recipient || eqAddr(recipient, ZERO_ADDRESS as Address)) {
    throw new Error('quoteAllExactIn: recipient must be a non-zero address');
  }
  if (minOut < 0n) throw new Error('quoteAllExactIn: minOut must be >= 0');

  const onSkip = opts.onSkip ?? defaultOnSkip;
  // The per-pool token filter quoteBtr used to apply before its read.
  const candidates = staticVenuePools(chainId).filter(
    (pool) => !pool.tokens || (hasToken(pool.tokens, tokenIn) && hasToken(pool.tokens, tokenOut)),
  );
  if (!candidates.length) return [];
  let res: MulticallResult[];
  try {
    res = await multicall(
      provider,
      candidates.map((pool) => ({
        address: pool.address,
        abi: POOL_ABI,
        functionName: 'getSwapQuote',
        args: [tokenIn, tokenOut, amountIn],
        allowFailure: true,
      })),
    );
  } catch (e) {
    // Batch-level failure (RPC down / rate-limited): every candidate skips as transport, same
    // as the per-pool read did when the provider was unreachable. Never a silent empty quote.
    for (const pool of candidates) onSkip(classifySkip(e, pool.address, pool.tag));
    return [];
  }
  return candidates.flatMap((pool, i): VenueLegQuote[] => {
    const r = res[i];
    if (!r?.success) {
      // Same classification the per-pool safeRead applied: a leg that reverted with data is the
      // pool refusing (halt - decoded custom error); anything else is transport noise.
      onSkip(classifySkip(legFailure(r), pool.address, pool.tag));
      return [];
    }
    const q = r.result as SwapQuote | undefined;
    if (!q || q.amountOut <= 0n) return [];
    return [
      {
        venue: 'btr',
        pool: pool.address,
        tag: pool.tag,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: q.amountOut,
        calldata: encodeFn({
          abi: POOL_ABI,
          functionName: 'swap',
          args: [tokenIn, tokenOut, amountIn, minOut, recipient, defaultDeadline()],
        }),
      },
    ];
  });
}

const MAX_UINT256 = (1n << 256n) - 1n;

function approveCall(token: Address, spender: Address, amount: bigint): VenueExecCall {
  return {
    to: token,
    data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [spender, amount] }),
  };
}

/**
 * Build sequential exec calls for a quote: approve pool, then pool.swap.
 * Hub 2-hop: flatten both legs (second leg amountIn = first amountOut).
 */
export function buildVenueExecCalls(
  quote: BestVenueQuote,
  opts: {
    approveMax?: boolean;
    needsApproval?: (token: Address, spender: Address) => boolean;
  } = {},
): VenueExecCall[] {
  const legs: VenueLegQuote[] =
    quote.legs && quote.legs.length
      ? quote.legs
      : [
          {
            venue: 'btr',
            pool: quote.pool,
            tag: quote.tag,
            tokenIn: quote.tokenIn,
            tokenOut: quote.tokenOut,
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            calldata: quote.calldata,
          },
        ];

  const out: VenueExecCall[] = [];
  const approveAmt = (n: bigint) => (opts.approveMax ? MAX_UINT256 : n);
  const need = opts.needsApproval ?? (() => true);

  for (const leg of legs) {
    if (!leg.calldata) continue;
    if (need(leg.tokenIn, leg.pool)) {
      out.push(approveCall(leg.tokenIn, leg.pool, approveAmt(leg.amountIn)));
    }
    out.push({ to: leg.pool, data: leg.calldata });
  }
  return out;
}
