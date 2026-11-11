/**
 * Chain-mode (`/v1/chain/*`) client: one base URL, typed errors, one cooldown, a monotonic block guard and
 * a floor check at the trust boundary.
 *
 * The server authors the floor (`tol_pbps` + `min_out`) from the same `getSwapQuote` that produced
 * `amount_out`. The client does not re-derive it; it checks the wire's ONE invariant,
 * `min_out = amount_out·(1e6 − tol_pbps)/1e6` for BOTH spread and relative modes
 * (`assertServerFloor`), and bounds `tol_pbps` by the widest the REQUEST's own policy can produce.
 * The formula alone is self-consistency — the server writes both of its sides — so without the
 * bound a floor 99.9% under the quote passes it. Spread mode adds two caller-side bounds: an
 * absolute `maxTolPbps` ceiling (1% by default) because `pct` alone scales the field maximum, and
 * `pct`% of the spread the response itself names.
 */

import type { QuoteBaseWire } from '../amm/aimm.js';
import { btrFetchRaw, withChainId } from '../api.js';
import { assertServerFloor } from '../router/index.js';
import { ChainError, parseChainError } from './errors.js';

/** Spread mode is a fraction of the SERVED spread on the server. `maxTolPbps` is the caller's own
 *  absolute ceiling on that fraction, in pbps: without it `pct=50` authorizes half of the uint16
 *  field maximum (32 767 pbps), not half of the 459 pbps spread the quote actually carries. */
export type Slippage =
  | { mode: 'spread'; pct: number; maxTolPbps?: number }
  | { mode: 'relative'; pbps: number };

interface BlockRef {
  number: number;
  timestamp: number;
}

export interface Refused {
  name: string;
  selector: string;
  args: string[];
}

export interface QuotedAmount extends QuoteBaseWire {
  route_hops: string[];
  hop_amounts: string[];
  tol_pbps: number;
  min_out: string;
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
  /** Either endpoint carries SWAP_GATED: `swap` needs the caller in `Pool.swapGate` (v10+; `readSwapGateMember`), AccessControl perms bit 10 on older pools. */
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
  /** A leg of `best` is SWAP_GATED: callers outside `Pool.swapGate` (v10+; AC perms bit 10 before) revert NotAuthorized. */
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
/** The smallest legal caller ceiling: 1 bp (0.01%), the service's own one-bp floor. */
const MIN_TOL_PBPS = 100;
/** Default caller-side ceiling on a spread-mode tolerance: 1% of the quote. `pct` is a fraction of
 *  the spread, and the served spread is only a few hundred pbps, so the field maximum under-bounds
 *  a `pct` by orders of magnitude without this. */
export const DEFAULT_SPREAD_TOL_PBPS = 10_000;

function clampPct(pct: number): number {
  return Math.min(300, Math.max(10, pct));
}

/** The caller's absolute ceiling for a spread-mode request. A missing ceiling is the 1% default;
 *  anything outside [100, 999_000] or a non-integer is a caller bug, refused before the request. */
function spreadMaxTolPbps(slip: { maxTolPbps?: number }): number {
  const max = slip.maxTolPbps ?? DEFAULT_SPREAD_TOL_PBPS;
  if (!Number.isInteger(max) || max < MIN_TOL_PBPS || max > MAX_TOL_PBPS) {
    throw new ChainError(
      'bad_request',
      `slippage.maxTolPbps must be an integer in [${MIN_TOL_PBPS}, ${MAX_TOL_PBPS}], got ${String(max)}`,
    );
  }
  return max;
}

/** Refuse a caller-owned ceiling the wire could never honour before spending a request on it. */
function validateSlippage(slip: Slippage): void {
  if (slip.mode === 'spread') spreadMaxTolPbps(slip);
}

/** The wire policy has no `maxTolPbps` field: it is a caller-side bound, not a server instruction,
 *  and an unknown key is a needless 400 risk on a strict deserializer. Strip it at the transport. */
function wireSlippage(slip: Slippage): Slippage {
  return slip.mode === 'spread'
    ? { mode: 'spread', pct: slip.pct }
    : { mode: 'relative', pbps: slip.pbps };
}

/** The widest `tol_pbps` the request's own policy can yield server-side (`slippage::floor`):
 *  relative is its clamped pbps, spread is `pct`% of a chain spread that cannot exceed its field,
 *  capped by the caller's absolute `maxTolPbps`.
 *
 *  Derived from the CALLER's numbers only. The served `spread_pbps` is deliberately not used here:
 *  the server authors that too, so a bound built on it would bound nothing (the served-spread
 *  check is a SECOND bound, {@link checkServedSpread}; this one survives a lying server). A server
 *  tolerance TIGHTER than the policy is allowed through — it floors higher than asked, which costs
 *  a fill, not value. */
export function slippageTolPbps(slip: Slippage): number {
  if (slip.mode === 'relative') return Math.min(MAX_TOL_PBPS, Math.max(MIN_TOL_PBPS, slip.pbps));
  const pct = clampPct(slip.pct);
  return Math.min(MAX_TOL_PBPS, Math.floor((pct * MAX_SPREAD_PBPS) / 100), spreadMaxTolPbps(slip));
}

/** One floor, typed. The generic `assertServerFloor` throws a plain `Error` for the builder; a
 *  wire-sourced violation is the client's to classify. */
function checkFloor(amountOut: string, tolPbps: number, minOut: string, slip: Slippage): void {
  try {
    assertServerFloor(BigInt(amountOut), tolPbps, BigInt(minOut), slippageTolPbps(slip));
  } catch (e) {
    throw new ChainError(
      'floor_violation',
      e instanceof Error ? e.message : 'server floor is inconsistent',
    );
  }
}

/** A spread-mode response names the spread it priced, so bound the tolerance by the caller's `pct`
 *  of THAT spread too. The absolute ceiling ({@link slippageTolPbps}) still bounds a server that
 *  lies about the spread; a server that serves a plausible spread but a far wider `tol_pbps` is
 *  caught here. `+1` absorbs the server's integer rounding of `pct%·spread`. Relative mode carries
 *  its own `pbps` and is unchanged. */
function checkServedSpread(amount: QuotedAmount, slip: Slippage): void {
  if (slip.mode !== 'spread') return;
  const spread = amount.spread_pbps;
  if (typeof spread !== 'number' || !Number.isFinite(spread)) return;
  const ceiling = Math.ceil((clampPct(slip.pct) * spread) / 100) + 1;
  if (!(amount.tol_pbps <= ceiling)) {
    throw new ChainError(
      'floor_violation',
      `server tol_pbps ${amount.tol_pbps} exceeds ${ceiling} = ${slip.pct}% of the served ${spread} pbps spread`,
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
  validateSlippage(req.slippage);
  cooldown((opts.now ?? Date.now)());
  const raw = (await post(
    withChainId('/v1/chain/quote', req.chain_id),
    { ...req, slippage: wireSlippage(req.slippage) },
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
      checkServedSpread(a, req.slippage);
    }
  }
  return raw;
}

/** `POST /v1/chain/route`. */
export async function chainRoute(
  req: ChainRouteRequest,
  opts: ChainClientOpts = {},
): Promise<ChainRouteResponse> {
  validateSlippage(req.slippage);
  cooldown((opts.now ?? Date.now)());
  const raw = (await post(
    withChainId('/v1/chain/route', req.chain_id),
    { ...req, slippage: wireSlippage(req.slippage) },
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
