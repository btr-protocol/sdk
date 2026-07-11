// Pure BTR AIMM pricer — the ONE model shared by useSwapQuote (the form) and the
// depth chart, so a quote and its rendered book can never disagree (spec D3).
//
// Ported 1:1 from dex/sim/src/amm/aimm.rs (the readable f64 reference that
// itself mirrors the on-chain dex/evm/src/libraries/Pricing.sol). Cited line numbers
// point at the Rust source each fn tracks. All internal prices are base(USDC)-per-token;
// quoteExactIn outputs are trader-oriented tokenOut-per-tokenIn.
//
// SEAMS (the only deferrals): σ (sigmaSeed → live feed.sigmaEma on deploy), reserves/L
// (usePoolData stub → on-chain), and each leg's kappaCovBps (defaults 0 = off, matching the
// current testnet risk config — dex/evm/deploy/testnet-asset-params.json sharedRiskConfig; wire
// per-asset RiskConfig.kappaCovBps via Pool once a risk-config view fn exists on-chain). Everything
// else is built fully, including the convex coverage-wall toll (GATE-07; Pricing.sol:355,659 `_covToll`).

export const BPS = 1e4; // 0.01%
export const PBPS = 1e6; // 0.0001% (fee/offset/dispersion unit)
export const WEIGHT_SUM = 200; // profile weights sum (1 unit = 0.5% depth)

export interface AimmProfile {
  gamma: number; // inventory sensitivity, BPS
  vega: number; // volatility sensitivity, BPS
  lambda: number; // deviation sensitivity, BPS (unused while U=0)
  minFee: number; // PBPS (1 = 0.01 bp floor; 100 = 1 bp)
  maxFee: number; // PBPS
  minDisp: number; // PBPS
  maxDisp: number; // PBPS
  covMin: number; // 0.01% units (5000 = 50%)
  covMax: number; // 0.01% units (20000 = 200%)
  depthAmp: number;
  protoShare: number; // % of spread routed to protocol (fee split)
  weights: number[]; // len n
  knots: number[]; // len n+1, each in [-100, 100]
}

/** One spoke edge vs the base numeraire. */
export interface PoolLeg {
  token: string;
  twap: number; // NX mark, base-per-token
  sigma: number; // sigmaEma from feed, PBPS-scaled (1e4 = 1%)
  res: number; // R — token reserves
  liab: number; // L — token liabilities (c = R/L)
  baseRes: number; // base (USDC) backing available to pay a sell
  decimals: number;
  profile: AimmProfile;
  // Convex coverage-wall strength (0 = off). IPool.RiskConfig.kappaCovBps (Pricing.sol:268) — the
  // BASE numeraire can never carry this (protocol invariant, enforced at addAsset), so it only ever
  // matters on a spoke leg's OUTPUT side (buying the spoke, or a cross trade's second leg).
  kappaCovBps: number;
}

/** Depth-1 star: `base` is the hub numeraire (no leg); spokes keyed by symbol. */
export interface PoolState {
  base: string;
  legs: Record<string, PoolLeg>;
}

export interface Quote {
  amountOut: number; // net of the path spread AND the coverage-wall toll
  grossOut: number; // pre-toll, pre-fee (spline area)
  avgPrice: number; // trader-effective tokenOut-per-tokenIn
  midPrice: number; // skewed size-0 tokenOut-per-tokenIn
  priceImpactBps: number; // pure-curve movement vs skewed mid
  spreadBps: number;
  lpFeeBps: number;
  protoFeeBps: number;
  covTollBps: number; // coverage-wall charge (GATE-07), as bps of grossOut; 0 when κ=0 or draining toward peg
  maxIn: number; // input that saturates the binding reserve clip
  route: string[];
}

export interface DepthLevel {
  price: number; // marginal base-per-token at this vertex
  cumTok: number; // cumulative token size outward from mid
  cumBase: number; // cumulative base notional outward from mid
}

export interface DepthCurve {
  /** Oracle mark (NX TWAP), base-per-token — inventory-independent. */
  mark: number;
  /** Skewed size-0 mid = mark + inventory premium, base-per-token. Book is centered here. */
  mid: number;
  bidBest: number;
  askBest: number;
  spreadBps: number;
  bids: DepthLevel[]; // price descending (sell token), outward from mid
  asks: DepthLevel[]; // price ascending (buy token), outward from mid
  maxTokBid: number;
  maxTokAsk: number;
  unit: 'token' | 'base';
}

/** Inventory premium in bps: (mid − mark) / mark. Positive ⇒ mid above oracle. */
export function premiumBps(mid: number, mark: number): number {
  return mark > 0 ? ((mid - mark) / mark) * 1e4 : 0;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ── Primitives (exported for tests) — each ports the cited aimm.rs fn ───────────

/** Spline control points: x = cumulative depth [0,10000], y = offset in PBPS. (aimm.rs:247) */
export function splinePoints(p: AimmProfile, disp: number): [number, number][] {
  const pts: [number, number][] = [[0, (p.knots[0] * disp) / 100]];
  let cum = 0;
  for (let i = 0; i < p.weights.length; i++) {
    cum += p.weights[i];
    pts.push([(cum * BPS) / WEIGHT_SUM, (p.knots[i + 1] * disp) / 100]);
  }
  return pts;
}

// ponytail: piecewise-LINEAR eval — the default knots are collinear so this is EXACT vs the
// Rust ref; a deployed non-collinear profile would need Spline.sol's monotone-cubic port here.
/** Linear interpolation of the spline at x, flat outside the knot span. (aimm.rs:529) */
export function evalSpline(pts: [number, number][], x: number): number {
  if (pts.length === 0) return 0;
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts.length - 1;
  if (x >= pts[last][0]) return pts[last][1];
  for (let i = 0; i < last; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[last][1];
}

/** Integral of the piecewise-linear spline over [lo, hi]. (aimm.rs:552) */
export function areaSpline(pts: [number, number][], lo: number, hi: number): number {
  if (hi <= lo || pts.length === 0) return 0;
  let acc = 0;
  let x = lo;
  while (x < hi) {
    // advance to whichever knot boundary bounds the segment containing x (linear ⇒ trapezoid exact)
    let nextKnot = hi;
    for (const [xk] of pts) {
      if (xk > x) {
        nextKnot = Math.min(xk, hi);
        break;
      }
    }
    acc += 0.5 * (evalSpline(pts, x) + evalSpline(pts, nextKnot)) * (nextKnot - x);
    if (nextKnot === x) break;
    x = nextKnot;
  }
  return acc;
}

/** Linear inventory skew ∈ [-100, 100] from a leg's coverage. (aimm.rs:191) */
export function computeSkew(res: number, liab: number, p: AimmProfile): number {
  if (liab <= 0) return -100;
  const c = res / liab;
  const critMin = p.covMin / BPS;
  const critMax = p.covMax / BPS;
  if (c <= critMin) return 100;
  if (c >= critMax) return -100;
  const under = c < 1;
  const numer = under ? 1 - c : c - 1;
  const denom = under ? 1 - critMin : critMax - 1;
  const s = Math.min((p.gamma / BPS) * 100 * (numer / denom), 100);
  return under ? s : -s;
}

/** Coverage-amplified effective pricing depth (NOT raw reserves). (aimm.rs:224) */
export function calcDepth(res: number, liab: number, p: AimmProfile): number {
  if (res <= 0) return 1;
  if (liab <= 0) return res;
  const c = res / liab;
  if (c >= 1 || p.depthAmp === 0) return res;
  const floor = 0.5;
  if (c <= floor) return res;
  const progress = (c - floor) / (1 - floor);
  const exponent = PBPS / (PBPS + 2 * p.depthAmp);
  const cp = progress ** exponent;
  return clamp(res + (p.depthAmp * (liab - res) * cp) / PBPS, 1, liab);
}

/** Dispersion κ in PBPS. Quiet floor = minDisp; σ·vega widens above it. (Pricing.sol `_calculateDispersion`) */
export function dispersion(sigma: number, p: AimmProfile): number {
  return clamp(p.minDisp + (sigma * p.vega) / (1000 * BPS), p.minDisp, p.maxDisp);
}

/** Path/leg spread (fee) in PBPS with U = U_stale = 0 (declared seams). (aimm.rs:282) */
export function spreadPbps(sigma: number, p: AimmProfile): number {
  return clamp(p.minFee + (sigma * p.vega) / (100 * BPS), p.minFee, p.maxFee);
}

/** Coverage potential Q(c) = ln c − c + 1: ≤0, max 0 at c=1, convex wall diverging as c→0.
 *  (Pricing.sol:682 `_covQ`; floored defensively — the real fail-closed lnWad(0) revert only fires
 *  on an on-chain integer-precision edge that `grossOut >= res` already short-circuits below.) */
export function covQ(c: number): number {
  const cc = Math.max(c, 1e-9);
  return Math.log(cc) - cc + 1;
}

/**
 * Convex coverage-wall toll (GATE-07) on the drained OUTPUT leg — 1:1 port of Pricing.sol:659
 * `_covToll` (charge-only, peg-clamped; NOT the older rebate-ledger variant in aimm-sim, which the
 * shipped contract never carried). Charges κ·L·(Q(c0)−Q(c1)) in output-token units: 0 when κ=0 or the
 * leg has no liabilities; `grossOut` when the drain would fully exhaust reserves (wall blocks the
 * whole fill); else the toll, clamped ≤ grossOut. Both coverages are clamped to the peg (min(c,1))
 * before differencing — Q peaks at c=1 and falls on BOTH sides, so an unclamped diff would let a drain
 * that STARTS over-covered cross the peg toll-free. Charge-only: dQ≤0 (draining toward/at peg) ⇒ 0.
 */
export function covToll(res: number, liab: number, kappaCovBps: number, grossOut: number): number {
  if (kappaCovBps <= 0 || liab <= 0 || grossOut <= 0) return 0;
  if (grossOut >= res) return grossOut;
  const c0 = Math.min(res / liab, 1);
  const c1 = Math.min((res - grossOut) / liab, 1);
  const dQ = covQ(c0) - covQ(c1);
  if (dQ <= 0) return 0;
  const toll = (dQ * kappaCovBps * liab) / BPS;
  return Math.min(toll, grossOut);
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
): PoolLeg {
  return { token, twap, sigma, res, liab, baseRes, decimals, profile, kappaCovBps };
}

// ── Per-leg derived kit + band traversal ────────────────────────────────────────

interface LegKit {
  leg: PoolLeg;
  twap: number;
  pts: [number, number][];
  center: number; // skewed book center in depth coords, 5000 + skew·50
  depth: number;
  mid: number; // priceAt(center), base-per-token
}

function legKit(leg: PoolLeg): LegKit {
  const p = leg.profile;
  const disp = dispersion(leg.sigma, p);
  const center = 5000 + computeSkew(leg.res, leg.liab, p) * 50;
  const pts = splinePoints(p, disp);
  const depth = calcDepth(leg.res, leg.liab, p);
  const mid = priceAt(leg.twap, pts, center);
  return { leg, twap: leg.twap, pts, center, depth, mid };
}

/** Marginal base-per-token at depth-coord d (floored at 5% of TWAP, matching the Rust ref). */
function priceAt(twap: number, pts: [number, number][], d: number): number {
  return Math.max((twap * (PBPS + evalSpline(pts, d))) / PBPS, twap * 0.05);
}

/** Average base-per-token over the ordered depth band [a,b] — the VWAP the trade fills at. */
function bandPrice(k: LegKit, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const w = hi - lo;
  let off = w === 0 ? evalSpline(k.pts, a) : areaSpline(k.pts, lo, hi) / w;
  off = Math.max(off, -0.9 * PBPS);
  return Math.max((k.twap * (PBPS + off)) / PBPS, k.twap * 0.05);
}

/** Average fill price over a traded volume by walking the spline. (aimm.rs:262) */
function traverse(k: LegKit, amountInTok: number, selling: boolean): number {
  const vf = Math.min((amountInTok * BPS) / k.depth, BPS);
  const end = selling ? Math.max(k.center - vf, 0) : Math.min(k.center + vf, BPS);
  return bandPrice(k, k.center, end);
}

// Fee profiles compose along a path by the worst (widest) leg — mirrors Pricing._pathSpread's
// max(vega)/max(minFee)/max(maxFee) reduction; protoShare is pool-level (equal across a pool's legs).
function worstProfile(profiles: AimmProfile[]): AimmProfile {
  const w = { ...profiles[0] };
  for (const b of profiles.slice(1)) {
    w.vega = Math.max(w.vega, b.vega);
    w.minFee = Math.max(w.minFee, b.minFee);
    w.maxFee = Math.max(w.maxFee, b.maxFee);
    w.protoShare = Math.max(w.protoShare, b.protoShare);
  }
  return w;
}

const zeroQuote = (route: string[]): Quote => ({
  amountOut: 0,
  grossOut: 0,
  avgPrice: 0,
  midPrice: 0,
  priceImpactBps: 0,
  spreadBps: 0,
  lpFeeBps: 0,
  protoFeeBps: 0,
  covTollBps: 0,
  maxIn: 0,
  route,
});

// ── quoteExactIn ────────────────────────────────────────────────────────────────

/**
 * Sell `amountIn` of `tokenIn` for `tokenOut` through the depth-1 star. Direct (one side is
 * the base) = one spline walk; cross = spoke→base→spoke composed. Path-fee model (spec D4):
 * half-spread haircut on the output, path spread computed once (Pricing.getAnchorPathQuote).
 */
export function quoteExactIn(
  state: PoolState,
  tokenIn: string,
  tokenOut: string,
  amountIn: number,
): Quote {
  const base = state.base;
  if (tokenIn === tokenOut) return zeroQuote([tokenIn, tokenOut]);
  const inBase = tokenIn === base;
  const outBase = tokenOut === base;

  let grossOut = 0;
  let midPrice = 0;
  let involved: PoolLeg[] = [];
  let route: string[];
  let maxIn = 0;
  // The leg whose reserves the trade actually DRAINS (the output side) — coverage toll applies here
  // (GATE-07). Never the base numeraire: it can't carry kappaCovBps (protocol invariant), so a DIRECT
  // SELL (output=base) leaves this undefined and tolls 0, matching Pricing.sol's cacheOut = tokenOut.
  let outLeg: PoolLeg | undefined;

  if (!inBase && outBase) {
    // DIRECT SELL: token → base.
    const leg = state.legs[tokenIn];
    if (!leg) return zeroQuote([tokenIn, tokenOut]);
    const k = legKit(leg);
    midPrice = k.mid; // base-per-token = out(base)-per-in(token)
    involved = [leg];
    route = [tokenIn, tokenOut];
    maxIn = capBidTok(k, leg); // token capacity before base drains / depth exhausts
    if (amountIn > 0)
      grossOut = Math.min(amountIn * traverse(k, amountIn, true), leg.baseRes * 0.999);
  } else if (inBase && !outBase) {
    // DIRECT BUY: base → token (one-step fixed point — replicate, don't solve; aimm.rs:346).
    const leg = state.legs[tokenOut];
    if (!leg) return zeroQuote([tokenIn, tokenOut]);
    const k = legKit(leg);
    midPrice = 1 / k.mid; // token-per-base
    involved = [leg];
    outLeg = leg;
    route = [tokenIn, tokenOut];
    maxIn = capAskBase(k, leg); // base capacity
    if (amountIn > 0) {
      const exec = traverse(k, amountIn / k.mid, false);
      grossOut = Math.min(amountIn / exec, leg.res * 0.999);
    }
  } else if (!inBase && !outBase) {
    // CROSS: sell tokenIn→base, buy tokenOut with that base (fixed point on the buy leg).
    const legIn = state.legs[tokenIn];
    const legOut = state.legs[tokenOut];
    if (!legIn || !legOut) return zeroQuote([tokenIn, base, tokenOut]);
    const kIn = legKit(legIn);
    const kOut = legKit(legOut);
    midPrice = kIn.mid / kOut.mid; // (base/in)/(base/out) = out-per-in
    involved = [legIn, legOut];
    outLeg = legOut;
    route = [tokenIn, base, tokenOut];
    maxIn = capBidTok(kIn, legIn);
    if (amountIn > 0) {
      const baseMid = Math.min(amountIn * traverse(kIn, amountIn, true), legIn.baseRes * 0.999);
      const exec = traverse(kOut, baseMid / kOut.mid, false);
      grossOut = Math.min(baseMid / exec, legOut.res * 0.999);
    }
  } else {
    return zeroQuote([tokenIn, tokenOut]); // base→base
  }

  const wp = worstProfile(involved.map((l) => l.profile));
  const sigmaPath = Math.max(...involved.map((l) => l.sigma));
  const spread = spreadPbps(sigmaPath, wp); // PBPS — full bid-ask spread (drives the visible mid gap)
  const spreadBps = spread / 100;
  // Only a HALF-spread is actually deducted from amountOut (getAnchorPathQuote: feeOut = amount·halfSpread),
  // so the LP/proto split must sum to spreadBps/2 — not the full spread — or the fee reads 2× reality.
  const feeBps = spreadBps / 2;
  const lpFeeBps = feeBps * (1 - wp.protoShare / 100);
  const protoFeeBps = feeBps * (wp.protoShare / 100);

  if (amountIn <= 0 || grossOut <= 0) {
    return { ...zeroQuote(route), midPrice, spreadBps, lpFeeBps, protoFeeBps, maxIn };
  }
  // GATE-07: coverage-wall toll charged on the drained output leg, BEFORE the spread/fee haircut —
  // mirrors Pricing.sol:355 (`acc.currentAmount -= _covToll(...)` precedes the fee-out computation).
  const toll = outLeg ? covToll(outLeg.res, outLeg.liab, outLeg.kappaCovBps, grossOut) : 0;
  const netGross = grossOut - toll;
  const amountOut = netGross * (1 - spread / 2 / PBPS); // half-spread on output (path model)
  const grossAvg = grossOut / amountIn; // pure-curve avg (out-per-in); toll is a discrete charge, not curve slippage
  return {
    amountOut,
    grossOut,
    avgPrice: amountOut / amountIn,
    midPrice,
    priceImpactBps: midPrice > 0 ? Math.abs(grossAvg / midPrice - 1) * 1e4 : 0,
    spreadBps,
    lpFeeBps,
    protoFeeBps,
    covTollBps: (toll / grossOut) * 1e4,
    maxIn,
    route,
  };
}

// Token capacity of the bid (sell) side: min(depth exhaustion, base-reserve drain). Monotone
// cumBase(t) ⇒ bisect for the reserve clip.
function capBidTok(k: LegKit, leg: PoolLeg): number {
  const depthEdge = (k.center / BPS) * k.depth;
  const limit = leg.baseRes * 0.999;
  const cumBase = (t: number) => t * bandPrice(k, k.center, k.center - (t * BPS) / k.depth);
  if (cumBase(depthEdge) <= limit) return depthEdge;
  let lo = 0;
  let hi = depthEdge;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (cumBase(mid) < limit) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Base capacity of the ask (buy) side: base needed to reach the token reserve clip / depth edge.
function capAskBase(k: LegKit, leg: PoolLeg): number {
  const depthEdgeTok = ((BPS - k.center) / BPS) * k.depth;
  const maxTok = Math.min(depthEdgeTok, leg.res * 0.999);
  const d = k.center + (maxTok / k.depth) * BPS;
  return maxTok * bandPrice(k, k.center, Math.min(d, BPS)); // base ≈ tok · avg fill
}

// ── depthCurve ──────────────────────────────────────────────────────────────────

/**
 * Depth-axis sample grid from `center` toward `edge`: always includes the skewed mid (`center`),
 * spline knots, the band edge, plus uniform steps so the polyline follows the AIMM offset curve
 * (piecewise-linear today; Hermite-ready when evalSpline ports Spline.sol). Never samples around
 * the raw mark depth (5000) — the virtual book is centered on inventory-skewed mid.
 */
function depthBandSamples(center: number, edge: number, knotXs: number[], step = 250): number[] {
  const lo = Math.min(center, edge);
  const hi = Math.max(center, edge);
  const xs = new Set<number>([center, edge]);
  for (const x of knotXs) {
    if (x > lo + 1e-9 && x < hi - 1e-9) xs.add(x);
  }
  for (let d = lo + step; d < hi - 1e-9; d += step) xs.add(d);
  const sorted = [...xs].sort((a, b) => a - b);
  // Ask side walks center→edge ascending; bid side center→edge descending.
  return edge >= center ? sorted : sorted.reverse();
}

/**
 * The Binance-style book (x = price, y = cumulative size outward from mid). Direct pair = analytic
 * polyline through the spline (depth-axis traversal via priceAt / bandPrice); cross pair = numeric
 * sweep of quoteExactIn (marginal = local slope). Cumulative base under the curve at size S ==
 * quoteExactIn(S).grossOut by construction — the acceptance invariant (spec §2).
 */
export function depthCurve(
  state: PoolState,
  from: string,
  to: string,
  opts?: { unit?: 'token' | 'base' },
): DepthCurve {
  const unit = opts?.unit ?? 'base';
  const base = state.base;

  // Cross (neither side is base) — numeric composition.
  if (from !== base && to !== base) return crossCurve(state, from, to, unit);

  const leg = state.legs[from === base ? to : from]; // exactly one side is base here
  if (!leg) return emptyCurve(unit);
  const k = legKit(leg);
  const spread = spreadPbps(leg.sigma, leg.profile);
  const half = spread / 2;
  const knotXs = k.pts.map((p) => p[0]);

  // Caps = remaining FILLABLE liquidity (spline band ∩ physical reserves).
  // Ask drains spoke R; bid drains hub baseRes — both must clip the printed ladder.
  const maxTokAsk = Math.min(((BPS - k.center) / BPS) * k.depth, leg.res * 0.999);
  const maxTokBid = capBidTok(k, leg);

  // ASK (buy token): d from skewed center→10000; size = tokens received along the band.
  const asksRaw: DepthLevel[] = dedup(depthBandSamples(k.center, BPS, knotXs)).map((d) => {
    const est = ((d - k.center) / BPS) * k.depth; // notional token = band size
    const baseIn = est * k.mid; // one-step fixed point uses mid to size the band (aimm.rs:346)
    const exec = bandPrice(k, k.center, d);
    return {
      price: priceAt(k.twap, k.pts, d),
      cumTok: exec > 0 ? baseIn / exec : 0,
      cumBase: baseIn,
    };
  });

  // BID (sell token): d from skewed center→0.
  const bidsRaw: DepthLevel[] = dedup(depthBandSamples(k.center, 0, knotXs)).map((d) => {
    const t = ((k.center - d) / BPS) * k.depth;
    const exec = bandPrice(k, k.center, d);
    return { price: priceAt(k.twap, k.pts, d), cumTok: t, cumBase: t * exec };
  });

  return {
    mark: k.twap,
    mid: k.mid,
    bidBest: k.mid * (1 - half / PBPS),
    askBest: k.mid * (1 + half / PBPS),
    spreadBps: spread / 100,
    bids: clipDepthLevels(bidsRaw, maxTokBid),
    asks: clipDepthLevels(asksRaw, maxTokAsk),
    maxTokBid,
    maxTokAsk,
    unit,
  };
}

/**
 * Virtual market depth for a hub-spoke pair — the UI-facing API over `depthCurve`.
 *
 * Reads remaining fillable liquidity on BOTH sides of the spoke's bonding curve:
 * - **Bids** (sell `token` → hub): spline bid band ∩ hub `baseRes` (`capBidTok`)
 * - **Asks** (buy `token` ← hub): spline ask band ∩ spoke `res`
 *
 * Prices are always hub-per-token. Every cumulative size S satisfies
 * `quoteExactIn(…, S).grossOut` under the ladder (spec D3) — no fabricated depth.
 */
export function virtualMarketDepth(state: PoolState, token: string): DepthCurve {
  if (token === state.base) return emptyCurve('base');
  if (!state.legs[token]) return emptyCurve('base');
  return depthCurve(state, state.base, token);
}

/** Keep levels with cumTok ≤ maxTok; append an interpolated terminal vertex at exactly maxTok. */
function clipDepthLevels(levels: DepthLevel[], maxTok: number): DepthLevel[] {
  if (!(maxTok > 0) || levels.length === 0) return [];
  const out: DepthLevel[] = [];
  for (const l of levels) {
    if (l.cumTok <= maxTok + 1e-15) {
      out.push(l); // keep the mid vertex (cumTok=0) — required for ladder integrals
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.cumTok < maxTok - 1e-15) {
      const span = l.cumTok - prev.cumTok;
      const t = span > 0 ? (maxTok - prev.cumTok) / span : 1;
      out.push({
        price: prev.price + t * (l.price - prev.price),
        cumTok: maxTok,
        cumBase: prev.cumBase + t * (l.cumBase - prev.cumBase),
      });
    } else if (!prev) {
      const scale = l.cumTok > 0 ? maxTok / l.cumTok : 0;
      out.push({ price: l.price, cumTok: maxTok, cumBase: l.cumBase * scale });
    }
    break;
  }
  return out;
}

function crossCurve(
  state: PoolState,
  from: string,
  to: string,
  unit: 'token' | 'base',
): DepthCurve {
  const legIn = state.legs[from];
  const legOut = state.legs[to];
  if (!legIn || !legOut) return emptyCurve(unit);
  const q0 = quoteExactIn(state, from, to, 0);
  const mid = q0.midPrice; // out-per-in
  const spread = q0.spreadBps * 100; // back to PBPS
  const half = spread / 2;
  const N = 24;
  // token=`to` (received/sold), base=`from` (spent/received) → x is from-per-to (base-per-token).
  const askMax = capBidTok(legKit(legIn), legIn); // from-token capacity
  const bidMax = capBidTok(legKit(legOut), legOut); // to-token capacity
  const asks = sweep(N, askMax, (s) => {
    const q = quoteExactIn(state, from, to, s); // spend s `from`, receive grossOut `to`
    return { cumTok: q.grossOut, cumBase: s };
  });
  const bids = sweep(N, bidMax, (s) => {
    const q = quoteExactIn(state, to, from, s); // sell s `to`, receive grossOut `from`
    return { cumTok: s, cumBase: q.grossOut };
  });
  const midX = mid > 0 ? 1 / mid : 0; // from-per-to
  // Oracle mark in the same orientation (from-per-to): twap_to / twap_from.
  const markX = legIn.twap > 0 ? legOut.twap / legIn.twap : 0;
  return {
    mark: markX,
    mid: midX,
    bidBest: midX * (1 - half / PBPS),
    askBest: midX * (1 + half / PBPS),
    spreadBps: spread / 100,
    bids: withMarginal(bids, midX, false),
    asks: withMarginal(asks, midX, true),
    maxTokBid: bidMax,
    maxTokAsk: askMax,
    unit,
  };
}

// Geometric grid dense near the origin; each node carries its cumulative (cumTok, cumBase).
function sweep(
  n: number,
  max: number,
  at: (s: number) => { cumTok: number; cumBase: number },
): DepthLevel[] {
  const out: DepthLevel[] = [];
  for (let i = 1; i <= n; i++) {
    const s = max * (i / n) ** 2;
    const c = at(s);
    if (c.cumTok > 0 && c.cumBase > 0) out.push({ price: 0, cumTok: c.cumTok, cumBase: c.cumBase });
  }
  return out;
}

// Marginal (local slope of base-per-token) between successive swept nodes; ascending asks / descending bids.
function withMarginal(levels: DepthLevel[], mid: number, ascending: boolean): DepthLevel[] {
  const out = levels.map((l, i) => {
    const prev = i === 0 ? { cumTok: 0, cumBase: 0 } : levels[i - 1];
    const dT = l.cumTok - prev.cumTok;
    const dB = l.cumBase - prev.cumBase;
    return { ...l, price: dT > 0 ? dB / dT : mid };
  });
  return ascending ? out : out.slice().reverse();
}

function dedup(xs: number[]): number[] {
  return xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 1e-9);
}

function emptyCurve(unit: 'token' | 'base'): DepthCurve {
  return {
    mark: 0,
    mid: 0,
    bidBest: 0,
    askBest: 0,
    spreadBps: 0,
    bids: [],
    asks: [],
    maxTokBid: 0,
    maxTokAsk: 0,
    unit,
  };
}
