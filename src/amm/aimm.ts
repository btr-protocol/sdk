// Pure BTR AIMM pricer — the ONE model shared by useSwapQuote (the form) and the
// depth chart, so a quote and its rendered book can never disagree (spec D3).
//
// Mirrors the on-chain dex/evm/src/libraries/{Pricing,NUQuartic}.sol. The pricing shape is a
// clamped quartic I-spline on non-uniform knots (NUQuartic.Curve, shared preset table keyed by
// Asset.presetId). evalQ/areaQ/buildCurve below are EXACT BigInt mirrors of the Solidity integer
// math (truncating division included) so front depth charts match on-chain quotes bit-for-bit at
// the curve level. Amount/price plumbing around them stays f64 (UI floats).
//
// SEAMS (the only deferrals): σ (sigmaSeed → live feed.sigma on deploy), reserves/L
// (usePoolData stub → on-chain), and each leg's kappaCovBps (defaults 0 = off, matching the
// current testnet risk config — dex/evm/deploy/testnet-asset-params.json sharedRiskConfig; wire
// per-asset RiskConfig.kappaCovBps via Pool once a risk-config view fn exists on-chain). Everything
// else is built fully, including the convex coverage-wall toll (GATE-07; Pricing.sol `_covToll`).

export const BPS = 1e4; // 0.01%
export const PBPS = 1e6; // 0.0001% (fee/offset/dispersion unit)

// ── NUQuartic mirror (dex/evm/src/libraries/NUQuartic.sol) ──────────────────────
// Curve y(x): x ∈ [0, BPS] cumulative-depth bps, y in pbps·Q fixed point (Q = 1e9).
// Quotes scale y by dispersion/dispRef (Pricing._scaleY), then drop the Q fixed point.

const P = 10n ** 18n; // NUQuartic.P
const QI = 1_000_000_000n; // NUQuartic.Q (pbps fixed point)
const DI = 1_000_000n; // NUQuartic.D (derivative-pyramid scale)
/** Hard segment cap — 14×uint16 boundaries is all the on-chain header holds. */
export const MAX_SEGS = 14;
/** flags bit0: preset only valid on coverage-walled assets (NUQuartic.FLAG_REQUIRES_WALL). */
export const CURVE_FLAG_REQUIRES_WALL = 1;

/** One packed power-basis segment: y(u) = c0 + u(c1 + u(c2 + u(c3 + u·c4))), u ∈ [0,1]·1e18.
 *  `S` = exact prefix integral ∫y dx from 0 to the segment's left edge (pbps·Q·x units). */
export interface QuarticSeg {
  c0: bigint;
  c1: bigint;
  c2: bigint;
  c3: bigint;
  c4: bigint;
  S: bigint;
}

/** Decoded NUQuartic.Curve (header + segs). Same directory semantics as the packed header. */
export interface QuarticCurve {
  /** Segment count m ≤ MAX_SEGS. */
  m: number;
  /** Right edges b_1..b_m (b_m = BPS); segment i covers [b_i, b_{i+1}) with b_0 = 0. */
  boundaries: number[];
  /** Reference dispersion (pbps) the fit was built at; quotes scale y by disp/dispRef. */
  dispRef: number;
  /** Curve flag bits (CURVE_FLAG_REQUIRES_WALL). */
  flags: number;
  /** Length m. */
  segs: QuarticSeg[];
}

/** Clamp + round a depth coordinate onto the on-chain integer x-domain [0, BPS]. */
const xInt = (x: number): number => (x <= 0 ? 0 : x >= BPS ? BPS : Math.round(x));

/** Segment index + local frame (NUQuartic._frame): linear directory scan, m ≤ 14. */
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

/** y(x) in pbps·Q — exact integer mirror of NUQuartic.evalQ (BigInt `/` truncates like Solidity). */
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

/** Cumulative ∫y dx from 0 to x (NUQuartic._at): prefix S + local quintic primitive. */
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

/** O(1) exact integral over [x1,x2] in pbps·Q·x units (NUQuartic.areaQ). 0 when x1 ≥ x2. */
export function areaQ(c: QuarticCurve, x1: number, x2: number): bigint {
  const a = xInt(x1);
  const b = xInt(x2);
  if (a >= b) return 0n;
  return atQ(c, b) - atQ(c, a);
}

/** Pricing._scaleY: y-scale by dispersion/dispRef, drop the Q fixed point → integer pbps. */
export function scaleY(yQ: bigint, curve: QuarticCurve, dispersionPbps: number): number {
  return Number((yQ * BigInt(Math.round(dispersionPbps))) / (BigInt(curve.dispRef) * QI));
}

// ── Curve builder (admin/fixture path) — exact mirror of NUQuartic.set ──────────

/** de Boor degree 4 at x in span s (NUQuartic._deBoor4). wQ already pbps·Q. */
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

/** q_i = 4·(w[i+1]−w[i])·D/(t[i+5]−t[i+1]) — first-derivative ctrl (NUQuartic._q). */
const qCtrl = (t: number[], wQ: bigint[], i: number): bigint =>
  (4n * (wQ[i + 1] - wQ[i]) * DI) / BigInt(t[i + 5] - t[i + 1]);

/** First derivative: degree-3 de Boor over q (NUQuartic._deBoorD1). */
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

/** Second derivative: r_i = 3·(q[i+1]−q[i])/(t[i+5]−t[i+2]), degree-2 de Boor (NUQuartic._deBoorD2). */
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

/** Power basis on local u∈[0,1] for span s (NUQuartic._segCoeffs). */
function segCoeffs(t: number[], wQ: bigint[], s: number): bigint[] {
  const ih = BigInt(t[s + 1] - t[s]);
  const c0 = deBoor4(t, wQ, s, t[s]);
  const c1 = (deBoorD1(t, wQ, s, t[s]) * ih) / DI;
  const c2 = (deBoorD2(t, wQ, s, t[s]) * ih * ih) / (2n * DI);
  const A = deBoor4(t, wQ, s, t[s + 1]) - c0 - c1 - c2;
  const B = (deBoorD1(t, wQ, s, t[s + 1]) * ih) / DI - c1 - 2n * c2;
  return [c0, c1, c2, 4n * A - B, B - 3n * A];
}

/**
 * Validate + convert a clamped quartic B-spline to the packed power basis — exact TS mirror of
 * NUQuartic.set (same integer truncation), producing the decoded curve `readCurve` would return
 * after an on-chain `setCurve(interior, wQ, dispRef, flags)`.
 * @param interior strictly-increasing integer interior knots in (0, BPS)
 * @param wQ control weights (pbps·Q), length interior.length+5, NONDECREASING
 * @param dispRef reference dispersion (pbps) the fit was built at
 */
export function buildCurve(
  interior: number[],
  wQ: bigint[],
  dispRef: number,
  flags = 0,
): QuarticCurve {
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

  const m = n - 4;
  const boundaries: number[] = [];
  for (let j = 1; j <= m; j++) boundaries.push(t[j + 4]);
  const LIM = (2n ** 64n - 1n) / 2n;
  const I128_MAX = 2n ** 127n - 1n;
  const segs: QuarticSeg[] = [];
  let S = 0n;
  for (let j = 0; j < m; j++) {
    const k = segCoeffs(t, wQ, j + 4);
    for (const v of k) if (v > LIM || v < -LIM) throw new Error('coefficient overflow');
    if (S > I128_MAX || S < -I128_MAX - 1n) throw new Error('prefix-integral overflow');
    segs.push({ c0: k[0], c1: k[1], c2: k[2], c3: k[3], c4: k[4], S });
    // exact full-segment integral: h·(60c0+30c1+20c2+15c3+12c4)/60
    S +=
      (BigInt(t[j + 5] - t[j + 4]) *
        (60n * k[0] + 30n * k[1] + 20n * k[2] + 15n * k[3] + 12n * k[4])) /
      60n;
  }
  return { m, boundaries, dispRef, flags, segs };
}

// ── Profile / pool-state types ──────────────────────────────────────────────────

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
  /** Pricing-shape preset (Asset.presetId → PoolStorage.curves). null = presetId 0 / unset
   *  ⇒ the skew-anchored linear-impact fallback quote (Pricing._traverseCurveByVolume). */
  curve: QuarticCurve | null;
}

/** One spoke edge vs the base numeraire. */
export interface PoolLeg {
  token: string;
  twap: number; // NX mark, base-per-token
  sigma: number; // sigma from feed, PBPS-scaled (1e4 = 1%)
  res: number; // R — token reserves
  liab: number; // L — token liabilities (c = R/L)
  baseRes: number; // base (USDC) backing available to pay a sell
  decimals: number;
  profile: AimmProfile;
  // Convex coverage-wall strength (0 = off). IPool.RiskConfig.kappaCovBps (Pricing.sol) — the
  // BASE numeraire can never carry this (protocol invariant, enforced at addAsset), so it only ever
  // matters on a spoke leg's OUTPUT side (buying the spoke, or a cross trade's second leg).
  kappaCovBps: number;
  /** Feed 1σ CI in BPS (ExternalOracle.confidence). Widens path spread. */
  confidence?: number;
  /** Seconds past ttl/2 (Pricing staleExcess). Widens path spread. */
  staleExcess?: number;
}

/** Depth-1 star: `base` is the hub numeraire (no leg); spokes keyed by symbol. */
export interface PoolState {
  base: string;
  legs: Record<string, PoolLeg>;
}

export interface Quote {
  amountOut: number; // net of the path spread AND the coverage-wall toll
  grossOut: number; // pre-toll, pre-fee (curve area)
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

// ── Primitives (exported for tests) — each mirrors the cited Pricing.sol fn ─────

// Pricing.sol constants mirrored by the float quote path.
const SPLINE_MIN_OFFSET_PBPS = -0.9 * PBPS;
const MIN_EXEC_PRICE_FRAC = 0.05; // MIN_EXEC_PRICE_BPS = 500
const MAX_IMPACT = 2; // 200% (WAD-scaled on-chain)
const MIN_ADJ = 0.001; // WAD/1000

/** Clamp + scale a PBPS price offset onto the mark (Pricing._offsetToPrice). */
function offsetToPrice(mark: number, offsetPbps: number): number {
  return (mark * Math.max(PBPS + offsetPbps, 0)) / PBPS;
}

/** skew → absolute price (no-profile fallback; Pricing._skewToPrice): offset = skew·disp/100. */
function skewToPrice(mark: number, skew: number, disp: number): number {
  return offsetToPrice(mark, (skew * disp) / 100);
}

/** Linear inventory skew ∈ [-100, 100] from a leg's coverage (Pricing.computeInventorySkew). */
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

/** Coverage-amplified effective pricing depth (NOT raw reserves). */
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

/** Dispersion κ in PBPS. Quiet floor = minDisp; σ·vega widens above it. (Pricing `_calculateDispersion`) */
export function dispersion(sigma: number, p: AimmProfile): number {
  return clamp(p.minDisp + (sigma * p.vega) / (1000 * BPS), p.minDisp, p.maxDisp);
}

/** Path/leg spread (fee) in PBPS: S_vol + U_stale + U_conf (Pricing.sol `_pathSpread`). */
export function spreadPbps(
  sigma: number,
  p: AimmProfile,
  opts?: { confidence?: number; staleExcess?: number },
): number {
  const STALE_Z = 100; // Pricing.sol
  const sVol = p.minFee + (sigma * p.vega) / (100 * BPS);
  const excess = opts?.staleExcess ?? 0;
  const uStale = excess > 0 ? (STALE_Z * sigma * Math.sqrt(excess)) / BPS : 0;
  const uConf = (opts?.confidence ?? 0) * (PBPS / BPS); // bps → PBPS
  return clamp(sVol + uStale + uConf, p.minFee, p.maxFee);
}

/** Coverage potential Q(c) = ln c − c + 1: ≤0, max 0 at c=1, convex wall diverging as c→0.
 *  (Pricing.sol `_covQ`; floored defensively — the real fail-closed lnWad(0) revert only fires
 *  on an on-chain integer-precision edge that `grossOut >= res` already short-circuits below.) */
export function covQ(c: number): number {
  const cc = Math.max(c, 1e-9);
  return Math.log(cc) - cc + 1;
}

/**
 * Convex coverage-wall toll (GATE-07) on the drained OUTPUT leg — 1:1 port of Pricing.sol
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

// ── Per-leg derived kit + band traversal ────────────────────────────────────────

interface LegKit {
  leg: PoolLeg;
  twap: number;
  curve: QuarticCurve | null;
  center: number; // skewed book center in depth coords, 5000 + skew·50
  depth: number;
  mid: number; // priceAt(center), base-per-token
  dispersion: number; // current κ in PBPS
  skew: number; // inventory skew ∈ [-100, +100]
}

/** Public kit for UI bonding-curve charts (same math as quoteExactIn / depthCurve). */
export function legKit(leg: PoolLeg): LegKit {
  const p = leg.profile;
  const disp = dispersion(leg.sigma, p);
  const skew = computeSkew(leg.res, leg.liab, p);
  const center = 5000 + skew * 50; // Pricing._skewToDepth
  const depth = calcDepth(leg.res, leg.liab, p);
  const k: LegKit = {
    leg,
    twap: leg.twap,
    curve: p.curve,
    center,
    depth,
    mid: 0,
    dispersion: disp,
    skew,
  };
  k.mid = priceAt(k, center);
  return k;
}

/**
 * Marginal base-per-token at depth-coord d. Curve: offsetToPrice(scaleY(evalQ(d))) — the exact
 * width-0 branch of Pricing._traverseCurve. Fallback (no preset): marginal of the skew-anchored
 * linear-impact model, mid·(1 ± |d−center|/BPS).
 */
export function priceAt(k: LegKit, d: number): number {
  if (k.curve) return offsetToPrice(k.twap, scaleY(evalQ(k.curve, d), k.curve, k.dispersion));
  const mid = skewToPrice(k.twap, k.skew, k.dispersion);
  const vf = Math.min(Math.abs(d - k.center) / BPS, MAX_IMPACT);
  return d <= k.center ? Math.max(mid * (1 - vf), mid * MIN_ADJ) : mid * (1 + vf);
}

/** Sample the quartic bonding curve for charting: depth ∈ [0,10000] → marginal price. */
export function bondingCurveSamples(
  leg: PoolLeg,
  n = 65,
): {
  samples: { depth: number; price: number }[];
  mark: number;
  mid: number;
  rangeLo: number;
  rangeHi: number;
  center: number;
  skew: number;
  dispersion: number;
  spreadPbps: number;
} {
  const k = legKit(leg);
  const samples: { depth: number; price: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const depth = (BPS * i) / n;
    samples.push({ depth, price: priceAt(k, depth) });
  }
  return {
    samples,
    mark: k.twap,
    mid: k.mid,
    rangeLo: priceAt(k, 0),
    rangeHi: priceAt(k, BPS),
    center: k.center,
    skew: k.skew,
    dispersion: k.dispersion,
    spreadPbps: spreadPbps(leg.sigma, leg.profile, {
      confidence: leg.confidence,
      staleExcess: leg.staleExcess,
    }),
  };
}

/**
 * Average base-per-token over the ordered depth band [a,b] — the VWAP the trade fills at.
 * Mirrors Pricing._traverseCurve: areaQ(lo,hi)/width → scaleY → floor SPLINE_MIN_OFFSET_PBPS
 * → mark scale → MIN_EXEC_PRICE floor. Fallback: linear-impact average mid·(1 ± vf/2).
 */
function bandPrice(k: LegKit, a: number, b: number): number {
  if (!k.curve) {
    const mid = skewToPrice(k.twap, k.skew, k.dispersion);
    const impact = Math.min(Math.abs(b - a) / BPS, MAX_IMPACT);
    const half = impact / 2;
    return b <= a ? Math.max(mid * (1 - half), mid * MIN_ADJ) : mid * (1 + half);
  }
  const lo = xInt(Math.min(a, b));
  const hi = xInt(Math.max(a, b));
  const w = hi - lo;
  if (w === 0) return offsetToPrice(k.twap, scaleY(evalQ(k.curve, a), k.curve, k.dispersion));
  // On-chain order: areaQ / width (integer), THEN scaleY — mirrored exactly.
  let off = scaleY(areaQ(k.curve, lo, hi) / BigInt(w), k.curve, k.dispersion);
  off = Math.max(off, SPLINE_MIN_OFFSET_PBPS);
  return Math.max((k.twap * (PBPS + off)) / PBPS, k.twap * MIN_EXEC_PRICE_FRAC);
}

/** Average fill price over a traded volume by walking the curve (Pricing._traverseCurveByVolume). */
function traverse(k: LegKit, amountInTok: number, selling: boolean): number {
  if (!k.curve) {
    const impact = Math.min(amountInTok / k.depth, MAX_IMPACT);
    const mid = skewToPrice(k.twap, k.skew, k.dispersion);
    const half = impact / 2;
    return selling ? Math.max(mid * (1 - half), mid * MIN_ADJ) : mid * (1 + half);
  }
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
 * the base) = one curve walk; cross = spoke→base→spoke composed. Path-fee model (spec D4):
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
    // DIRECT BUY: base → token (one-step fixed point — replicate, don't solve).
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
  const confPath = Math.max(0, ...involved.map((l) => l.confidence ?? 0));
  const stalePath = Math.max(0, ...involved.map((l) => l.staleExcess ?? 0));
  const spread = spreadPbps(sigmaPath, wp, { confidence: confPath, staleExcess: stalePath });
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
  // mirrors Pricing.sol (`acc.currentAmount -= _covToll(...)` precedes the fee-out computation).
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
 * curve segment boundaries, the band edge, plus uniform steps so the polyline follows the AIMM
 * offset curve (quartic I-spline via evalQ). Never samples around the raw mark depth (5000) —
 * the virtual book is centered on inventory-skewed mid.
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
 * polyline through the quartic curve (depth-axis traversal via priceAt / bandPrice); cross pair =
 * numeric sweep of quoteExactIn (marginal = local slope). Cumulative base under the curve at size S
 * == quoteExactIn(S).grossOut by construction — the acceptance invariant (spec §2).
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
  const spread = spreadPbps(leg.sigma, leg.profile, {
    confidence: leg.confidence,
    staleExcess: leg.staleExcess,
  });
  const half = spread / 2;
  // Segment boundaries anchor the sample grid (the C2 density bends there, smoothly).
  const knotXs = k.curve ? [0, ...k.curve.boundaries] : [];

  // Caps = remaining FILLABLE liquidity (curve band ∩ physical reserves).
  // Ask drains spoke R; bid drains hub baseRes — both must clip the printed ladder.
  const maxTokAsk = Math.min(((BPS - k.center) / BPS) * k.depth, leg.res * 0.999);
  const maxTokBid = capBidTok(k, leg);

  // ASK (buy token): d from skewed center→10000; size = tokens received along the band.
  const asksRaw: DepthLevel[] = dedup(depthBandSamples(k.center, BPS, knotXs)).map((d) => {
    const est = ((d - k.center) / BPS) * k.depth; // notional token = band size
    const baseIn = est * k.mid; // one-step fixed point uses mid to size the band
    const exec = bandPrice(k, k.center, d);
    return {
      price: priceAt(k, d),
      cumTok: exec > 0 ? baseIn / exec : 0,
      cumBase: baseIn,
    };
  });

  // BID (sell token): d from skewed center→0.
  const bidsRaw: DepthLevel[] = dedup(depthBandSamples(k.center, 0, knotXs)).map((d) => {
    const t = ((k.center - d) / BPS) * k.depth;
    const exec = bandPrice(k, k.center, d);
    return { price: priceAt(k, d), cumTok: t, cumBase: t * exec };
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
 * - **Bids** (sell `token` → hub): curve bid band ∩ hub `baseRes` (`capBidTok`)
 * - **Asks** (buy `token` ← hub): curve ask band ∩ spoke `res`
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
