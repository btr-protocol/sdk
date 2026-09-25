// Canonical depth family: bucketing stays local (presentation over backend
// rows), curve sourcing is backend SSOT (POST /v1/depth via aimm depthAsync).
//
// aggregate/mergeAgg/niceStep/stepLadder/depthLevelsToRows/bookPartFromCurve/
// assembleAggBook duplicate no pricing law: they bucket rows the backend
// priced. All three async entry points (aggregateDepthAsync,
// aggregateDepthCurvesAsync, aggregatePairDepthAsync) funnel through
// fetchDepthBook: one depthAsync call site, no duplicated fetch logic.

import {
  type DepthBookWire,
  type DepthLevel,
  type DepthRequestWire,
  type NamedPoolWire,
  depthAsync,
  invertDepthCurve,
} from '../amm/aimm.js';
import { type NamedPool, poolHas } from './route.js';

export interface Row {
  price: number;
  size: number;
  cum: number;
}

export interface AggRow {
  price: number;
  size: number;
  cum: number;
}

interface DepthPool {
  tag: string;
  state: import('../amm/aimm.js').PoolState;
}

const SEQ = [1, 2, 5];

export function niceStep(x: number, dir: 'up' | 'down' | 'near' = 'near'): number {
  if (!(x > 0)) return 0;
  const base = 10 ** Math.floor(Math.log10(x));
  const m = x / base;
  const rungs = [1, 2, 5, 10];
  if (dir === 'up') return base * rungs.find((s) => s >= m - 1e-9)!;
  if (dir === 'down') return base * [...rungs].reverse().find((s) => s <= m + 1e-9)!;
  return (
    base * rungs.reduce((best, s) => (Math.abs(s - m) < Math.abs(best - m) ? s : best), rungs[0])
  );
}

const rungAt = (i: number) => SEQ[((i % 3) + 3) % 3] * 10 ** Math.floor(i / 3);

export function stepLadder(
  price: number,
  opts?: { targetFrac?: number; count?: number },
): { steps: number[]; defaultIdx: number } {
  const targetFrac = opts?.targetFrac ?? 0.00015;
  const count = Math.max(3, opts?.count ?? 9);
  const defStep = niceStep(Math.max(price * targetFrac, Number.MIN_VALUE), 'near');
  let di = 0;
  while (rungAt(di) < defStep * (1 - 1e-9)) di++;
  while (rungAt(di) > defStep * (1 + 1e-9)) di--;
  const below = Math.min(6, count - 1);
  const startIdx = di - below;
  const steps = Array.from({ length: count }, (_, j) => rungAt(startIdx + j));
  return { steps, defaultIdx: below };
}

const MAX_AGG_LEVELS = 80;

function cumAt(pts: { price: number; cum: number }[], price: number, side: 'bid' | 'ask'): number {
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].cum;
  if (side === 'ask') {
    if (price <= pts[0].price) return pts[0].cum;
    if (price >= pts[pts.length - 1].price) return pts[pts.length - 1].cum;
    for (let i = 1; i < pts.length; i++) {
      if (price <= pts[i].price) {
        const a = pts[i - 1];
        const b = pts[i];
        const span = b.price - a.price;
        const t = span > 0 ? (price - a.price) / span : 1;
        return a.cum + t * (b.cum - a.cum);
      }
    }
  } else {
    if (price >= pts[0].price) return pts[0].cum;
    if (price <= pts[pts.length - 1].price) return pts[pts.length - 1].cum;
    for (let i = 1; i < pts.length; i++) {
      if (price >= pts[i].price) {
        const a = pts[i - 1];
        const b = pts[i];
        const span = a.price - b.price;
        const t = span > 0 ? (a.price - price) / span : 1;
        return a.cum + t * (b.cum - a.cum);
      }
    }
  }
  return pts[pts.length - 1].cum;
}

export function aggregate(
  rows: Row[],
  step: number,
  side: 'bid' | 'ask',
  denom: 'base' | 'quote',
): AggRow[] {
  if (!rows.length) return [];

  const pts: { price: number; cum: number }[] = [];
  for (const r of rows) {
    if (!(r.price > 0) || !Number.isFinite(r.price) || !(r.cum >= 0)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.price - r.price) < 1e-12 * Math.max(1, r.price)) {
      if (last.cum === 0 && r.cum > 0) {
        pts.push({ price: r.price, cum: r.cum });
        continue;
      }
      last.cum = Math.max(last.cum, r.cum);
      continue;
    }
    if (last) {
      if (side === 'ask' && r.price < last.price - 1e-15) continue;
      if (side === 'bid' && r.price > last.price + 1e-15) continue;
      if (r.cum + 1e-15 < last.cum) continue;
    }
    pts.push({ price: r.price, cum: r.cum });
  }
  if (!pts.length) return [];

  const scale = (size: number, price: number) => (denom === 'quote' ? size * price : size);
  const eps = 1e-15;

  if (pts.length === 1) {
    const v = pts[0];
    const total = scale(v.cum, v.price);
    return total > eps ? [{ price: v.price, size: total, cum: total }] : [];
  }
  if (!(step > 0)) {
    const out: AggRow[] = [];
    let prev = 0;
    for (const p of pts) {
      const size = p.cum - prev;
      if (size > eps) out.push({ price: p.price, size: scale(size, p.price), cum: 0 });
      prev = p.cum;
    }
    let cum = 0;
    return out.map((r) => ({ ...r, cum: (cum += r.size) }));
  }

  const start = pts[0];
  const end = pts[pts.length - 1];
  const span = Math.abs(end.price - start.price);
  const effStep = span > 0 ? Math.max(step, span / MAX_AGG_LEVELS) : step;

  const out: AggRow[] = [];
  let prevCum = start.cum;

  if (side === 'ask') {
    let edge = Math.ceil(start.price / effStep - 1e-12) * effStep;
    if (edge <= start.price + 1e-12 * Math.max(1, start.price)) edge += effStep;
    for (;;) {
      const at = Math.min(edge, end.price);
      const c = cumAt(pts, at, 'ask');
      const size = c - prevCum;
      if (size > eps) {
        const px =
          edge <= end.price + 1e-12 * Math.max(1, end.price)
            ? edge
            : Math.ceil(end.price / effStep) * effStep;
        out.push({ price: px, size: scale(size, px), cum: 0 });
      }
      prevCum = c;
      if (at >= end.price - 1e-12 * Math.max(1, end.price)) break;
      edge += effStep;
    }
  } else {
    let edge = Math.floor(start.price / effStep + 1e-12) * effStep;
    if (edge >= start.price - 1e-12 * Math.max(1, start.price)) edge -= effStep;
    for (;;) {
      const at = Math.max(edge, end.price);
      const c = cumAt(pts, at, 'bid');
      const size = c - prevCum;
      if (size > eps) {
        const px =
          edge >= end.price - 1e-12 * Math.max(1, end.price)
            ? edge
            : Math.floor(end.price / effStep) * effStep;
        out.push({ price: px, size: scale(size, px), cum: 0 });
      }
      prevCum = c;
      if (at <= end.price + 1e-12 * Math.max(1, end.price)) break;
      edge -= effStep;
    }
  }

  let cum = 0;
  return out.map((r) => ({ ...r, cum: (cum += r.size) }));
}

export function mergeAgg(parts: AggRow[][], side: 'bid' | 'ask'): AggRow[] {
  const buckets = new Map<number, number>();
  for (const rows of parts) {
    for (const r of rows) buckets.set(r.price, (buckets.get(r.price) ?? 0) + r.size);
  }
  const entries = [...buckets.entries()].sort((a, b) =>
    side === 'bid' ? b[0] - a[0] : a[0] - b[0],
  );
  let cum = 0;
  return entries.map(([price, size]) => ({ price, size, cum: (cum += size) }));
}

export function depthLevelsToRows(levels: DepthLevel[]): Row[] {
  return levels.map((l, i) => ({
    price: l.netPrice,
    size: i === 0 ? l.cumTok : l.cumTok - levels[i - 1].cumTok,
    cum: l.cumTok,
  }));
}

export interface AggregateDepthOpts {
  step?: number;
  unit?: 'token' | 'base';
  ladder?: { targetFrac?: number; count?: number };
  stepIdx?: number;
  invert?: boolean;
}

export interface AggregatedDepthBook {
  mark: number;
  mid: number;
  spreadBps: number;
  bid: number;
  ask: number;
  bidNet: number;
  askNet: number;
  step: number;
  bids: AggRow[];
  asks: AggRow[];
  bidDisp: AggRow[];
  askDisp: AggRow[];
  ladder: { steps: number[]; defaultIdx: number } | null;
  poolCount: number;
  /** Itineraries merged into the book; absent on a locally aggregated one. */
  routeCount?: number;
}

// ── Single-sourced async dispatch (the only depthAsync call site) ────────────

/** One POST /v1/depth round trip. Every async entry below funnels through here. */
function fetchDepthBook(
  wires: NamedPoolWire[],
  from: string,
  to: string,
  base?: string,
): Promise<DepthBookWire> {
  const body: DepthRequestWire = { pools: wires, from, to };
  return depthAsync(body, base);
}

/** Aggregate virtual depth across every pool holding (from, to), via POST /v1/depth. */
export async function aggregateDepthCurvesAsync(
  pools: DepthPool[],
  from: string,
  to: string,
  wires: NamedPoolWire[],
  opts?: AggregateDepthOpts & { base?: string },
): Promise<DepthBookWire | null> {
  const eligible = pools.filter((p) => poolHas(p.state, from) && poolHas(p.state, to));
  if (!eligible.length) return null;
  void opts;
  return fetchDepthBook(wires, from, to, opts?.base);
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
  if (from === to) return null;
  const directPools = direct ?? pools;
  const holds = (p: DepthPool) =>
    p.state.base === from || p.state.base === to || from in p.state.legs || to in p.state.legs;
  if (!directPools.some(holds)) return null;
  const wire = await fetchDepthBook(wires, from, to, opts?.base);
  const flip = !!opts?.invert;
  const rec = (v: number): number | null => (v > 0 ? 1 / v : null);
  const inv = (v: number): number => rec(v) ?? 0;
  const spreadOf = (bid: number, ask: number, mid: number): number =>
    bid > 0 && ask > 0 && mid > 0 ? (Math.abs(ask - bid) / mid) * 1e4 : 0;
  const rows = (rs: { price: number; size: number; cum: number }[]) =>
    flip
      ? rs.flatMap((r) => {
          const price = rec(r.price);
          return price == null ? [] : [{ price, size: r.size, cum: r.cum }];
        })
      : rs.map((r) => ({ price: r.price, size: r.size, cum: r.cum }));
  const bids = rows(wire.bids);
  const asks = rows(wire.asks);
  if (flip) {
    const bid = inv(wire.ask);
    const ask = inv(wire.bid);
    const mid = inv(wire.mid);
    return {
      mark: inv(wire.mark),
      mid,
      spreadBps: spreadOf(bid, ask, mid),
      bid,
      ask,
      bidNet: inv(wire.ask_net),
      askNet: inv(wire.bid_net),
      step: wire.step,
      bids: asks.map((r) => ({ ...r })),
      asks: bids.map((r) => ({ ...r })),
      bidDisp: [],
      askDisp: [],
      ladder: null,
      poolCount: wire.poolCount ?? 1,
      routeCount: wire.routeCount,
    };
  }
  return {
    mark: wire.mark,
    mid: wire.mid,
    spreadBps: spreadOf(wire.bid, wire.ask, wire.mid),
    bid: wire.bid,
    ask: wire.ask,
    bidNet: wire.bid_net ?? wire.bid,
    askNet: wire.ask_net ?? wire.ask,
    step: wire.step,
    bids,
    asks,
    bidDisp: [],
    askDisp: [],
    ladder: null,
    poolCount: wire.poolCount ?? 1,
    routeCount: wire.routeCount,
  };
}

export { invertDepthCurve };
