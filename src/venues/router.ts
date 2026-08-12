// Lean exact-in router over the deployed BTR pools (eth_call quotes only).
// Winner-take-all: best single-hop, else simple USDC-hub 2-hop.
// Does NOT replace the off-chain AIMM router (../router) — on-chain quotes only.

import {
  encodeFn,
  ERC20_ABI,
  RpcRevertError,
  ZERO_ADDRESS,
  type Address,
  type Eip1193Provider,
  type Hex,
} from '../eth/index.js';
import { decodeErrorResult } from '../eth/abi.js';
import { getSwapQuote, defaultDeadline, POOL_ABI } from '../pool/index.js';
import { eqAddr, hasToken, staticVenuePools, type VenueKind, type VenuePool } from './registry.js';

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
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  provider: Eip1193Provider;
  /**
   * Recipient baked into the executable swap calldata. REQUIRED and must be non-zero:
   * `Pool.sol:152` does not reject `recipient == 0`, and `PoolIO.push` on the native
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

async function safeRead<T>(
  fn: () => Promise<T>,
  pool: Address,
  tag: string,
  onSkip: (skip: VenueSkip) => void,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    onSkip(classifySkip(e, pool, tag));
    return null;
  }
}

// ── Per-venue single-hop quoters ──────────────────────────────────────────────

async function quoteBtr(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
  onSkip: (skip: VenueSkip) => void,
): Promise<VenueLegQuote | null> {
  if (pool.tokens && (!hasToken(pool.tokens, tokenIn) || !hasToken(pool.tokens, tokenOut))) return null;
  const q = await safeRead(
    () => getSwapQuote(provider, pool.address, tokenIn, tokenOut, amountIn),
    pool.address,
    pool.tag,
    onSkip,
  );
  if (!q || q.amountOut <= 0n) return null;
  return {
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
  };
}

/** Quote every single-hop candidate for (tokenIn → tokenOut). */
export async function quoteAllExactIn(opts: QuoteBestOpts): Promise<VenueLegQuote[]> {
  const { tokenIn, tokenOut, amountIn, provider, recipient, minOut } = opts;
  if (eqAddr(tokenIn, tokenOut) || amountIn <= 0n) return [];

  // Guard the value the type system cannot: `recipient` is required, but a caller
  // threading through an unset address still lands here. Swap output sent to address(0)
  // is unrecoverable, so refuse to BUILD the calldata rather than let it be signed.
  if (!recipient || eqAddr(recipient, ZERO_ADDRESS as Address)) {
    throw new Error('quoteAllExactIn: recipient must be a non-zero address');
  }
  if (minOut < 0n) throw new Error('quoteAllExactIn: minOut must be >= 0');

  const onSkip = opts.onSkip ?? defaultOnSkip;
  const settled = await Promise.all(
    staticVenuePools().map((pool) =>
      quoteBtr(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut, onSkip),
    ),
  );
  return settled.filter((q): q is VenueLegQuote => q != null && q.amountOut > 0n);
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
  opts: { approveMax?: boolean; needsApproval?: (token: Address, spender: Address) => boolean } = {},
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
