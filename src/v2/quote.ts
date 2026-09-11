/**
 * Chain-mode (`/v2`) client: one base URL, typed errors, one cooldown, a monotonic block guard and
 * a floor check at the trust boundary.
 *
 * The server authors the floor (`tol_pbps` + `min_out`) from the same `getSwapQuote` that produced
 * `amount_out`. The client does not re-derive it; it checks the wire's ONE invariant,
 * `min_out = amount_out·(1e6 − tol_pbps)/1e6` for BOTH spread and relative modes
 * (`assertServerFloor`), and refuses to use a floor that violates it.
 */

import { btrFetchRaw } from '../api.js';
import { assertServerFloor } from '../router/index.js';
import { V2Error, parseV2Error } from './errors.js';

export type Slippage = { mode: 'spread'; pct: number } | { mode: 'relative'; pbps: number };

export interface BlockRef {
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

export type QuoteAmountResult = QuotedAmount | { refused: Refused };

export function isRefused(a: QuoteAmountResult): a is { refused: Refused } {
  return 'refused' in a;
}

export interface QuoteRequestV2 {
  chain_id: number;
  token_in: string;
  token_out: string;
  amounts_in: string[];
  pool?: string;
  slippage: Slippage;
  fresh?: boolean;
}

export interface QuoteFlags {
  in: number;
  out: number;
  swap_enabled: boolean;
  halted: boolean;
}

export interface QuoteResponseV2 {
  chain_id: number;
  block: BlockRef;
  source: 'chain';
  amounts: QuoteAmountResult[];
  flags: QuoteFlags;
}

export interface HopV2 {
  pool: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
}

export interface PartV2 {
  hops: HopV2[];
}

export interface FloorV2 {
  token: string;
  amount_out: string;
  tol_pbps: number;
  min_out: string;
}

export interface RouteSelectionV2 {
  parts: PartV2[];
  floors: FloorV2[];
}

export interface RouteRequestV2 {
  chain_id: number;
  token_in: string;
  token_out: string;
  amount_in: string;
  max_hops?: number;
  split?: boolean;
  slippage: Slippage;
}

export interface RouteResponseV2 {
  chain_id: number;
  block: BlockRef;
  source: 'chain';
  best: RouteSelectionV2 | null;
  singles: PartV2[];
  refused: Refused[];
}

export interface V2ClientOpts {
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
export function resetV2ClientState(): void {
  cooldownUntilMs = 0;
  lastBlock.clear();
}

function cooldown(now: number): void {
  if (cooldownUntilMs > now) {
    throw new V2Error('rate_limited', 'v2 rate limited', {
      status: 429,
      retryAfterSecs: Math.max(1, Math.ceil((cooldownUntilMs - now) / 1000)),
    });
  }
}

function acceptBlock(key: string, number: number): void {
  const seen = lastBlock.get(key);
  if (seen !== undefined && number < seen) {
    throw new V2Error('stale_block', `v2 block ${number} is older than ${seen}`);
  }
  lastBlock.set(key, number);
}

async function post(path: string, body: unknown, opts: V2ClientOpts): Promise<unknown> {
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
    throw new V2Error('transport', e instanceof Error ? e.message : 'v2 request failed');
  }
  if (!res.ok) {
    const err = parseV2Error(res.status, res.body, res.retryAfterSecs);
    if (err.kind === 'rate_limited' || err.kind === 'rpc_unavailable') {
      const secs = err.retryAfterSecs ?? 1;
      cooldownUntilMs = (opts.now ?? Date.now)() + secs * 1000;
    }
    throw err;
  }
  try {
    return JSON.parse(res.body) as unknown;
  } catch (e) {
    throw new V2Error('transport', e instanceof Error ? e.message : 'v2 response was not JSON');
  }
}

/** One floor, typed. The generic `assertServerFloor` throws a plain `Error` for the builder; a
 *  wire-sourced violation is the client's to classify. */
function checkFloor(amountOut: string, tolPbps: number, minOut: string): void {
  try {
    assertServerFloor(BigInt(amountOut), tolPbps, BigInt(minOut));
  } catch (e) {
    throw new V2Error(
      'floor_violation',
      e instanceof Error ? e.message : 'server floor is inconsistent',
    );
  }
}

/** `POST /v2/quote`. */
export async function quoteV2(
  req: QuoteRequestV2,
  opts: V2ClientOpts = {},
): Promise<QuoteResponseV2> {
  cooldown((opts.now ?? Date.now)());
  const raw = (await post('/v2/quote', req, opts)) as QuoteResponseV2;
  if (!raw || typeof raw.block?.number !== 'number') {
    throw new V2Error('transport', 'v2/quote response is missing its block');
  }
  const key = `q:${req.chain_id}:${req.token_in.toLowerCase()}:${req.token_out.toLowerCase()}`;
  acceptBlock(key, raw.block.number);
  for (const a of raw.amounts) {
    if (!isRefused(a)) {
      checkFloor(a.amount_out, a.tol_pbps, a.min_out);
    }
  }
  return raw;
}

/** `POST /v2/route`. */
export async function routeV2(
  req: RouteRequestV2,
  opts: V2ClientOpts = {},
): Promise<RouteResponseV2> {
  cooldown((opts.now ?? Date.now)());
  const raw = (await post('/v2/route', req, opts)) as RouteResponseV2;
  if (!raw || typeof raw.block?.number !== 'number') {
    throw new V2Error('transport', 'v2/route response is missing its block');
  }
  const key = `r:${req.chain_id}:${req.token_in.toLowerCase()}:${req.token_out.toLowerCase()}:${req.amount_in.toLowerCase()}`;
  acceptBlock(key, raw.block.number);
  for (const f of raw.best?.floors ?? []) checkFloor(f.amount_out, f.tol_pbps, f.min_out);
  return raw;
}
