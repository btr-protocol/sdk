// Backend-priced AIMM adapter: the integer law lives in `btr-quote` (btr-core SSOT).
//
// This module used to carry the off-chain f64 replica (curve traversal, path spread,
// coverage toll, depth ladders). It is deleted: two pricers disagree (0.26-0.45% on
// cross-core stables) and the chain honours only one. What stays is wire-compatible
// and quote-free:
//   types + unit constants + pure struct/inventory helpers (buildLeg, computeSkew,
//   premiumBps) + the integer curve codec (evalQ/areaQ/scaleY/buildCurve + caps,
//   owned by the storage readers) + thin async fetchers over `POST /v1/quote|route|depth`.
// The old sync quote entry points keep their names and throw: same import, loud failure,
// never silent TS math.

export const BPS = 1e4;
export const PBPS = 1e6;

export const MAX_SEGS = 14;
export const CURVE_FLAG_REQUIRES_WALL = 1;

export interface QuarticSeg {
  c0: bigint;
  c1: bigint;
  c2: bigint;
  c3: bigint;
  c4: bigint;
  S: bigint;
}

export interface QuarticCurve {
  m: number;
  boundaries: number[];
  dispRef: number;
  flags: number;
  segs: QuarticSeg[];
}

const P = 10n ** 18n;
const QI = 1_000_000_000n;
const DI = 1_000_000n;

const xInt = (x: number): number => (x <= 0 ? 0 : x >= BPS ? BPS : Math.round(x));

function frame(c: QuarticCurve, x: number): [i: number, x0: number, h: number] {
  let i = 0;
  let b = 0;
  let next = c.boundaries[0];
  while (i < c.m - 1 && x >= next) {
    i++;
    b = next;
    next = c.boundaries[i];
  }
  return [i, b, next - b];
}

export function evalQ(c: QuarticCurve, x: number): bigint {
  const xi = xInt(x);
  const [i, x0, h] = frame(c, xi);
  let dx = xi > x0 ? xi - x0 : 0;
  if (dx > h) dx = h;
  const u = (BigInt(dx) * P) / BigInt(h);
  const s = c.segs[i];
  let v = (s.c4 * u) / P;
  v = ((s.c3 + v) * u) / P;
  v = ((s.c2 + v) * u) / P;
  v = ((s.c1 + v) * u) / P;
  return s.c0 + v;
}

function atQ(c: QuarticCurve, x: number): bigint {
  const [i, x0, h] = frame(c, x);
  let dx = x > x0 ? x - x0 : 0;
  if (dx > h) dx = h;
  const u = (BigInt(dx) * P) / BigInt(h);
  const u2 = (u * u) / P;
  const u3 = (u2 * u) / P;
  const u4 = (u3 * u) / P;
  const u5 = (u4 * u) / P;
  const s = c.segs[i];
  const sum = s.c0 * u + (s.c1 * u2) / 2n + (s.c2 * u3) / 3n + (s.c3 * u4) / 4n + (s.c4 * u5) / 5n;
  return s.S + (BigInt(h) * sum) / P;
}

export function areaQ(c: QuarticCurve, x1: number, x2: number): bigint {
  const a = xInt(x1);
  const b = xInt(x2);
  if (a >= b) return 0n;
  return atQ(c, b) - atQ(c, a);
}

export function scaleY(yQ: bigint, curve: QuarticCurve, dispersionPbps: number): number {
  return Number((yQ * BigInt(Math.round(dispersionPbps))) / (BigInt(curve.dispRef) * QI));
}

function deBoor4(t: number[], wQ: bigint[], s: number, x: number): bigint {
  const d = [wQ[s - 4], wQ[s - 3], wQ[s - 2], wQ[s - 1], wQ[s]];
  for (let r = 1; r <= 4; r++) {
    for (let j = 4; j >= r; j--) {
      const den = BigInt(t[j + 1 + s - r] - t[j + s - 4]);
      const num = BigInt(x - t[j + s - 4]);
      d[j] = (d[j - 1] * (den - num) + d[j] * num) / den;
    }
  }
  return d[4];
}

const qCtrl = (t: number[], wQ: bigint[], i: number): bigint =>
  (4n * (wQ[i + 1] - wQ[i]) * DI) / BigInt(t[i + 5] - t[i + 1]);

function deBoorD1(t: number[], wQ: bigint[], s: number, x: number): bigint {
  const d = [qCtrl(t, wQ, s - 4), qCtrl(t, wQ, s - 3), qCtrl(t, wQ, s - 2), qCtrl(t, wQ, s - 1)];
  for (let r = 1; r <= 3; r++) {
    for (let j = 3; j >= r; j--) {
      const den = BigInt(t[j + s - r + 1] - t[j + s - 3]);
      const num = BigInt(x - t[j + s - 3]);
      d[j] = (d[j - 1] * (den - num) + d[j] * num) / den;
    }
  }
  return d[3];
}

function deBoorD2(t: number[], wQ: bigint[], s: number, x: number): bigint {
  const d: bigint[] = [];
  for (let k = 0; k < 3; k++) {
    const i = s - 4 + k;
    d.push((3n * (qCtrl(t, wQ, i + 1) - qCtrl(t, wQ, i))) / BigInt(t[i + 5] - t[i + 2]));
  }
  for (let r = 1; r <= 2; r++) {
    for (let j = 2; j >= r; j--) {
      const den = BigInt(t[j + s - r + 1] - t[j + s - 2]);
      const num = BigInt(x - t[j + s - 2]);
      d[j] = (d[j - 1] * (den - num) + d[j] * num) / den;
    }
  }
  return d[2];
}

function segCoeffs(t: number[], wQ: bigint[], s: number): bigint[] {
  const ih = BigInt(t[s + 1] - t[s]);
  const c0 = deBoor4(t, wQ, s, t[s]);
  const c1 = (deBoorD1(t, wQ, s, t[s]) * ih) / DI;
  const c2 = (deBoorD2(t, wQ, s, t[s]) * ih * ih) / (2n * DI);
  const A = deBoor4(t, wQ, s, t[s + 1]) - c0 - c1 - c2;
  const B = (deBoorD1(t, wQ, s, t[s + 1]) * ih) / DI - c1 - 2n * c2;
  return [c0, c1, c2, 4n * A - B, B - 3n * A];
}

export function buildCurve(
  interior: number[],
  wQ: bigint[],
  dispRef: number,
  flags = 0,
): QuarticCurve {
  if (dispRef === 0) throw new Error('dispRef 0 ⇒ _scaleY divides by zero');
  const n = wQ.length;
  if (n < 5 || n - 4 > MAX_SEGS || interior.length !== n - 5)
    throw new Error('invalid curve input');
  if (wQ[n - 1] === wQ[0]) throw new Error('flat curve = no price discovery');
  for (let i = 1; i < n; i++) {
    if (wQ[i] < wQ[i - 1]) throw new Error('Δw<0 ⇒ non-monotone curve');
  }
  const t = new Array<number>(n + 5).fill(0);
  let prev = 0;
  for (let j = 0; j < interior.length; j++) {
    const kx = interior[j];
    if (!Number.isInteger(kx) || kx <= prev || kx >= BPS) throw new Error('invalid interior knot');
    t[5 + j] = kx;
    prev = kx;
  }
  for (let i = n; i < n + 5; i++) t[i] = BPS;

  const shift = (wQ[0] + wQ[n - 1]) >> 1n;
  const wC = shift === 0n ? wQ : wQ.map((v) => v - shift);

  const m = n - 4;
  const boundaries: number[] = [];
  for (let j = 1; j <= m; j++) boundaries.push(t[j + 4]);
  const LIM = (2n ** 64n - 1n) / 2n;
  const I128_MAX = 2n ** 127n - 1n;
  const segs: QuarticSeg[] = [];
  let S = 0n;
  for (let j = 0; j < m; j++) {
    const k = segCoeffs(t, wC, j + 4);
    for (const v of k) if (v > LIM || v < -LIM) throw new Error('coefficient overflow');
    if (S > I128_MAX || S < -I128_MAX - 1n) throw new Error('prefix-integral overflow');
    segs.push({ c0: k[0], c1: k[1], c2: k[2], c3: k[3], c4: k[4], S });
    S +=
      (BigInt(t[j + 5] - t[j + 4]) *
        (60n * k[0] + 30n * k[1] + 20n * k[2] + 15n * k[3] + 12n * k[4])) /
      60n;
  }
  return { m, boundaries, dispRef, flags, segs };
}

export const INTERIOR_SWING_CAP_PBPS = 10_000;
export const MAX_DISPERSION_PBPS = 900_000;

export const curveSpanQ = (c: QuarticCurve): bigint => evalQ(c, BPS) - evalQ(c, 0);

export function dispersionCap(c: QuarticCurve): number {
  const span = curveSpanQ(c);
  if (span <= 0n) throw new Error('flat curve has no dispersion cap');
  const cap = (BigInt(INTERIOR_SWING_CAP_PBPS) * BigInt(c.dispRef) * QI) / span;
  return Number(cap > 4294967295n ? 4294967295n : cap);
}

export function sanitizeDispersion(minDispersion: number, cap: number): number {
  const mn = minDispersion === 0 ? 1000 : minDispersion;
  if (mn > cap || mn > MAX_DISPERSION_PBPS) throw new Error('BadConfig: dispersion floor');
  return mn;
}

// ── Quote-free state types ────────────────────────────────────────────────────

export interface AimmProfile {
  vega: number;
  minFee: number;
  minDisp: number;
  protoShare: number;
  curve: QuarticCurve;
}

export interface PoolLeg {
  token: string;
  twap: number;
  sigma: number;
  res: number;
  liab: number;
  baseRes: number;
  decimals: number;
  profile: AimmProfile;
  kappaCovBps: number;
  confidence?: number;
  staleExcess?: number;
}

export interface HubBook {
  res: number;
  liab: number;
  kappaCovBps: number;
}

export interface PoolState {
  base: string;
  legs: Record<string, PoolLeg>;
  hub?: HubBook;
}

export interface Quote {
  amountOut: number;
  grossOut: number;
  avgPrice: number;
  midPrice: number;
  markPrice: number;
  midPremiumBps: number;
  netPremiumBps: number;
  priceImpactBps: number;
  spreadBps: number;
  lpFeeBps: number;
  protoFeeBps: number;
  covTollBps: number;
  maxIn: number;
  route: string[];
}

export interface DepthLevel {
  price: number;
  netPrice: number;
  cumTok: number;
  cumBase: number;
}

export interface DepthCurve {
  mark: number;
  mid: number;
  spreadBps: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  maxTokBid: number;
  maxTokAsk: number;
  unit: 'token' | 'base';
}

export interface LegRisk {
  sigma: number;
  minFee: number;
  confidence?: number;
  staleExcess?: number;
}

export function premiumBps(price: number, mark: number): number {
  return mark > 0 ? ((price - mark) / mark) * 1e4 : 0;
}

/** Inventory skew ∈ [-100, 100] from coverage. Display/inventory only, never a quote. */
export function computeSkew(res: number, liab: number): number {
  if (liab <= 0) return -100;
  const c = res / liab;
  if (c <= 0.5) return 100;
  if (c >= 2) return -100;
  return c < 1 ? Math.trunc(200 * (1 - c)) : -Math.trunc(100 * (c - 1)) || 0;
}

export function buildLeg(
  token: string,
  twap: number,
  sigma: number,
  res: number,
  liab: number,
  baseRes: number,
  decimals: number,
  profile: AimmProfile,
  kappaCovBps = 0,
  feed?: { confidence?: number; staleExcess?: number },
): PoolLeg {
  return {
    token,
    twap,
    sigma,
    res,
    liab,
    baseRes,
    decimals,
    profile,
    kappaCovBps,
    confidence: feed?.confidence,
    staleExcess: feed?.staleExcess,
  };
}

/** Pure reciprocal of a depth curve: no curve math, no quote. */
export function invertDepthCurve(c: DepthCurve): DepthCurve {
  const inv = (x: number) => (x > 0 ? 1 / x : 0);
  const swap = (ls: DepthLevel[]): DepthLevel[] =>
    ls.map((l) => ({
      price: inv(l.price),
      netPrice: inv(l.netPrice),
      cumTok: l.cumBase,
      cumBase: l.cumTok,
    }));
  const bids = swap(c.asks);
  const asks = swap(c.bids);
  return {
    mark: inv(c.mark),
    mid: inv(c.mid),
    spreadBps: c.spreadBps,
    bids,
    asks,
    maxTokBid: bids[bids.length - 1]?.cumTok ?? 0,
    maxTokAsk: asks[asks.length - 1]?.cumTok ?? 0,
    unit: c.unit,
  };
}

// ── Deleted quote law: same names, loud failure ───────────────────────────────

const OFFLINE =
  'aimm TS pricer deleted: backend SSOT at POST /v1/quote|route|depth (see quoteAsync/routeAsync/depthAsync)';

/** The f64 quote replica is gone; use quoteAsync (POST /v1/quote|route). */
export function quoteExactIn(): Quote {
  throw new Error(OFFLINE);
}
/** Depth ladders are served by POST /v1/depth; use depthAsync. */
export function depthCurve(): DepthCurve {
  throw new Error(OFFLINE);
}
/** Depth ladders are served by POST /v1/depth; use depthAsync. */
export function virtualMarketDepth(): DepthCurve {
  throw new Error(OFFLINE);
}

// ── Backend wire (mirror of btr-quote serde structs) ─────────────────────────

export interface SegWire {
  c0: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
  s: string;
}
export interface CurveWire {
  header: string;
  segs: SegWire[];
  m: number;
}
export interface PricingWire {
  curve: CurveWire;
  min_dispersion_pbps: number;
  vega_bps: number;
  min_fee_pbps: number;
  kappa_cov_bps: number;
}
export interface SpokeWire {
  token: string;
  address?: string | null;
  pricing: PricingWire;
  reserves: string;
  liabilities: string;
  mark: string;
  sigma_pbps: number;
  confidence_bps: number;
  stale_excess: number;
  proto_share_pct: number;
  decimals?: number;
}
export interface NamedPoolWire {
  tag: string;
  addr?: string | null;
  base: string;
  base_address?: string | null;
  base_reserves?: string | null;
  spokes: SpokeWire[];
}
export interface RouteRequestWire {
  pools: NamedPoolWire[];
  token_in: string;
  token_out: string;
  amount_in: string;
  slices?: number;
  min_gain_bps?: number;
  max_routes?: number;
}
export interface LegWire {
  pool_tag: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
}
export interface SplitPartWire {
  legs: LegWire[];
  fraction: string;
  amount_out: string;
}
export interface QuoteRouteWire {
  legs: LegWire[];
  amount_in: string;
  amount_out: string;
}
export interface RouteResponseWire {
  best_amount_out: string;
  best_is_split: boolean;
  best_parts: SplitPartWire[];
  singles: QuoteRouteWire[];
}
export interface DepthRowWire {
  price: number;
  size: number;
  cum: number;
}
export interface DepthBookWire {
  mark: number;
  mid: number;
  bid: number;
  ask: number;
  bid_net: number;
  ask_net: number;
  step: number;
  bids: DepthRowWire[];
  asks: DepthRowWire[];
  poolCount?: number;
}
export interface DepthRequestWire {
  pools: NamedPoolWire[];
  from: string;
  to: string;
}

const DEFAULT_BASE = 'https://api.btr.markets/v1';

export function backendBase(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  try {
    const envBase = typeof process !== 'undefined' ? process.env?.BTR_API : undefined;
    if (envBase) return envBase.replace(/\/$/, '');
  } catch {
    // no process in browsers: fall through to the default host
  }
  return DEFAULT_BASE;
}

let quote429Until = 0;

export function noteQuote429(ms = 20_000): void {
  quote429Until = Math.max(quote429Until, Date.now() + ms);
}

function guardQuote429(path: string): void {
  if (Date.now() < quote429Until) throw new Error(`btr-quote HTTP 429 ${path}: cooling down`);
}

function noteQuote429Status(status: number): void {
  if (status === 429) noteQuote429();
}

function noteQuote429Error(e: unknown): void {
  if (e instanceof Error && /(^| )429[ :]|HTTP 429/.test(e.message)) noteQuote429();
}

async function post<T>(
  base: string,
  path: '/quote' | '/route' | '/depth',
  body: unknown,
): Promise<T> {
  guardQuote429(path);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    noteQuote429Error(e);
    throw e;
  } finally {
    clearTimeout(t);
  }
  noteQuote429Status(res.status);
  if (!res.ok) throw new Error(`btr-quote HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

/** Single-pool exact-in quote over POST /v1/quote. */
export function quoteAsync(
  body: Record<string, unknown>,
  base?: string,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>(backendBase(base), '/quote', body);
}

/** Optimal routing across pools over POST /v1/route. */
export function routeAsync(req: RouteRequestWire, base?: string): Promise<RouteResponseWire> {
  return post<RouteResponseWire>(backendBase(base), '/route', req);
}

/** Depth ladder over POST /v1/depth. */
export function depthAsync(req: DepthRequestWire, base?: string): Promise<DepthBookWire> {
  return post<DepthBookWire>(backendBase(base), '/depth', req);
}

// ── Wire packing (pure codec, no pricing law) ────────────────────────────────

const toHex = (v: bigint): string => `0x${v.toString(16)}`;
const TWO_256 = 1n << 256n;
const i256Hex = (v: bigint): string => toHex(v < 0n ? TWO_256 + v : v);
const MAX_U128 = (1n << 128n) - 1n;
const toU128Hex = (v: number): string => {
  if (!Number.isFinite(v) || v < 0) throw new Error(`toU128Hex out of range: ${v}`);
  const b = BigInt(Math.round(v));
  if (b < 0n || b > MAX_U128) throw new Error(`toU128Hex out of range: ${v}`);
  return `0x${b.toString(16)}`;
};

/** Pack an SDK QuarticCurve into the CurveWire header (median pinned at BPS/2 = 5000). */
export function curveToWire(c: QuarticCurve): CurveWire {
  let header = BigInt(c.m);
  c.boundaries.forEach((b, i) => {
    header |= BigInt(b) << BigInt(8 + 16 * i);
  });
  header |= 5000n << 216n;
  header |= BigInt(c.dispRef) << 232n;
  header |= BigInt(c.flags) << 248n;
  return {
    header: toHex(header),
    segs: c.segs.slice(0, c.m).map((s) => ({
      c0: i256Hex(s.c0),
      c1: i256Hex(s.c1),
      c2: i256Hex(s.c2),
      c3: i256Hex(s.c3),
      c4: i256Hex(s.c4),
      s: i256Hex(s.S),
    })),
    m: c.m,
  };
}

export interface WireMeta {
  addressOf: (sym: string) => string | null;
  decimalsOf: (sym: string) => number;
}

export interface QuoteRequestWire {
  curve: CurveWire;
  min_dispersion_pbps: number;
  vega_bps: number;
  min_fee_pbps: number;
  kappa_cov_bps: number;
  amount_in: string;
  reserves: string;
  liabilities: string;
  mark: string;
  sigma_pbps: number;
  selling: boolean;
  confidence_bps: number;
  stale_excess: number;
  proto_share_pct: number;
}

export interface QuoteResponseWire {
  amount_out: string;
  gross_out: string;
  avg_price: string;
  mid_price: string;
  mark_price: string;
  spread_pbps: number;
  cov_toll: string;
  proto_fee: string;
  lp_fee: string;
}

/** One leg as a /quote body. `selling` = paying the spoke into the hub. */
export function legToQuoteBody(
  leg: PoolLeg,
  amountInTok: number,
  selling: boolean,
  decimalsIn: number,
): QuoteRequestWire {
  return {
    curve: curveToWire(leg.profile.curve),
    min_dispersion_pbps: leg.profile.minDisp,
    vega_bps: leg.profile.vega,
    min_fee_pbps: leg.profile.minFee,
    kappa_cov_bps: leg.kappaCovBps,
    amount_in: toU128Hex(amountInTok * 10 ** decimalsIn),
    reserves: toU128Hex(leg.res * 10 ** leg.decimals),
    liabilities: toU128Hex(leg.liab * 10 ** leg.decimals),
    mark: toHex(BigInt(Math.round(leg.twap * 1e18))),
    sigma_pbps: leg.sigma,
    selling,
    confidence_bps: leg.confidence ?? 0,
    stale_excess: leg.staleExcess ?? 0,
    proto_share_pct: Math.round(leg.profile.protoShare),
  };
}

/** Single-leg exact-in quote over POST /v1/quote. */
export function quoteLegAsync(
  leg: PoolLeg,
  amountInTok: number,
  selling: boolean,
  decimalsIn: number,
  base?: string,
): Promise<QuoteResponseWire> {
  return post<QuoteResponseWire>(
    backendBase(base),
    '/quote',
    legToQuoteBody(leg, amountInTok, selling, decimalsIn),
  );
}

const wadToF64 = (h: string): number => Number(BigInt(h)) / 1e18;

/** Wire → f64 Quote. WAD prices convert to token space via the leg decimals. */
export function quoteFromWire(
  w: QuoteResponseWire,
  decIn: number,
  decOut: number,
  route: string[],
  amountInTok: number,
): Quote {
  const amountOut = Number(BigInt(w.amount_out)) / 10 ** decOut;
  const grossOut = Number(BigInt(w.gross_out)) / 10 ** decOut;
  const unit = 10 ** decIn / 10 ** decOut;
  const avgPrice = wadToF64(w.avg_price) * unit;
  const midPrice = wadToF64(w.mid_price) * unit;
  const markPrice = wadToF64(w.mark_price) * unit;
  const grossAvg = amountInTok > 0 && grossOut > 0 ? grossOut / amountInTok : 0;
  const spreadBps = w.spread_pbps / 100;
  const feeBps = (fee: string): number =>
    grossOut > 0 ? (Number(BigInt(fee)) / Number(BigInt(w.gross_out))) * 1e4 : 0;
  return {
    amountOut,
    grossOut,
    avgPrice,
    midPrice,
    markPrice,
    midPremiumBps: premiumBps(midPrice, markPrice),
    netPremiumBps: premiumBps(avgPrice, markPrice),
    priceImpactBps: midPrice > 0 && grossAvg > 0 ? Math.abs(grossAvg / midPrice - 1) * 1e4 : 0,
    spreadBps,
    lpFeeBps: feeBps(w.lp_fee),
    protoFeeBps: feeBps(w.proto_fee),
    covTollBps: grossOut > 0 ? (Number(BigInt(w.cov_toll)) / Number(BigInt(w.gross_out))) * 1e4 : 0,
    maxIn: Number.POSITIVE_INFINITY,
    route,
  };
}

/** PoolState → NamedPoolWire for /route|depth. */
export function poolStateToWire(
  tag: string,
  addr: string | undefined,
  state: PoolState,
  meta: WireMeta,
  hubDecimals: number,
): NamedPoolWire {
  const hubLeg = Object.values(state.legs).find((l) => l.baseRes > 0);
  return {
    tag,
    addr: addr ?? null,
    base: state.base,
    base_address: meta.addressOf(state.base),
    base_reserves: hubLeg ? toU128Hex(hubLeg.baseRes * 10 ** hubDecimals) : null,
    spokes: Object.values(state.legs).map((leg) => ({
      token: leg.token,
      address: meta.addressOf(leg.token),
      pricing: {
        curve: curveToWire(leg.profile.curve),
        min_dispersion_pbps: leg.profile.minDisp,
        vega_bps: leg.profile.vega,
        min_fee_pbps: leg.profile.minFee,
        kappa_cov_bps: leg.kappaCovBps,
      },
      reserves: toU128Hex(leg.res * 10 ** leg.decimals),
      liabilities: toU128Hex(leg.liab * 10 ** leg.decimals),
      mark: toHex(BigInt(Math.round(leg.twap * 1e18))),
      sigma_pbps: leg.sigma,
      confidence_bps: leg.confidence ?? 0,
      stale_excess: leg.staleExcess ?? 0,
      proto_share_pct: Math.round(leg.profile.protoShare),
      decimals: leg.decimals,
    })),
  };
}
