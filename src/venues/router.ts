// Lean multi-venue exact-in router for Chapel.
// Winner-take-all: best single-hop across BTR + incumbents, else simple USDC-hub 2-hop.
// Does NOT replace the off-chain AIMM router (router.ts) — on-chain eth_call quotes only.

import {
  encodeFn,
  readContract,
  isZeroAddress,
  ZERO_ADDRESS,
  ERC20_ABI,
  type Address,
  type Eip1193Provider,
  type Hex,
} from '../eth/index.js';
import { getSwapQuote } from '../pool/index.js';
import { CHAPEL_UNIV2, CHAPEL_TOKENS } from './chapel.js';
import {
  CURVE_ABI,
  FLUID_ABI,
  UNIV2_PAIR_ABI,
  UNIV2_FACTORY_ABI,
  WOMBAT_ABI,
  eqAddr,
  hasToken,
  uniV2PairCandidates,
  uniV2GetAmountOut,
  staticVenuePools,
  type VenueKind,
  type VenuePool,
} from './registry.js';

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

const USDC = CHAPEL_TOKENS.usdc;

async function safeRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function pickBest(quotes: VenueLegQuote[]): VenueLegQuote | null {
  let best: VenueLegQuote | null = null;
  for (const q of quotes) {
    if (q.amountOut <= 0n) continue;
    if (!best || q.amountOut > best.amountOut) best = q;
  }
  return best;
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
        ],
        outputs: [],
      }],
      functionName: 'swap',
      args: [tokenIn, tokenOut, amountIn, minOut, recipient],
    }),
  };
}

async function quoteCurve(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  minOut: bigint,
): Promise<VenueLegQuote | null> {
  if (!pool.tokens || !pool.coinIndices) return null;
  const i = pool.tokens.findIndex((t) => eqAddr(t, tokenIn));
  const j = pool.tokens.findIndex((t) => eqAddr(t, tokenOut));
  if (i < 0 || j < 0 || i === j) return null;
  const out = await safeRead(() =>
    readContract<bigint>(provider, pool.address, CURVE_ABI, 'get_dy', [BigInt(i), BigInt(j), amountIn]),
  );
  if (out == null || out <= 0n) return null;
  return {
    venue: 'curve',
    pool: pool.address,
    tag: pool.tag,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: out,
    calldata: encodeFn({
      abi: CURVE_ABI,
      functionName: 'exchange',
      args: [BigInt(i), BigInt(j), amountIn, minOut],
    }),
  };
}

async function quoteWombat(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
): Promise<VenueLegQuote | null> {
  if (pool.tokens && (!hasToken(pool.tokens, tokenIn) || !hasToken(pool.tokens, tokenOut))) return null;
  const out = await safeRead(() =>
    readContract<bigint>(provider, pool.address, WOMBAT_ABI, 'quote', [tokenIn, tokenOut, amountIn]),
  );
  if (out == null || out <= 0n) return null;
  return {
    venue: 'wombat',
    pool: pool.address,
    tag: pool.tag,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: out,
    calldata: encodeFn({
      abi: WOMBAT_ABI,
      functionName: 'swap',
      args: [tokenIn, tokenOut, amountIn, minOut, recipient],
    }),
  };
}

async function quoteZeroForOnePool(
  provider: Eip1193Provider,
  venue: 'fluid' | 'rangeCl',
  pool: Address,
  tag: string,
  token0: Address,
  token1: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
  abi: typeof FLUID_ABI,
): Promise<VenueLegQuote | null> {
  const zfo = eqAddr(tokenIn, token0) && eqAddr(tokenOut, token1);
  const ofz = eqAddr(tokenIn, token1) && eqAddr(tokenOut, token0);
  if (!zfo && !ofz) return null;
  const zeroForOne = zfo;
  const out = await safeRead(() =>
    readContract<bigint>(provider, pool, abi, 'quote', [zeroForOne, amountIn]),
  );
  if (out == null || out <= 0n) return null;
  return {
    venue,
    pool,
    tag,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: out,
    calldata: encodeFn({
      abi,
      functionName: 'swap',
      args: [zeroForOne, amountIn, minOut, recipient],
    }),
  };
}

async function quoteFluid(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
): Promise<VenueLegQuote | null> {
  const [t0, t1] = await Promise.all([
    safeRead(() => readContract<Address>(provider, pool.address, FLUID_ABI, 'token0', [])),
    safeRead(() => readContract<Address>(provider, pool.address, FLUID_ABI, 'token1', [])),
  ]);
  if (!t0 || !t1) return null;
  return quoteZeroForOnePool(
    provider, 'fluid', pool.address, pool.tag, t0, t1,
    tokenIn, tokenOut, amountIn, recipient, minOut, FLUID_ABI,
  );
}

/** RangeCL mirrors Fluid's quote(bool,uint256) / swap surface. */
async function quoteRangeCl(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
): Promise<VenueLegQuote | null> {
  if (pool.tokens && (!hasToken(pool.tokens, tokenIn) || !hasToken(pool.tokens, tokenOut))) return null;
  const [t0, t1] = await Promise.all([
    safeRead(() => readContract<Address>(provider, pool.address, FLUID_ABI, 'token0', [])),
    safeRead(() => readContract<Address>(provider, pool.address, FLUID_ABI, 'token1', [])),
  ]);
  if (!t0 || !t1) return null;
  return quoteZeroForOnePool(
    provider, 'rangeCl', pool.address, pool.tag, t0, t1,
    tokenIn, tokenOut, amountIn, recipient, minOut, FLUID_ABI,
  );
}

async function discoverUniV2Pools(
  provider: Eip1193Provider,
  tokenIn: Address,
  tokenOut: Address,
): Promise<VenuePool[]> {
  if (isZeroAddress(CHAPEL_UNIV2.factory)) return [];
  const relevant = uniV2PairCandidates().filter(
    (p) =>
      (eqAddr(p.a, tokenIn) && eqAddr(p.b, tokenOut)) ||
      (eqAddr(p.b, tokenIn) && eqAddr(p.a, tokenOut)),
  );
  if (relevant.length === 0) return [];

  const found: VenuePool[] = [];
  await Promise.all(
    relevant.map(async ({ a, b }) => {
      const pool = await safeRead(() =>
        readContract<Address>(provider, CHAPEL_UNIV2.factory, UNIV2_FACTORY_ABI, 'getPair', [a, b]),
      );
      if (!pool || isZeroAddress(pool)) return;
      found.push({
        venue: 'uniV2',
        tag: 'uniV2-30bps',
        address: pool,
        tokens: [a, b],
        fee: 3000,
      });
    }),
  );
  return found;
}

async function quoteUniV2(
  provider: Eip1193Provider,
  pool: VenuePool,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  recipient: Address,
  minOut: bigint,
): Promise<VenueLegQuote | null> {
  const [t0, t1, reservesRaw] = await Promise.all([
    safeRead(() => readContract<Address>(provider, pool.address, UNIV2_PAIR_ABI, 'token0', [])),
    safeRead(() => readContract<Address>(provider, pool.address, UNIV2_PAIR_ABI, 'token1', [])),
    safeRead(() =>
      readContract<
        { reserve0: bigint; reserve1: bigint } | [bigint, bigint, number]
      >(provider, pool.address, UNIV2_PAIR_ABI, 'getReserves', []),
    ),
  ]);
  if (!t0 || !t1 || !reservesRaw) return null;
  const reserves: [bigint, bigint] = Array.isArray(reservesRaw)
    ? [reservesRaw[0], reservesRaw[1]]
    : [reservesRaw.reserve0, reservesRaw.reserve1];
  const zeroForOne = eqAddr(tokenIn, t0) && eqAddr(tokenOut, t1);
  const oneForZero = eqAddr(tokenIn, t1) && eqAddr(tokenOut, t0);
  if (!zeroForOne && !oneForZero) return null;
  const [r0, r1] = reserves;
  const amountOut = zeroForOne
    ? uniV2GetAmountOut(amountIn, r0, r1)
    : uniV2GetAmountOut(amountIn, r1, r0);
  if (amountOut <= 0n || amountOut < minOut) return null;
  return {
    venue: 'uniV2',
    pool: pool.address,
    tag: pool.tag,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    // Caller must transfer tokenIn to pair before this calldata.
    calldata: encodeFn({
      abi: UNIV2_PAIR_ABI,
      functionName: 'swap',
      args: [
        zeroForOne ? 0n : amountOut,
        zeroForOne ? amountOut : 0n,
        recipient,
        '0x',
      ],
    }),
  };
}

/** Quote every single-hop candidate for (tokenIn → tokenOut). */
export async function quoteAllExactIn(
  opts: QuoteBestOpts,
): Promise<VenueLegQuote[]> {
  const { tokenIn, tokenOut, amountIn, provider } = opts;
  if (eqAddr(tokenIn, tokenOut) || amountIn <= 0n) return [];

  const recipient = opts.recipient ?? (ZERO_ADDRESS as Address);
  const minOut = opts.minOut ?? 0n;
  const staticPools = staticVenuePools();
  const uniV2 = await discoverUniV2Pools(provider, tokenIn, tokenOut);
  const pools = [...staticPools, ...uniV2];

  const jobs = pools.map(async (pool): Promise<VenueLegQuote | null> => {
    switch (pool.venue) {
      case 'btr':
        return quoteBtr(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut);
      case 'curve':
        return quoteCurve(provider, pool, tokenIn, tokenOut, amountIn, minOut);
      case 'wombat':
        return quoteWombat(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut);
      case 'fluid':
        return quoteFluid(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut);
      case 'rangeCl':
        return quoteRangeCl(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut);
      case 'uniV2':
        return quoteUniV2(provider, pool, tokenIn, tokenOut, amountIn, recipient, minOut);
      default:
        return null;
    }
  });

  const settled = await Promise.all(jobs);
  return settled.filter((q): q is VenueLegQuote => q != null && q.amountOut > 0n);
}

/**
 * Best exact-in route across Chapel venues.
 * 1) Winner-take-all single hop.
 * 2) Else simple USDC-hub: best(In→USDC) then best(USDC→Out).
 */
export async function quoteBestExactIn(opts: QuoteBestOpts): Promise<BestVenueQuote | null> {
  const { tokenIn, tokenOut, amountIn } = opts;
  if (eqAddr(tokenIn, tokenOut) || amountIn <= 0n) return null;

  const singles = await quoteAllExactIn(opts);
  const best = pickBest(singles);
  if (best) {
    return {
      venue: best.venue,
      pool: best.pool,
      tag: best.tag,
      amountIn,
      amountOut: best.amountOut,
      tokenIn,
      tokenOut,
      calldata: best.calldata,
    };
  }

  // USDC hub — skip if either side is already USDC (no mid hop helps).
  if (eqAddr(tokenIn, USDC) || eqAddr(tokenOut, USDC)) return null;

  const leg1s = await quoteAllExactIn({ ...opts, tokenOut: USDC });
  const leg1 = pickBest(leg1s);
  if (!leg1 || leg1.amountOut <= 0n) return null;

  const leg2s = await quoteAllExactIn({
    ...opts,
    tokenIn: USDC,
    amountIn: leg1.amountOut,
  });
  const leg2 = pickBest(leg2s);
  if (!leg2 || leg2.amountOut <= 0n) return null;

  return {
    venue: 'hub',
    pool: leg1.pool,
    tag: `${leg1.tag}>${leg2.tag}`,
    amountIn,
    amountOut: leg2.amountOut,
    tokenIn,
    tokenOut,
    legs: [leg1, leg2],
  };
}

const MAX_UINT256 = (1n << 256n) - 1n;

function approveCall(token: Address, spender: Address, amount: bigint): VenueExecCall {
  return {
    to: token,
    data: encodeFn({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    }),
  };
}

function transferCall(token: Address, to: Address, amount: bigint): VenueExecCall {
  return {
    to: token,
    data: encodeFn({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to, amount],
    }),
  };
}

/**
 * Build sequential exec calls for a multi-venue quote (approve/transfer + swap).
 * UniV2: transfer tokenIn → pair, then pair.swap.
 * Others: approve pool, then pool.swap / exchange.
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
            venue: quote.venue === 'hub' ? 'btr' : quote.venue,
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
    if (leg.venue === 'uniV2') {
      // Uniswap V2: push tokens then swap (no approve).
      out.push(transferCall(leg.tokenIn, leg.pool, leg.amountIn));
      out.push({ to: leg.pool, data: leg.calldata });
      continue;
    }
    if (need(leg.tokenIn, leg.pool)) {
      out.push(approveCall(leg.tokenIn, leg.pool, approveAmt(leg.amountIn)));
    }
    out.push({ to: leg.pool, data: leg.calldata });
  }
  return out;
}

