// Depth over POST /v1/depth (btr-quote SSOT). The back prices, bucketizes and ladders every
// book (its `steps` is the only step ladder); this module sends the request and validates what
// comes back.

import {
  type DepthBookWire,
  type DepthEnd,
  type DepthGate,
  type DepthRequestWire,
  type DepthRowWire,
  type NamedPoolWire,
  depthAsync,
} from '../amm/aimm.js';
import { type NamedPool, poolHas } from './route.js';

/** One row of an aggregated book, as served, in the REQUESTED (displayed) pair (from, to). */
export interface AggRow {
  /** The row's level as the back serves it, from per to: a conservative bound on the marginal. */
  price: number;
  /** from-valued increment of this row. */
  size: number;
  /** from-valued running total (sum of `size`). */
  cum: number;
  /** to-token running total. Absent from an old back. */
  cum_base?: number;
  /** from-token running total paid (asks) or received (bids). Absent from an old back. */
  cum_quote?: number;
  /** Server remainder row (last on its side); only set when true. */
  tail?: boolean;
}

interface DepthPool {
  tag: string;
  state: import('../amm/aimm.js').PoolState;
}

export interface AggregateDepthOpts {
  /**
   * Row width, price units of the DISPLAYED pair; the back snaps it to its `steps`. Sent only when
   * provided. Throws RangeError when provided but not finite and > 0 (a caller bug, never sent).
   */
  step?: number;
  /**
   * Show the inverse pair (to/from) of the `from`/`to` passed. The request goes out with from/to
   * swapped and the answer is returned as is (never flipped client-side), so every field is
   * denominated in the displayed pair.
   *
   * Route set: the back composes multi-hop detours for a request (from, to) unless some hub pool
   * has base == `to`. So when a hub pool has base == the `from` you pass, the forward book has the
   * detours and the inverted request (to, from) does not (hub books only); the forward and inverse
   * books are then not reciprocal. Back fix pending.
   *
   * Mixed orientation: the same limit triggers on a hub part actually BUILT with base == `to`
   * (after the back's halted / unpriced skips). When hub parts exist with base == `from` AND with
   * base == `to` for the pair, the back reciprocates none of them and flags nothing: the book mixes
   * both units under the requested pair's label, in either orientation. Back fix pending.
   */
  invert?: boolean;
}

export interface AggregatedDepthBook extends DepthGate {
  /** Prices below: displayed pair (from per to), as served. */
  mark: number;
  mid: number;
  spreadBps: number;
  bid: number;
  ask: number;
  /** The back serves no net touch: equal to `bid` / `ask`. */
  bidNet: number;
  askNet: number;
  /** Row width used (a member of `steps` on the new back; only a tick on the old one). */
  step: number;
  /** Server ladder of valid `step` values; absent from an old back (that absence is the marker). */
  steps?: number[];
  bids: AggRow[];
  asks: AggRow[];
  /** How a side ends; `null` empty side, absent from an old back. `size` is in the to-token. */
  bid_end?: DepthEnd | null;
  ask_end?: DepthEnd | null;
  bidDisp: AggRow[];
  askDisp: AggRow[];
  poolCount: number;
  /** Itineraries merged into the book. */
  routeCount?: number;
}

// ── Wire validation: a malformed new field is absent, never guessed ──────────

const END_KINDS = ['reached_cap', 'stopped_on_refusal'];
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readSteps(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.every((x) => num(x) && x > 0) ? (v as number[]) : undefined;
}

function readEnd(v: unknown): DepthEnd | null | undefined {
  if (v === null) return null;
  const e = v as Partial<DepthEnd> | undefined;
  if (!e || typeof e !== 'object') return undefined;
  if (!num(e.price) || !num(e.size) || !END_KINDS.includes(e.kind as string)) return undefined;
  return { price: e.price, size: e.size, kind: e.kind as DepthEnd['kind'] };
}

function readRows(rs: DepthRowWire[]): AggRow[] {
  return (Array.isArray(rs) ? rs : []).flatMap((r) => {
    if (!r || !num(r.price) || !num(r.size) || !num(r.cum)) return [];
    const row: AggRow = { price: r.price, size: r.size, cum: r.cum };
    if (num(r.cum_base)) row.cum_base = r.cum_base;
    if (num(r.cum_quote)) row.cum_quote = r.cum_quote;
    if (r.tail === true) row.tail = true;
    return [row];
  });
}

/** The wire book with every new field validated (malformed: absent) and malformed rows dropped. */
function readWire(w: DepthBookWire): DepthBookWire {
  return {
    ...w,
    steps: readSteps(w.steps),
    bids: readRows(w.bids),
    asks: readRows(w.asks),
    bid_end: readEnd(w.bid_end),
    ask_end: readEnd(w.ask_end),
  };
}

function checkStep(step: number | undefined): void {
  if (step !== undefined && !(Number.isFinite(step) && step > 0)) {
    throw new RangeError(`depth step must be a finite number > 0, got ${step}`);
  }
}

// ── Single-sourced async dispatch (the only depthAsync call site) ────────────

/** One POST /v1/depth round trip. Every async entry below funnels through here. */
function fetchDepthBook(
  wires: NamedPoolWire[],
  from: string,
  to: string,
  opts?: AggregateDepthOpts & { base?: string },
): Promise<DepthBookWire> {
  const swap = !!opts?.invert;
  const step = opts?.step;
  checkStep(step);
  const body: DepthRequestWire = {
    pools: wires,
    from: swap ? to : from,
    to: swap ? from : to,
  };
  if (step !== undefined) body.step = step;
  return depthAsync(body, opts?.base).then(readWire);
}

/**
 * Aggregate virtual depth across every pool holding (from, to), via POST /v1/depth. Returns the
 * validated wire book (as `aggregatePairDepthAsync` reads it); with `invert` it is the SWAPPED
 * request's wire, denominated in the displayed (to/from) pair. Throws RangeError on a bad `step`.
 */
export async function aggregateDepthCurvesAsync(
  pools: DepthPool[],
  from: string,
  to: string,
  wires: NamedPoolWire[],
  opts?: AggregateDepthOpts & { base?: string },
): Promise<DepthBookWire | null> {
  checkStep(opts?.step);
  const eligible = pools.filter((p) => poolHas(p.state, from) && poolHas(p.state, to));
  if (!eligible.length) return null;
  return fetchDepthBook(wires, from, to, opts);
}

interface PairDepthOpts extends AggregateDepthOpts {
  base?: string;
}

/**
 * Dispatch entrypoint for any pair: direct pools via POST /v1/depth (backend shape),
 * routed pairs resolve to null. `wires` are the backend pool wires for `direct ?? pools`.
 */
export async function aggregatePairDepthAsync(
  pools: NamedPool[],
  from: string,
  to: string,
  wires: NamedPoolWire[],
  opts?: PairDepthOpts,
  direct?: DepthPool[],
): Promise<AggregatedDepthBook | null> {
  checkStep(opts?.step);
  if (from === to) return null;
  const directPools = direct ?? pools;
  const holds = (p: DepthPool) =>
    p.state.base === from || p.state.base === to || from in p.state.legs || to in p.state.legs;
  if (!directPools.some(holds)) return null;
  // The back denominates the whole book in the requested pair, so the inverse view is a swapped
  // request, never a client flip.
  const wire = await fetchDepthBook(wires, from, to, opts);
  const spreadOf = (bid: number, ask: number, mid: number): number =>
    bid > 0 && ask > 0 && mid > 0 ? (Math.abs(ask - bid) / mid) * 1e4 : 0;
  const gate: DepthGate = {
    swap_gated: wire.swap_gated,
    open_path: wire.open_path,
    reason: wire.reason ?? null,
  };
  const steps = wire.steps;
  return {
    mark: wire.mark,
    mid: wire.mid,
    spreadBps: spreadOf(wire.bid, wire.ask, wire.mid),
    bid: wire.bid,
    ask: wire.ask,
    bidNet: wire.bid,
    askNet: wire.ask,
    step: wire.step,
    steps,
    bids: wire.bids,
    asks: wire.asks,
    bid_end: wire.bid_end,
    ask_end: wire.ask_end,
    bidDisp: [],
    askDisp: [],
    poolCount: wire.poolCount ?? 1,
    routeCount: wire.routeCount,
    ...gate,
  };
}
