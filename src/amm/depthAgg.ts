// Order-book aggregation + multi-pool depth curves.
// Densifies Hermite depth polylines onto a 1/2/5 price ladder, then merges N pools.
// Front DepthPanel + chart liquidity bands share this math (no parallel model).

import {
  type DepthCurve,
  type DepthLevel,
  type PoolState,
  depthCurve,
  virtualMarketDepth,
} from './aimm.js';

export interface Row {
  price: number; // quote asset per token
  size: number; // token traded at this step
  cum: number; // cumulative token outward from the mid
}

export interface AggRow {
  price: number;
  size: number;
  cum: number;
}

/** Minimal pool handle for aggregation (NamedPool satisfies this). */
export interface DepthPool {
  tag: string;
  state: PoolState;
}

const SEQ = [1, 2, 5];

/** Snap x to the nearest 1/2/5·10^k "nice" value (up / down / nearest). */
export function niceStep(x: number, dir: 'up' | 'down' | 'near' = 'near'): number {
  if (!(x > 0)) return 0;
  const base = 10 ** Math.floor(Math.log10(x));
  const m = x / base; // mantissa in [1,10)
  const rungs = [1, 2, 5, 10];
  if (dir === 'up') return base * rungs.find((s) => s >= m - 1e-9)!;
  if (dir === 'down') return base * [...rungs].reverse().find((s) => s <= m + 1e-9)!;
  return base * rungs.reduce((best, s) => (Math.abs(s - m) < Math.abs(best - m) ? s : best), rungs[0]);
}

const rungAt = (i: number) => SEQ[((i % 3) + 3) % 3] * 10 ** Math.floor(i / 3);

/**
 * Ladder of `count` nice steps around price·targetFrac (default 1.5bps of price).
 * Most of the ladder sits below the default so fine aggregation is always reachable.
 */
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

/** Soft cap so a tiny step on a wide span cannot explode the DOM / canvas. */
const MAX_AGG_LEVELS = 80;

/**
 * Cumulative size at `price` along a mid-outward polyline
 * (asks: price↑/cum↑; bids: price↓/cum↑). Linear in price between vertices.
 */
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

/**
 * Resample a mid-outward cumulative depth polyline onto price buckets of width `step`.
 * `denom='quote'` scales token→quote (size·price).
 */
export function aggregate(rows: Row[], step: number, side: 'bid' | 'ask', denom: 'base' | 'quote'): AggRow[] {
  if (!rows.length) return [];

  const pts: { price: number; cum: number }[] = [];
  for (const r of rows) {
    if (!(r.price > 0) || !(r.cum >= 0)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.price - r.price) < 1e-12 * Math.max(1, r.price)) {
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

/**
 * Merge same-price agg rows from several pools (sum size, rebuild cum mid-outward).
 * Asks ascending / bids descending by price.
 */
export function mergeAgg(parts: AggRow[][], side: 'bid' | 'ask'): AggRow[] {
  const buckets = new Map<number, number>();
  for (const rows of parts) {
    for (const r of rows) buckets.set(r.price, (buckets.get(r.price) ?? 0) + r.size);
  }
  const entries = [...buckets.entries()].sort((a, b) => (side === 'bid' ? b[0] - a[0] : a[0] - b[0]));
  let cum = 0;
  return entries.map(([price, size]) => ({ price, size, cum: (cum += size) }));
}

/** DepthLevel[] → mid-outward Row polyline (includes cum=0 touch for densify). */
export function depthLevelsToRows(levels: DepthLevel[]): Row[] {
  return levels.map((l, i) => ({
    price: l.price,
    size: i === 0 ? l.cumTok : l.cumTok - levels[i - 1].cumTok,
    cum: l.cumTok,
  }));
}

const poolHas = (s: PoolState, token: string): boolean => token === s.base || token in s.legs;

function curveForPool(state: PoolState, from: string, to: string): DepthCurve {
  return from === state.base ? virtualMarketDepth(state, to) : depthCurve(state, from, to);
}

export interface AggregateDepthOpts {
  /** Explicit price step; omit → auto via stepLadder from span. */
  step?: number;
  /** Display denomination for *Disp rows (`token` = base size, `base` = quote notional). */
  unit?: 'token' | 'base';
  /** stepLadder targetFrac / count when step is auto. */
  ladder?: { targetFrac?: number; count?: number };
  /** Override ladder default index (UI step picker). */
  stepIdx?: number;
}

export interface AggregatedDepthBook {
  mark: number;
  mid: number;
  spreadBps: number;
  step: number;
  /** Token-denominated (for fill simulation). */
  bids: AggRow[];
  asks: AggRow[];
  /** Display-denominated (token or quote notional). */
  bidDisp: AggRow[];
  askDisp: AggRow[];
  /** Ladder used (null if explicit step only). */
  ladder: { steps: number[]; defaultIdx: number } | null;
  poolCount: number;
}

/**
 * Aggregate virtual depth across every pool that holds (from, to).
 * Per-pool densify onto `step`, then mergeAgg. N-pool ready (stable + volatile + future).
 */
export function aggregateDepthCurves(
  pools: DepthPool[],
  from: string,
  to: string,
  opts?: AggregateDepthOpts,
): AggregatedDepthBook | null {
  const eligible = pools.filter((p) => poolHas(p.state, from) && poolHas(p.state, to));
  if (!eligible.length) return null;

  type Part = { mark: number; mid: number; spreadBps: number; asks: Row[]; bids: Row[]; w: number };
  const parts: Part[] = [];
  for (const p of eligible) {
    const curve = curveForPool(p.state, from, to);
    if (!(curve.mid > 0) || (!curve.asks.length && !curve.bids.length)) continue;
    const asks = depthLevelsToRows(curve.asks);
    const bids = depthLevelsToRows(curve.bids);
    const w = asks.reduce((s, r) => s + r.size, 0) + bids.reduce((s, r) => s + r.size, 0);
    if (!(w > 0)) continue;
    parts.push({ mark: curve.mark, mid: curve.mid, spreadBps: curve.spreadBps, asks, bids, w });
  }
  if (!parts.length) return null;
  if (!parts.some((p) => p.asks.some((r) => r.cum > 0)) || !parts.some((p) => p.bids.some((r) => r.cum > 0))) {
    return null;
  }

  let markNum = 0;
  let midNum = 0;
  let spreadNum = 0;
  let wSum = 0;
  for (const p of parts) {
    markNum += p.mark * p.w;
    midNum += p.mid * p.w;
    spreadNum += p.spreadBps * p.w;
    wSum += p.w;
  }
  if (wSum <= 0) return null;
  const mark = markNum / wSum;
  const mid = midNum / wSum;
  const spreadBps = spreadNum / wSum;

  let below = 0;
  let above = 0;
  for (const p of parts) {
    const bidFar = p.bids[p.bids.length - 1]?.price ?? mid;
    const askFar = p.asks[p.asks.length - 1]?.price ?? mid;
    below = Math.max(below, mid - bidFar);
    above = Math.max(above, askFar - mid);
  }
  const halfSpan = Math.max(below, above);
  const ladderOpts =
    opts?.ladder ??
    (halfSpan > 0 ? { targetFrac: (halfSpan * 2) / 28 / mid } : undefined);
  let ladder = stepLadder(mid, ladderOpts);
  const minUseful = halfSpan > 0 ? halfSpan / MAX_AGG_LEVELS : 0;
  if (minUseful > 0) {
    const steps = ladder.steps.filter((s) => s >= minUseful * 0.99);
    if (steps.length >= 3) {
      const defStep = ladder.steps[ladder.defaultIdx];
      let defaultIdx = steps.findIndex((s) => s >= defStep - 1e-12 * Math.max(1, defStep));
      if (defaultIdx < 0) defaultIdx = Math.min(steps.length - 1, Math.floor(steps.length / 2));
      ladder = { steps, defaultIdx };
    }
  }

  const idx = opts?.stepIdx ?? ladder.defaultIdx;
  const step =
    opts?.step != null && opts.step > 0
      ? opts.step
      : ladder.steps[Math.min(Math.max(0, idx), ladder.steps.length - 1)];

  const bidTok = mergeAgg(
    parts.map((p) => aggregate(p.bids, step, 'bid', 'base')),
    'bid',
  );
  const askTok = mergeAgg(
    parts.map((p) => aggregate(p.asks, step, 'ask', 'base')),
    'ask',
  );
  const useQuote = opts?.unit === 'base';
  const bidDisp = useQuote
    ? mergeAgg(
        parts.map((p) => aggregate(p.bids, step, 'bid', 'quote')),
        'bid',
      )
    : bidTok;
  const askDisp = useQuote
    ? mergeAgg(
        parts.map((p) => aggregate(p.asks, step, 'ask', 'quote')),
        'ask',
      )
    : askTok;

  return {
    mark,
    mid,
    spreadBps,
    step,
    bids: bidTok,
    asks: askTok,
    bidDisp,
    askDisp,
    ladder: opts?.step != null && opts.step > 0 ? null : ladder,
    poolCount: parts.length,
  };
}
