// Shim: route enumeration + depth dispatch live in `router/` now (single
// route/depth family). This path stays for `@sdk/amm` deep imports.
export * from '../router/route.js';
export { aggregateDepthAsync, aggregateDepthCurvesAsync } from '../router/depth.js';
export { backendBase, routeAsync } from './aimm.js';
export type {
  DepthBookWire,
  NamedPoolWire,
  QuoteRouteWire,
  RouteRequestWire,
  RouteResponseWire,
} from './aimm.js';
