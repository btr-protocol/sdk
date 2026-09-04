// Route-composed virtual depth: served by POST /v1/depth for hub pairs only.
//
// The local composition (chaining leg ask ladders input→output) duplicated the quote law
// rung by rung, so it is deleted with the pricer. aggregatePairDepth keeps its name as an
// async dispatch: direct pools via POST /v1/depth, routed pairs resolve to null (the
// backend sweep serves hub pairs; a routed pair has no single-pool book). The sync names
// throw: same import, loud failure, never silent TS math.

import { type NamedPoolWire, depthAsync } from './aimm.js';
import type { AggregateDepthOpts, AggregatedDepthBook, DepthPool } from './depthAgg.js';
import type { NamedPool } from './router.js';

/** Composed books were priced locally; the backend serves hub pairs only. */
export function aggregateRouteDepthCurves(): AggregatedDepthBook | null {
  throw new Error('aimm TS pricer deleted: routed depth has no backend book (hub pairs only)');
}

/** Sync dispatch is gone with the local pricer; use aggregatePairDepthAsync. */
export function aggregatePairDepth(): AggregatedDepthBook | null {
  throw new Error('aimm TS pricer deleted: depth over POST /v1/depth via aggregatePairDepthAsync');
}

export interface PairDepthOpts extends AggregateDepthOpts {
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
  const wire = await depthAsync({ pools: wires, from, to }, opts?.base);
  const flip = !!opts?.invert;
  const rec = (v: number) => (flip && v > 0 ? 1 / v : 0);
  const rows = (rs: { price: number; size: number; cum: number }[]) =>
    rs.map((r) => ({ price: flip ? rec(r.price) : r.price, size: r.size, cum: r.cum }));
  const bids = rows(wire.bids);
  const asks = rows(wire.asks);
  if (flip) {
    const t = bids;
    return {
      mark: rec(wire.mark),
      mid: rec(wire.mid),
      spreadBps: 0,
      bid: rec(wire.ask),
      ask: rec(wire.bid),
      bidNet: rec(wire.ask_net),
      askNet: rec(wire.bid_net),
      step: wire.step,
      bids: asks.map((r) => ({ ...r })),
      asks: bids.map((r) => ({ ...r })),
      bidDisp: [],
      askDisp: [],
      ladder: null,
      poolCount: wire.poolCount ?? 1,
    };
  }
  return {
    mark: wire.mark,
    mid: wire.mid,
    spreadBps: 0,
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
  };
}
