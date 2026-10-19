/**
 * Chain-mode (`/v1/chain/*`) client: one base URL, typed errors, one cooldown, a monotonic block guard and
 * a floor check at the trust boundary.
 *
 * The server authors the floor (`tol_pbps` + `min_out`) from the same `getSwapQuote` that produced
 * `amount_out`. The client does not re-derive it; it checks the wire's ONE invariant,
 * `min_out = amount_out·(1e6 − tol_pbps)/1e6` for BOTH spread and relative modes
 * (`assertServerFloor`), and bounds `tol_pbps` by the widest the REQUEST's own policy can produce.
 * The formula alone is self-consistency — the server writes both of its sides — so without the
 * bound a floor 99.9% under the quote passes it.
 */

import { btrFetchRaw, withChainId } from '../api.js';
import { assertServerFloor } from '../router/index.js';
import { ChainError, parseChainError } from './errors.js';

export type Slippage = { mode: 'spread'; pct: number } | { mode: 'relative'; pbps: number };

interface BlockRef {
  number: number;
  timestamp: number;
}

export interface Refused {
  name: string;
  selector: string;
  args: string[];
}

export interface QuotedAmount {
  amount_out: string;
  spread_pbps: number;
  proto_fee: string;
  lp_fee: string;
  cov_toll: string;
  mark_price: string;
  mid_price: string;
  route_hops: string[];
  hop_amounts: string[];
  tol_pbps: number;
  min_out: string;
}

/**
 * Why a quote amount has no price. `inflow_capped`: `ThresholdViolation(reservesAfter, cap)`, the
 * pool's always-on inflow cap (`R + amountIn <= k·L`, k 1.5 PEGGED / 2.0 otherwise). A quote
 * carries no `minOut`, so the selector's slippage meaning cannot occur here; the A-188 overshoot
 * and route-maxDev reverts share it and are rare next to the cap. The input leg cannot be told
 * from the output leg by args, so `cap` is the bound the revert reported, not necessarily the input's.
 */
export type RefusalReason = 'inflow_capped' | 'other';

export function refusalReason(r: Refused): RefusalReason {
  return r.name === 'ThresholdViolation' ? 'inflow_capped' : 'other';
}

/** The `cap` word of a `ThresholdViolation(reached, cap)` refusal; null for any other revert. */
export function refusedCap(r: Refused): bigint | null {
  return r.name === 'ThresholdViolation' && r.args.length >= 2 ? BigInt(r.args[1]!) : null;
}

type QuoteAmountResult = QuotedAmount | { refused: Refused };

export function isRefused(a: QuoteAmountResult): a is { refused: Refused } {
  return 'refused' in a;
}

interface ChainQuoteRequest {
  chain_id: number;
  token_in: string;
  token_out: string;
  amounts_in: string[];
  pool?: string;
  slippage: Slippage;
}

export interface QuoteFlags {
  in: number;
  out: number;
  swap_enabled: boolean;
  halted: boolean;
  /** Either endpoint carries SWAP_GATED: `swap` needs AccessControl perms bit 10. */
  swap_gated?: boolean;
  /** Both endpoints admit a perm-less executor (no halt, swaps on, not gated). */
  open_path?: boolean;
}

export interface ChainQuoteResponse {
  chain_id: number;
  block: BlockRef;
  source: 'chain';
  amounts: QuoteAmountResult[];
  flags: QuoteFlags;
}

export interface ChainHop {
  pool: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
}

export interface ChainPart {
  hops: ChainHop[];
}

interface ChainFloor {
  token: string;
  amount_out: string;
  tol_pbps: number;
  min_out: string;
}

interface ChainRouteSelection {
  parts: ChainPart[];
  floors: ChainFloor[];
}

interface ChainRouteRequest {
  chain_id: number;
  token_in: string;
  token_out: string;
  amount_in: string;
  max_hops?: number;
  split?: boolean;
  slippage: Slippage;
}

/** One `getRiskFlags(token)` word read on `pool` (pool tag, token symbol, as in ChainHop). */
export interface ChainLegFlags {
  pool: string;
  token: string;
  word: number;
}

interface ChainRouteResponse {
  chain_id: number;
  block: BlockRef;
  source: 'chain';
  best: ChainRouteSelection | null;
  singles: ChainPart[];
  refused: Refused[];
  /** Every fetched (pool, token) word; empty on a head-surface answer. */
  flags?: ChainLegFlags[];
  /** A leg of `best` is SWAP_GATED: perm-less executors revert NotAuthorized. */
  swap_gated?: boolean;
  /** Every leg of `best` admits a perm-less executor; false with no `best`. */
  open_path?: boolean;
}

interface ChainClientOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injectable clock (tests); defaults to `Date.now`. */
  now?: () => number;
}

// ── process-wide policy state ────────────────────────────────────────────────
//
// One cooldown for the whole client: a 429 is the edge telling every caller to slow down, so a
// per-request cooldown would just re-hit the limiter. The monotonic block is per pair: two
// replicas can answer from different heads, and the older answer must never overwrite the newer.

let cooldownUntilMs = 0;
const lastBlock = new Map<string, number>();

/** Reset the cooldown and block guards (tests, and a deliberate retry after a cooldown). */
export function resetChainClientState(): void {
  cooldownUntilMs = 0;
  lastBlock.clear();
}

function cooldown(now: number): void {
  if (cooldownUntilMs > now) {
    throw new ChainError('rate_limited', 'chain rate limited', {
      status: 429,
      retryAfterSecs: Math.max(1, Math.ceil((cooldownUntilMs - now) / 1000)),
    });
  }
}

function acceptBlock(key: string, number: number): void {
  const seen = lastBlock.get(key);
  if (seen !== undefined && number < seen) {
    throw new ChainError('stale_block', `chain block ${number} is older than ${seen}`);
  }
  lastBlock.set(key, number);
}

async function post(path: string, body: unknown, opts: ChainClientOpts): Promise<unknown> {
  let res: Awaited<ReturnType<typeof btrFetchRaw>>;
  try {
    res = await btrFetchRaw(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });
  } catch (e) {
    // A network failure is not a price and not a verdict: `transport`, retryable.
    throw new ChainError('transport', e instanceof Error ? e.message : 'chain request failed');
  }
  if (!res.ok) {
    const err = parseChainError(res.status, res.body, res.retryAfterSecs);
    if (err.kind === 'rate_limited' || err.kind === 'rpc_unavailable') {
      const secs = err.retryAfterSecs ?? 1;
      cooldownUntilMs = (opts.now ?? Date.now)() + secs * 1000;
    }
    throw err;
  }
  try {
    return JSON.parse(res.body) as unknown;
  } catch (e) {
    throw new ChainError(
      'transport',
      e instanceof Error ? e.message : 'chain response was not JSON',
    );
  }
}

/** `back/crates/quote/src/slippage.rs` MAX_TOL_PBPS: 99.9%. */
const MAX_TOL_PBPS = 999_000;
/** `SwapQuote.spreadPbps` is a uint16 BY CONSTRUCTION — `PricingLib.sol` solves its interior swing cap
 *  so a composed fence always fits the field — so this is the widest spread any quote can carry. */
export const MAX_SPREAD_PBPS = 0xffff;

/** The widest `tol_pbps` the request's own policy can yield server-side (`slippage::floor`):
 *  relative is its clamped pbps, spread is `pct`% of a chain spread that cannot exceed its field.
 *
 *  Derived from the CALLER's numbers only. The served `spread_pbps` is deliberately not used: the
 *  server authors that too, so a bound built on it would bound nothing. A server tolerance TIGHTER
 *  than the policy is allowed through — it floors higher than asked, which costs a fill, not value. */
function policyTolPbps(slip: Slippage): number {
  if (slip.mode === 'relative') return Math.min(MAX_TOL_PBPS, Math.max(100, slip.pbps));
  const pct = Math.min(300, Math.max(10, slip.pct));
  return Math.min(MAX_TOL_PBPS, Math.floor((pct * MAX_SPREAD_PBPS) / 100));
}

/** One floor, typed. The generic `assertServerFloor` throws a plain `Error` for the builder; a
 *  wire-sourced violation is the client's to classify. */
function checkFloor(amountOut: string, tolPbps: number, minOut: string, slip: Slippage): void {
  try {
    assertServerFloor(BigInt(amountOut), tolPbps, BigInt(minOut), policyTolPbps(slip));
  } catch (e) {
    throw new ChainError(
      'floor_violation',
      e instanceof Error ? e.message : 'server floor is inconsistent',
    );
  }
}

/** The response answers THIS request's chain: a replica/LB mixup serving another chain's quote
 *  would otherwise price (and floor) the wrong assets. A wire-sourced mismatch is the client's
 *  to classify: `transport`, retryable. */
function checkChainId(what: string, want: number, got: unknown): void {
  if (got !== want) {
    throw new ChainError('transport', `${what} response is for chain ${String(got)}, not ${want}`);
  }
}

/** `POST /v1/chain/quote`. */
export async function chainQuote(
  req: ChainQuoteRequest,
  opts: ChainClientOpts = {},
): Promise<ChainQuoteResponse> {
  cooldown((opts.now ?? Date.now)());
  const raw = (await post(
    withChainId('/v1/chain/quote', req.chain_id),
    req,
    opts,
  )) as ChainQuoteResponse;
  if (!raw || typeof raw.block?.number !== 'number') {
    throw new ChainError('transport', 'chain/quote response is missing its block');
  }
  checkChainId('chain/quote', req.chain_id, raw.chain_id);
  const key = `q:${req.chain_id}:${req.token_in.toLowerCase()}:${req.token_out.toLowerCase()}`;
  acceptBlock(key, raw.block.number);
  for (const a of raw.amounts) {
    if (!isRefused(a)) {
      checkFloor(a.amount_out, a.tol_pbps, a.min_out, req.slippage);
    }
  }
  return raw;
}

/** `POST /v1/chain/route`. */
export async function chainRoute(
  req: ChainRouteRequest,
  opts: ChainClientOpts = {},
): Promise<ChainRouteResponse> {
  cooldown((opts.now ?? Date.now)());
  const raw = (await post(
    withChainId('/v1/chain/route', req.chain_id),
    req,
    opts,
  )) as ChainRouteResponse;
  if (!raw || typeof raw.block?.number !== 'number') {
    throw new ChainError('transport', 'chain/route response is missing its block');
  }
  checkChainId('chain/route', req.chain_id, raw.chain_id);
  const key = `r:${req.chain_id}:${req.token_in.toLowerCase()}:${req.token_out.toLowerCase()}:${req.amount_in.toLowerCase()}`;
  acceptBlock(key, raw.block.number);
  checkRouteShape(req, raw);
  for (const f of raw.best?.floors ?? []) {
    checkFloor(f.amount_out, f.tol_pbps, f.min_out, req.slippage);
  }
  return raw;
}

/** The served itineraries answer THE REQUEST, not a pair the server picked.
 *
 *  Hops name registry symbols while the request names addresses, so endpoint identity is bound by
 *  the caller that owns the roster (front `pricePlan`) and again at the calldata builder
 *  (`PlanLegOpts.expectedIn/Out`). What the wire alone can prove is checked here: every part is a
 *  joined chain, every part (best and singles) enters on one token and exits on one token, the best
 *  spends EXACTLY `amount_in` and each single all of it, and every floor names `token_out`. A route
 *  entering on a token the user did not pick would otherwise spend the typed raw amount in it. */
function checkRouteShape(req: ChainRouteRequest, raw: ChainRouteResponse): void {
  const bad = (why: string): never => {
    throw new ChainError('transport', `chain/route response ${why}`);
  };
  const big = (v: string): bigint => {
    try {
      return BigInt(v);
    } catch {
      return bad(`carries a non-integer amount ${v}`);
    }
  };
  const want = BigInt(req.amount_in);
  const parts = raw.best?.parts ?? [];
  const all = [...parts, ...(raw.singles ?? [])];
  let entry: string | undefined;
  let exit: string | undefined;
  for (const p of all) {
    const hops = p?.hops ?? [];
    if (hops.length === 0) bad('carries an empty part');
    for (let h = 1; h < hops.length; h++) {
      if (hops[h].token_in !== hops[h - 1].token_out) bad('carries a disjoint part');
    }
    const tin = hops[0].token_in;
    const tout = hops[hops.length - 1].token_out;
    if (tin === tout) bad('carries a part that exits on its own input');
    if ((entry ??= tin) !== tin) bad('parts enter on different tokens');
    if ((exit ??= tout) !== tout) bad('parts exit on different tokens');
  }
  if (raw.best) {
    const spent = parts.reduce((s, p) => s + big(p.hops[0].amount_in), 0n);
    if (parts.length > 0 && spent !== want) bad(`spends ${spent}, not the requested ${want}`);
    for (const f of raw.best.floors ?? []) {
      if (f.token.toLowerCase() !== req.token_out.toLowerCase()) bad('floors another token');
    }
  }
  for (const s of raw.singles ?? []) {
    if (big(s.hops[0].amount_in) !== want) bad('prices a single at another size');
  }
}
