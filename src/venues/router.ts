// Lean exact-in router over the deployed BTR pools (eth_call quotes only).
// Winner-take-all: best single-hop, else simple USDC-hub 2-hop.
// Does NOT replace the off-chain AIMM router (../router) — on-chain quotes only.

import {
  encodeFn,
  ERC20_ABI,
  ZERO_ADDRESS,
  type Address,
  type Eip1193Provider,
  type Hex,
} from '../eth/index.js';
import { getSwapQuote, defaultDeadline } from '../pool/index.js';
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
  /** Single-hop swap calldata (minOut=0 unless opts.minOut set). */
  calldata?: Hex;
  /** Present for USDC-hub 2-hop. */
  legs?: VenueLegQuote[];
}

export interface QuoteBestOpts {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  provider: Eip1193Provider;
  /** Recipient baked into swap calldata (default ZERO). */
  recipient?: Address;
  /** Absolute minOut for calldata (default 0). */
  minOut?: bigint;
}

async function safeRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
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
): Promise<VenueLegQuote | null> {
  if (pool.tokens && (!hasToken(pool.tokens, tokenIn) || !hasToken(pool.tokens, tokenOut))) return null;
  const q = await safeRead(() => getSwapQuote(provider, pool.address, tokenIn, tokenOut, amountIn));
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
      abi: [{
        type: 'function', name: 'swap', stateMutability: 'nonpayable',
        inputs: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'minAmountOut', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [],
      }],
      functionName: 'swap',
      args: [tokenIn, tokenOut, amountIn, minOut, recipient, defaultDeadline()],
    }),
  };
}

/** Quote every single-hop candidate for (tokenIn → tokenOut). */
export async function quoteAllExactIn(opts: QuoteBestOpts): Promise<VenueLegQuote[]> {
  const { tokenIn, tokenOut, amountIn, provider } = opts;
  if (eqAddr(tokenIn, tokenOut) || amountIn <= 0n) return [];

  const recipient = opts.recipient ?? (ZERO_ADDRESS as Address);
  const minOut = opts.minOut ?? 0n;

  const settled = await Promise.all(
    staticVenuePools().map((pool) => quoteBtr(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut)),
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
