// AIMM adapter surface: types + backend fetchers. Quotes route over POST /v1/quote|route,
// depth over POST /v1/depth (btr-quote, btr-core SSOT). The f64 replica is deleted.
//
// Single pipeline: route shapes + depth books live in `router/` (route/depth) and are
// re-exported here explicitly — one name, one owner, no star diamonds — so `@sdk/amm`
// deep imports keep resolving to the canonical modules.

export type {
  QuarticSeg,
  QuarticCurve,
  AimmProfile,
  PoolLeg,
  HubBook,
  PoolState,
  Quote,
  DepthLevel,
  DepthCurve,
  LegRisk,
  SegWire,
  CurveWire,
  PricingWire,
  SpokeWire,
  EndpointWire,
  NamedPoolWire,
  RouteRequestWire,
  LegWire,
  SplitPartWire,
  QuoteRouteWire,
  RouteResponseWire,
  DepthRowWire,
  DepthBookWire,
  DepthRequestWire,
  WireMeta,
  QuoteRequestWire,
  QuoteResponseWire,
} from './aimm.js';
export {
  BPS,
  PBPS,
  MAX_SEGS,
  CURVE_FLAG_REQUIRES_WALL,
  evalQ,
  areaQ,
  scaleY,
  buildCurve,
  INTERIOR_SWING_CAP_PBPS,
  MAX_DISPERSION_PBPS,
  curveSpanQ,
  dispersionCap,
  sanitizeDispersion,
  premiumBps,
  computeSkew,
  buildLeg,
  invertDepthCurve,
  backendBase,
  noteQuote429,
  quoteAsync,
  routeAsync,
  depthAsync,
  curveToWire,
  INTERIOR_ENDPOINT,
  hubEndpointWire,
  legToQuoteBody,
  quoteLegAsync,
  quoteFromWire,
  poolStateToWire,
} from './aimm.js';
export type {
  NamedPool,
  RouteLeg,
  Route,
  LegFill,
  RouteQuote,
  SplitPart,
  SwapPlan,
} from '../router/route.js';
export { poolHas, poolHolding } from '../router/route.js';
export type {
  Row,
  AggRow,
  DepthPool,
  AggregateDepthOpts,
  AggregatedDepthBook,
  BookPart,
  PairDepthOpts,
} from '../router/depth.js';
export {
  niceStep,
  stepLadder,
  aggregate,
  mergeAgg,
  depthLevelsToRows,
  bookPartFromCurve,
  assembleAggBook,
  fetchDepthBook,
  aggregateDepthAsync,
  aggregateDepthCurvesAsync,
  aggregatePairDepthAsync,
} from '../router/depth.js';

import type { PoolAsset } from '../pool/index.js';
import { formatUnits } from '../utils/format.js';
import { type AimmProfile, type PoolState, buildLeg } from './aimm.js';

export interface LegFeed {
  twap: number;
  sigma: number;
  profile: AimmProfile;
  kappaCovBps?: number;
}

const toFloat = (v: bigint, decimals: number): number => Number(formatUnits(v, decimals));

export function poolStateFrom(
  assets: PoolAsset[],
  base: string,
  feedOf: (symbol: string) => LegFeed | undefined,
): PoolState {
  const baseAsset = assets.find((a) => a.symbol === base);
  const baseRes = baseAsset ? toFloat(baseAsset.reserves, baseAsset.decimals) : 0;
  const legs: PoolState['legs'] = {};
  for (const a of assets) {
    if (a.symbol === base) continue;
    const f = feedOf(a.symbol);
    if (!f) continue;
    legs[a.symbol] = buildLeg(
      a.symbol,
      f.twap,
      f.sigma,
      toFloat(a.reserves, a.decimals),
      toFloat(a.liabilities, a.decimals),
      baseRes,
      a.decimals,
      f.profile,
      f.kappaCovBps ?? 0,
    );
  }
  // The hub is an ENDPOINT: its liabilities + wall toll a sell into it and its vega enters the
  // path spread in BOTH directions, so all three travel together off the base's own feed.
  const baseFeed = feedOf(base);
  const hub = baseAsset
    ? {
        res: baseRes,
        liab: toFloat(baseAsset.liabilities, baseAsset.decimals),
        vegaBps: baseFeed?.profile.vega ?? 0,
        kappaCovBps: baseFeed?.kappaCovBps ?? 0,
      }
    : undefined;
  return { base, legs, hub };
}
