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
  PoolState,
  Quote,
  DepthLevel,
  DepthCurve,
  CurveWire,
  NamedPoolWire,
  RouteRequestWire,
  QuoteRouteWire,
  DepthBookWire,
  DepthRequestWire,
  WireMeta,
  PathLegWire,
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
  MAX_INTERIOR_SWING_PBPS,
  MAX_DISPERSION_PBPS,
  dispersionCap,
  sanitizeDispersion,
  premiumBps,
  computeSkew,
  buildLeg,
  invertDepthCurve,
  backendBase,
  quotePathAsync,
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
  AggregateDepthOpts,
  AggregatedDepthBook,
} from '../router/depth.js';
export {
  niceStep,
  stepLadder,
  aggregate,
  mergeAgg,
  depthLevelsToRows,
  aggregateDepthCurvesAsync,
  aggregatePairDepthAsync,
} from '../router/depth.js';
