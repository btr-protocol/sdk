// Pure BTR AIMM pricer: the ONE model shared by useSwapQuote (the form) and the
// depth chart, so a quote and its rendered book can never disagree (spec D3).
//
// Mirrors the on-chain pricing libraries. The pricing shape is a
// clamped quartic I-spline on non-uniform knots (NUQuartic.Curve, shared preset table keyed by
// Asset.presetId). evalQ/areaQ/buildCurve below are EXACT BigInt mirrors of the Solidity integer
// math (truncating division included) so front depth charts match on-chain quotes bit-for-bit at
// the curve level. Amount/price plumbing around them stays f64 (UI floats).
//
// SEAMS (the only deferrals): σ (sigmaSeed → live feed.sigmaPbps on deploy), reserves/L
// (usePoolData stub → on-chain), and each leg's kappaCovBps (defaults 0 = off, matching the
// current testnet risk config; wire
// per-asset RiskConfig.kappaCovBps via Pool once a risk-config view fn exists on-chain). Everything
// else is built fully, including the convex coverage-wall toll (GATE-07; Pricing.sol `_covToll`).

import { STALE_Z } from '../abis/solidity.generated.js';

export const BPS = 1e4; // 0.01%
export const PBPS = 1e6; // 0.0001% (fee/offset/dispersion unit)

// ── NUQuartic mirror ────────────────────────────────────────────────────────────
// Curve y(x): x ∈ [0, BPS] cumulative-depth bps, y in pbps·Q fixed point (Q = 1e9).
// Quotes scale y by dispersion/dispRef (Pricing._scaleY), then drop the Q fixed point.

const P = 10n ** 18n; // NUQuartic.P
const QI = 1_000_000_000n; // NUQuartic.Q (pbps fixed point)
const DI = 1_000_000n; // NUQuartic.D (derivative-pyramid scale)
/** Hard segment cap: 14×uint16 boundaries is all the on-chain header holds. */
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

/** y(x) in pbps·Q: exact integer mirror of NUQuartic.evalQ (BigInt `/` truncates like Solidity). */
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

// ── Curve builder (admin/fixture path): exact mirror of NUQuartic.set ──────────

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

/** q_i = 4·(w[i+1]−w[i])·D/(t[i+5]−t[i+1]): first-derivative ctrl (NUQuartic._q). */
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
 * Validate + convert a clamped quartic B-spline to the packed power basis: exact TS mirror of
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

  // NUQuartic._centre: the write-path transform, applied AFTER validation exactly as `set` does.
  // Clamped endpoints ⇒ y(0)=wQ[0], y(BPS)=wQ[n−1], so one subtraction pins y(0)+y(BPS) == span&1
  // (β ≡ −1/2). BigInt `>>` is an arithmetic (FLOOR) shift, matching `sar`, NOT truncate-toward-zero:
  // truncating makes the residual sign-dependent and `rangeQ`'s re-derivation rejects odd spans.
  // Shape-preserving and idempotent, so the fitted density is untouched. Never mutates the caller's
  // array; Solidity centres its own memory copy.
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
    // exact full-segment integral: h·(60c0+30c1+20c2+15c3+12c4)/60
    S +=
      (BigInt(t[j + 5] - t[j + 4]) *
        (60n * k[0] + 30n * k[1] + 20n * k[2] + 15n * k[3] + 12n * k[4])) /
      60n;
  }
  return { m, boundaries, dispRef, flags, segs };
}

// ── Dispersion admissibility (the on-chain write-path rules) ───────────────────
// A profile is only DEPLOYABLE if `PoolConfig.sanitizeDispersion` accepts its band against the
// preset's `Pricing.dispersionCap`. Mirroring both here is what lets an off-chain config (or a
// test fixture) be rejected before it reaches a reverting `setProfile`.

/** Pricing.INTERIOR_SWING_CAP_PBPS: the interior mid swing the fence can bound (fail-closed). */
export const INTERIOR_SWING_CAP_PBPS = 10_000;
/** `PoolConstantsLib.MAX_DISPERSION_PBPS`: the band CEILING, a protocol constant. It is not a
 *  per-asset field: `Asset.maxDispersion` is deleted on chain (dex e2e87a7), because how wide a leg
 *  may quote is a property of the shared preset it quotes on, not of the leg. Only the floor
 *  (`minDispersion`) is configurable. */
export const MAX_DISPERSION_PBPS = 900_000;

/** y(BPS) − y(0) in pbps·Q: NUQuartic.rangeQ's span (exact at both clamped ends). */
export const curveSpanQ = (c: QuarticCurve): bigint => evalQ(c, BPS) - evalQ(c, 0);

/** `Pricing.dispersionCap`: floor(SWING_CAP·dispRef·Q / span). A property of the preset, not the
 *  asset: the widest dispersion whose interior mid swing still fits the fence. FLOORED, never
 *  ceiled: cap must be the largest dispersion the read still quotes, and cap+1 must not be. */
export function dispersionCap(c: QuarticCurve): number {
  const span = curveSpanQ(c);
  if (span <= 0n) throw new Error('flat curve has no dispersion cap');
  const cap = (BigInt(INTERIOR_SWING_CAP_PBPS) * BigInt(c.dispRef) * QI) / span;
  return Number(cap > 4294967295n ? 4294967295n : cap);
}

/** `PoolConfig.sanitizeDispersion`: 0 → protocol default (1000), then the floor is CHECKED against
 *  the preset's `cap` and the protocol ceiling, never clamped to either, because narrowing it
 *  silently would move the leg's quiet-tape quote instead of reporting a fit that does not fit.
 *  Throws exactly where the chain reverts `BadConfig`. */
export function sanitizeDispersion(minDispersion: number, cap: number): number {
  const mn = minDispersion === 0 ? 1000 : minDispersion;
  if (mn > cap || mn > MAX_DISPERSION_PBPS) throw new Error('BadConfig: dispersion floor');
  return mn;
}

// ── Profile / pool-state types ──────────────────────────────────────────────────

export interface AimmProfile {
  vega: number; // volatility sensitivity, BPS
  minFee: number; // PBPS (1 = 0.01 bp floor; 100 = 1 bp)
  minDisp: number; // PBPS: the QUIET-TAPE FLOOR. The ceiling is MAX_DISPERSION_PBPS, protocol-wide.
  protoShare: number; // % of spread routed to protocol (fee split)
  /** Pricing-shape preset (Asset.presetId → PoolStorage.curves). REQUIRED: there is ONE pricing law
   *  (`Pricing._traverseCurveByVolume`) and `PoolConfig.validatePresetAssign` will not list an asset
   *  without a curve, so a null here is a read that has not landed; fail closed at the caller
   *  rather than quote a second, nonexistent law. */
  curve: QuarticCurve;
}

/** One spoke edge vs the base numeraire. */
export interface PoolLeg {
  token: string;
  twap: number; // NX mark, base-per-token
  sigma: number; // sigma from feed, PBPS-scaled (1e4 = 1%)
  res: number; // R: token reserves
  liab: number; // L: token liabilities (c = R/L)
  baseRes: number; // base (USDC) backing available to pay a sell
  decimals: number;
  profile: AimmProfile;
  // Convex coverage-wall strength (0 = off). IPool.RiskConfig.kappaCovBps (Pricing.sol),
  // output-only: fires when this token leaves the pool. The hub book is `PoolState.hub`.
  kappaCovBps: number;
  /** Feed 1σ CI in BPS (ExternalOracle.confidence). Widens path spread. */
  confidence?: number;
  /** Seconds past ttl/2 (Pricing staleExcess). Widens path spread. */
  staleExcess?: number;
}

/** Depth-1 star: `base` is the hub numeraire (no spoke leg); spokes keyed by symbol.
 *  `hub` is the base's own book so a DIRECT SELL (token→base) can toll when the hub carries κ. */
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
  amountOut: number; // net of the path spread AND the coverage-wall toll
  grossOut: number; // pre-toll, pre-fee (curve area)
  avgPrice: number; // trader-effective tokenOut-per-tokenIn
  midPrice: number; // skewed size-0 tokenOut-per-tokenIn
  /** Oracle mark in the same out-per-in units as midPrice / avgPrice. */
  markPrice: number;
  /** Inventory mid premium: (mid / mark − 1) in bps, out-per-in orientation. */
  midPremiumBps: number;
  /**
   * Executed rate vs mark (incl. impact, spread, toll): (avg / mark − 1) in bps, SAME
   * out-per-in orientation as midPremiumBps. Reciprocating one and not the other is what
   * flipped the displayed sign the moment a size was typed. Zero when size-0 (no fill).
   */
  netPremiumBps: number;
  priceImpactBps: number; // pure-curve movement vs skewed mid
  spreadBps: number;
  lpFeeBps: number;
  protoFeeBps: number;
  covTollBps: number; // coverage-wall charge (GATE-07), as bps of grossOut; 0 when κ=0 or draining toward peg
  maxIn: number; // input that saturates the binding reserve clip
  route: string[];
}

/** A ladder vertex before the fee/toll haircut: the pure skew-implied curve. */
interface GrossLevel {
  price: number; // marginal SKEW-implied (pre-fee, pre-toll) base-per-token at this vertex
  cumTok: number; // cumulative token size outward from mid
  cumBase: number; // cumulative base notional outward from mid
}

export interface DepthLevel extends GrossLevel {
  /**
   * Marginal EXECUTABLE base-per-token: `price` after the output haircut (half-spread + coverage
   * toll) at this vertex's own size. The book prints `price` (market data); the cost is this minus
   * `price`, disclosed separately and never folded into the printed rung.
   */
  netPrice: number;
}

export interface DepthCurve {
  /** Oracle mark (NX TWAP), base-per-token: inventory-independent. */
  mark: number;
  /** Skewed size-0 mid = mark + inventory premium, base-per-token. Book is centered here. */
  mid: number;
  spreadBps: number;
  bids: DepthLevel[]; // price descending (sell token), outward from mid
  asks: DepthLevel[]; // price ascending (buy token), outward from mid
  maxTokBid: number;
  maxTokAsk: number;
  unit: 'token' | 'base';
}

/**
 * THE premium: (price / mark − 1) in bps, both arguments in the SAME orientation.
 * Callers orient to display (quote-per-base, the chart axis) first, where positive reads
 * "the pool is expensive vs the oracle". There is no reciprocal variant.
 */
export function premiumBps(price: number, mark: number): number {
  return mark > 0 ? ((price - mark) / mark) * 1e4 : 0;
}

/** Hub-relative spoke inventory premium (mid vs TWAP mark). Hub / missing leg ⇒ 0. */
export function spokePremiumBps(leg: PoolLeg | undefined | null): number {
  if (!leg || !(leg.twap > 0)) return 0;
  return premiumBps(legKit(leg).mid, leg.twap);
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ── Primitives (exported for tests): each mirrors the cited Pricing.sol fn ─────

// Pricing.sol constants mirrored by the float quote path.
const SPLINE_MIN_OFFSET_PBPS = -0.9 * PBPS;

/** Floored offset → price on every price path (Pricing._flooredOffsetPrice): clamp the offset at
 *  SPLINE_MIN_OFFSET_PBPS, then scale onto the mark. That single floor is the whole law: the
 *  second `MIN_EXEC_PRICE_BPS` floor this mirrored is deleted on chain, and while it never bound
 *  (−90% of PBPS already pins price ≥ 10% of mark, above the old 5%) it was a live divergence
 *  waiting on any change to either constant. */
function flooredOffsetPrice(mark: number, offsetPbps: number): number {
  const off = Math.max(offsetPbps, SPLINE_MIN_OFFSET_PBPS);
  return (mark * Math.max(PBPS + off, 0)) / PBPS;
}

/** Inventory skew ∈ [-100, 100] from a leg's coverage (Pricing.computeInventorySkew).
 *  A FIXED law, no per-asset dial: the coverage bounds are hardwired at c ≤ 1/2 → +100 and c ≥ 2 →
 *  -100, and the ramps between are ASYMMETRIC: slope 200 under the peg, 100 over it, because the
 *  under-covered side must reach the clamp in half the distance. `Asset.gamma` and
 *  `RiskConfig.coverageMin/Max`, which used to parameterize this, are deleted on chain. */
export function computeSkew(res: number, liab: number): number {
  if (liab <= 0) return -100;
  const c = res / liab;
  if (c <= 0.5) return 100;
  if (c >= 2) return -100;
  // Chain returns int8 from a uint256 integer division: truncate before signing, never after.
  // `|| 0` normalizes the -0 that negating a truncated-to-zero fill arm produces; int8 has no -0.
  return c < 1 ? Math.trunc(200 * (1 - c)) : -Math.trunc(100 * (c - 1)) || 0;
}

/** Dispersion κ in PBPS. Quiet floor = minDisp; σ·vega widens above it, up to the PROTOCOL ceiling
 *  `MAX_DISPERSION_PBPS` (Pricing `_calculateDispersion`); there is no per-asset ceiling.
 *  vega=10000 ⇒ dispersion tracks σ 1:1. (2026-08-21: dropped the historic σ/1000 damping that
 *  pinned dispersion at the floor: books never widened with vol.) */
export function dispersion(sigma: number, p: AimmProfile): number {
  return clamp(p.minDisp + (sigma * p.vega) / BPS, p.minDisp, MAX_DISPERSION_PBPS);
}

const U16_MAX = 65535;
const U32_MAX = 4294967295;

/** Floor integer sqrt: Solady `FixedPointMathLib.sqrt`, which the chain uses in both `_pathSpread`
 *  (σ quadrature) and `_staleTerm`. IEEE sqrt lands within 1 of the true floor, so one BigInt
 *  correction step makes it exact for any integer `n` the caller can represent. */
function isqrt(n: number): number {
  if (!(n > 0)) return 0;
  const bn = BigInt(Math.floor(n));
  let x = Math.floor(Math.sqrt(n));
  while (BigInt(x) * BigInt(x) > bn) x--;
  while (BigInt(x + 1) * BigInt(x + 1) <= bn) x++;
  return x;
}

/** Per-leg risk the path composition reduces over (Pricing.sol `LegResult`). */
export interface LegRisk {
  sigma: number; // uint32, PBPS-scaled (1e4 = 1%)
  minFee: number; // PBPS
  confidence?: number; // feed 1σ CI, BPS
  staleExcess?: number; // seconds past the keeper grace
}

/** One leg's staleness premium in PBPS = STALE_Z·σ·√excess/BPS (Pricing.sol `_staleTerm`), on that
 *  leg's OWN age and σ. BigInt: the product overruns 2^53 at the uint32 ceilings, and the chain
 *  never rounds. `√` is Solady's floor sqrt, one floored division at the end. */
function staleTerm(staleExcess: number, sigma: number): number {
  const e = Math.floor(staleExcess);
  if (e <= 0 || sigma <= 0) return 0; // inside the keeper grace: the chain skips the sqrt too
  return Number((BigInt(STALE_Z) * BigInt(sigma) * BigInt(isqrt(e))) / BigInt(BPS));
}

/**
 * Full path spread (fee) in PBPS: mirrors `Pricing._walkLegs` + `_pathSpread` (dex ba76f55,
 * 7aa3a54, 2270594). Risk COMPOSES over legs, it is never a `max`: crossing two legs crosses two
 * per-leg 2θ fences, so minFee, confidence and the staleness premium SUM, and σ adds in QUADRATURE
 * (√Σσ², independent leg innovations, one floor-sqrt at the end). A `max` reduction under-fenced
 * every multi-leg path and paid a cross-spoke round trip the difference.
 *
 * The staleness premium is summed PER LEG off that leg's own age and σ, never `_staleTerm(max age,
 * σ_path)`: one keeper feeds both spokes, so an outage staleses them together and the coupled form
 * quoted √2/2 = 70.7% of what two equal legs each owe.
 *
 * THERE IS NO FEE CEILING (Pricing.sol `_pathSpread`, dex f6c26e0): `Asset.maxFeePbps` and the
 * per-leg `_legCap` that bounded the path by it are deleted. A ceiling is not trader protection:
 * `minAmountOut` is, and it capped the pool's own defense exactly where it is needed (a stale or
 * high-CI leg), on an attacker-TIMEABLE clamp. The only bound left is the uint16 saturation of
 * `SwapQuote.spreadPbps` below, which is a field width, not a policy.
 *
 * `vega` is a PATH CONSTANT the caller reduces: it stays `max(vega_in, vega_out)` over the two
 * ENDPOINTS (a pool per-asset σ-sensitivity dial, not a per-leg risk quantity). Every term floors
 * SEPARATELY because the chain computes each in integer arithmetic.
 */
export function pathSpread(legs: LegRisk[], vega: number): number {
  let sigmaSq = 0;
  let minFeePath = 0;
  let confPath = 0;
  let staleTermPath = 0;
  for (const l of legs) {
    const s = Math.floor(l.sigma); // uint32 on chain: floor before squaring
    sigmaSq += s * s;
    minFeePath += l.minFee;
    confPath += l.confidence ?? 0;
    staleTermPath += staleTerm(l.staleExcess ?? 0, s);
  }
  // √(Σσ²) can exceed uint32 for N ≥ 2 near the type ceiling; the chain clamps rather than wraps.
  const sigmaPath = Math.min(isqrt(sigmaSq), U32_MAX);
  const sVol = minFeePath + Math.floor((sigmaPath * vega) / (100 * BPS));
  const raw = sVol + staleTermPath + confPath * (PBPS / BPS); // bps → PBPS (PBPS/BPS = 100)
  // SATURATE into the uint16 `SwapQuote.spreadPbps`: the chain's only remaining bound. What
  // saturates away is a risk PREMIUM, never the interior fence (composed fence ≤ 60306 < 65535).
  return Math.min(raw, U16_MAX);
}

/** Single-leg spread: `pathSpread` over the one leg, where every sum is that leg's own value.
 *  Direct (base-to-spoke) quotes and the depth chart. */
export function spreadPbps(
  sigma: number,
  p: AimmProfile,
  opts?: { confidence?: number; staleExcess?: number },
): number {
  return pathSpread([{ sigma, minFee: p.minFee, ...opts }], p.vega);
}

/** Coverage potential Q(c) = ln c − c + 1: ≤0, max 0 at c=1, convex wall diverging as c→0.
 *  (Pricing.sol `_covQ`; floored defensively: the real fail-closed lnWad(0) revert only fires
 *  on an on-chain integer-precision edge that `grossOut >= res` already short-circuits below.) */
export function covQ(c: number): number {
  const cc = Math.max(c, 1e-9);
  return Math.log(cc) - cc + 1;
}

/**
 * Convex coverage-wall toll (GATE-07) on the drained OUTPUT leg: 1:1 port of Pricing.sol
 * `_covToll` (charge-only, peg-clamped; NOT the older rebate-ledger variant in aimm-sim, which the
 * shipped contract never carried). Charges κ·L·(Q(c0)−Q(c1)) in output-token units: 0 when κ=0 or the
 * leg has no liabilities; `grossOut` when the drain would fully exhaust reserves (wall blocks the
 * whole fill); else the toll, clamped ≤ grossOut. Both coverages are clamped to the peg (min(c,1))
 * before differencing: Q peaks at c=1 and falls on BOTH sides, so an unclamped diff would let a drain
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
  curve: QuarticCurve;
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
  const skew = computeSkew(leg.res, leg.liab);
  const center = 5000 + skew * 50; // Pricing._skewToDepth
  // Impact denominator is the leg's own reserves, never amplified (Pricing._quoteSell); the zero
  // guard mirrors the chain's `reserves == 0 ? 1 : reserves`, which keeps the traverse divisor > 0.
  const depth = leg.res > 0 ? leg.res : 1;
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
 * Marginal base-per-token at depth-coord d = flooredOffsetPrice(scaleY(evalQ(d))): the exact
 * width-0 branch of `Pricing._traverseCurve`. ONE law, no fallback arm.
 */
export function priceAt(k: LegKit, d: number): number {
  return flooredOffsetPrice(k.twap, scaleY(evalQ(k.curve, d), k.curve, k.dispersion));
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
 * On-chain pricing shape as a LIQUIDITY DENSITY over price-offset space: mass of book depth per
 * bp of offset from mark = inverse slope Δx/Δy of the monotone I-spline offset curve y(x),
 * unit-area normalized. Offsets are computed in float straight from the pbps·Q fixed point, NOT
 * via scaleY: its integer-pbps truncation zeroes Δy on near-flat segments → density = Inf.
 * Near-flat steps (Δy ≤ ε·span) are merged into the next advancing step; each emitted point sits
 * at the merged step's offset midpoint. Returns [offsetBp, densityPerBp] pairs, offsets ascending.
 */
export function curveDensity(
  curve: QuarticCurve,
  dispersionPbps: number,
  n = 120,
): [number, number][] {
  const k = dispersionPbps / (curve.dispRef * 1e9 * 100); // pbps·Q → bp
  const yAt = (x: number): number => Number(evalQ(curve, x)) * k;
  const eps = Math.max(Math.abs(yAt(BPS) - yAt(0)), 1e-12) * 1e-9;
  const pts: [number, number][] = [];
  let x0 = 0;
  let y0 = yAt(0);
  for (let i = 1; i <= n; i++) {
    const x1 = (BPS * i) / n;
    const y1 = yAt(x1);
    if (y1 - y0 <= eps) continue; // flat step: merge forward instead of emitting a density spike
    pts.push([(y0 + y1) / 2, (x1 - x0) / (y1 - y0)]);
    x0 = x1;
    y0 = y1;
  }
  // ∫density dy = Σ emitted Δx = x0 (covered span) → divide out for unit area.
  if (x0 > 0) for (const p of pts) p[1] /= x0;
  return pts;
}

/**
 * Density of a two-leg cross. A cross trade crosses BOTH legs, so its offsets are the sum of the
 * per-leg offsets and the cross density is their convolution: support adds, exactly as crossCurve's
 * band does. Drawing one leg's profile against a cross book understates breadth by the other leg's
 * support (RLUSD/DAI: 1.78 vs 1.78+11.18 bp). Same [offsetBp, densityPerBp] contract as
 * curveDensity, offsets ascending, unit area.
 */
export function crossDensity(
  a: [number, number][],
  b: [number, number][],
  n = 120,
): [number, number][] {
  if (!a.length || !b.length) return a.length ? a : b;
  const lo = a[0][0] + b[0][0];
  const h = (a[a.length - 1][0] + b[b.length - 1][0] - lo) / n;
  if (!(h > 0)) return a;
  // Resample onto the shared step, linear between the leg's own (non-uniform) nodes.
  const grid = (p: [number, number][]): number[] => {
    const m = Math.max(1, Math.round((p[p.length - 1][0] - p[0][0]) / h) + 1);
    const out = new Array<number>(m);
    let j = 0;
    for (let i = 0; i < m; i++) {
      const x = p[0][0] + i * h;
      while (j < p.length - 2 && p[j + 1][0] < x) j++;
      const [x0, y0] = p[j];
      const [x1, y1] = p[Math.min(j + 1, p.length - 1)];
      out[i] = y0 + (x1 > x0 ? ((x - x0) / (x1 - x0)) * (y1 - y0) : 0);
    }
    return out;
  };
  const ga = grid(a);
  const gb = grid(b);
  const out: [number, number][] = [];
  for (let k = 0; k < ga.length + gb.length - 1; k++) {
    let s = 0;
    for (let i = Math.max(0, k - gb.length + 1), e = Math.min(k, ga.length - 1); i <= e; i++) {
      s += ga[i] * gb[k - i];
    }
    out.push([lo + k * h, s * h]);
  }
  const area = out.reduce((t, p) => t + p[1], 0) * h;
  if (area > 0) for (const p of out) p[1] /= area;
  return out;
}

/**
 * Average base-per-token over the ordered depth band [a,b]: the VWAP the trade fills at.
 * Mirrors Pricing._traverseCurve: areaQ(lo,hi)/width → scaleY → floor SPLINE_MIN_OFFSET_PBPS
 * → mark scale.
 */
function bandPrice(k: LegKit, a: number, b: number): number {
  const lo = xInt(Math.min(a, b));
  const hi = xInt(Math.max(a, b));
  const w = hi - lo;
  if (w === 0) return flooredOffsetPrice(k.twap, scaleY(evalQ(k.curve, a), k.curve, k.dispersion));
  // On-chain order: areaQ / width (integer), THEN scaleY; mirrored exactly.
  return flooredOffsetPrice(
    k.twap,
    scaleY(areaQ(k.curve, lo, hi) / BigInt(w), k.curve, k.dispersion),
  );
}

/** Average fill price over a traded volume by walking the curve (Pricing._traverseCurveByVolume). */
function traverse(k: LegKit, amountInTok: number, selling: boolean): number {
  const vf = Math.min((amountInTok * BPS) / k.depth, BPS);
  const end = selling ? Math.max(k.center - vf, 0) : Math.min(k.center + vf, BPS);
  return bandPrice(k, k.center, end);
}

// The only two path-level profile scalars. The fee terms are NOT here: they compose per leg inside
// `pathSpread` (Pricing._walkLegs). `vega` is an ENDPOINT max, a path constant `_pathSpread` reads
// off `acc.vega` (a pool per-asset σ dial, not a per-leg risk quantity); `protoShare` is pool-level
// ($.feeParams.protoShare, equal across a pool's legs) and reduces unchanged.
function pathProfile(profiles: AimmProfile[]): { vega: number; protoShare: number } {
  return {
    vega: Math.max(...profiles.map((p) => p.vega)),
    protoShare: Math.max(...profiles.map((p) => p.protoShare)),
  };
}

const zeroQuote = (route: string[]): Quote => ({
  amountOut: 0,
  grossOut: 0,
  avgPrice: 0,
  midPrice: 0,
  markPrice: 0,
  midPremiumBps: 0,
  netPremiumBps: 0,
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
  let markPrice = 0;
  let involved: PoolLeg[] = [];
  let route: string[];
  let maxIn = 0;
  // The book whose reserves the trade actually DRAINS (the output side): GATE-07.
  // DIRECT SELL (output=base) uses `state.hub` when present; κ=0 or missing hub ⇒ toll 0.
  let outLeg: PoolLeg | undefined;
  let hubOut: HubBook | undefined;

  if (!inBase && outBase) {
    // DIRECT SELL: token → base.
    const leg = state.legs[tokenIn];
    if (!leg) return zeroQuote([tokenIn, tokenOut]);
    const k = legKit(leg);
    midPrice = k.mid; // base-per-token = out(base)-per-in(token)
    markPrice = leg.twap;
    involved = [leg];
    route = [tokenIn, tokenOut];
    maxIn = capBidTok(k, leg); // token capacity before base drains / depth exhausts
    hubOut = state.hub;
    if (amountIn > 0) grossOut = Math.min(amountIn * traverse(k, amountIn, true), leg.baseRes);
  } else if (inBase && !outBase) {
    // DIRECT BUY: base → token (one-step fixed point: replicate, don't solve).
    const leg = state.legs[tokenOut];
    if (!leg) return zeroQuote([tokenIn, tokenOut]);
    const k = legKit(leg);
    midPrice = 1 / k.mid; // token-per-base
    markPrice = leg.twap > 0 ? 1 / leg.twap : 0;
    involved = [leg];
    outLeg = leg;
    route = [tokenIn, tokenOut];
    maxIn = capAskBase(k, leg); // base capacity
    if (amountIn > 0) {
      const exec = traverse(k, amountIn / k.mid, false);
      grossOut = Math.min(amountIn / exec, leg.res);
    }
  } else if (!inBase && !outBase) {
    // CROSS: sell tokenIn→base, buy tokenOut with that base (fixed point on the buy leg).
    const legIn = state.legs[tokenIn];
    const legOut = state.legs[tokenOut];
    if (!legIn || !legOut) return zeroQuote([tokenIn, base, tokenOut]);
    const kIn = legKit(legIn);
    const kOut = legKit(legOut);
    midPrice = kIn.mid / kOut.mid; // (base/in)/(base/out) = out-per-in
    markPrice = legIn.twap > 0 && legOut.twap > 0 ? legIn.twap / legOut.twap : 0;
    involved = [legIn, legOut];
    outLeg = legOut;
    route = [tokenIn, base, tokenOut];
    // ONE wall, the buy leg's token reserve: `_legScaleOut` clips the delivering leg only, so the
    // hub balance never bounds a cross (Pricing.sol:806-809). The sell leg still contributes its
    // own depth exhaustion, hence `Infinity` rather than dropping the term. This value is
    // `Quote.maxIn` -> rankSwap order-splitting, so it sizes real routes, not just a chart.
    maxIn = Math.min(capBidTok(kIn, legIn, Infinity), capAskBase(kOut, legOut) / kIn.mid);
    if (amountIn > 0) {
      const baseMid = amountIn * traverse(kIn, amountIn, true);
      const exec = traverse(kOut, baseMid / kOut.mid, false);
      grossOut = Math.min(baseMid / exec, legOut.res);
    }
  } else {
    return zeroQuote([tokenIn, tokenOut]); // base→base
  }

  // Risk composes over the walked LEGS (the base is never a leg): Pricing._walkLegs. A cross
  // walks two legs, a direct walks one; `pathSpread` owns the composition.
  const wp = pathProfile(involved.map((l) => l.profile));
  const spread = pathSpread(
    involved.map((l) => ({
      sigma: l.sigma,
      minFee: l.profile.minFee,
      confidence: l.confidence,
      staleExcess: l.staleExcess,
    })),
    wp.vega,
  );
  const spreadBps = spread / 100;
  // Only a HALF-spread is actually deducted from amountOut (getAnchorPathQuote: feeOut = amount·halfSpread),
  // so the LP/proto split must sum to spreadBps/2, not the full spread, or the fee reads 2× reality.
  const feeBps = spreadBps / 2;
  const lpFeeBps = feeBps * (1 - wp.protoShare / 100);
  const protoFeeBps = feeBps * (wp.protoShare / 100);

  const midPrem = premiumBps(midPrice, markPrice);
  if (amountIn <= 0 || grossOut <= 0) {
    return {
      ...zeroQuote(route),
      midPrice,
      markPrice,
      midPremiumBps: midPrem,
      spreadBps,
      lpFeeBps,
      protoFeeBps,
      maxIn,
    };
  }
  // GATE-07: coverage-wall toll charged on the drained output leg, BEFORE the spread/fee haircut:
  // mirrors Pricing.sol (`acc.currentAmount -= _covToll(...)` precedes the fee-out computation).
  const toll = outLeg
    ? covToll(outLeg.res, outLeg.liab, outLeg.kappaCovBps, grossOut)
    : hubOut
      ? covToll(hubOut.res, hubOut.liab, hubOut.kappaCovBps, grossOut)
      : 0;
  const netGross = grossOut - toll;
  const amountOut = netGross * (1 - spread / 2 / PBPS); // half-spread on output (path model)
  const avgPrice = amountOut / amountIn;
  const grossAvg = grossOut / amountIn; // pure-curve avg (out-per-in); toll is a discrete charge, not curve slippage
  return {
    amountOut,
    grossOut,
    avgPrice,
    midPrice,
    markPrice,
    midPremiumBps: midPrem,
    netPremiumBps: premiumBps(avgPrice, markPrice),
    priceImpactBps: midPrice > 0 ? Math.abs(grossAvg / midPrice - 1) * 1e4 : 0,
    spreadBps,
    lpFeeBps,
    protoFeeBps,
    covTollBps: (toll / grossOut) * 1e4,
    maxIn,
    route,
  };
}

// Token capacity of the bid (sell) side: min(depth exhaustion, `limit`). Monotone cumBase(t) ⇒
// bisect for the reserve clip.
//
// `limit` is the DELIVERING leg's balance, and only the delivering leg is clipped on chain
// (`_legScaleOut` returns early unless `delivering`, Pricing.sol:806-809). On a direct sell the
// base delivers, so its reserve binds and the default is right. On a CROSS the base delivers
// nothing: spoke→base→spoke settles spokeIn against spokeOut and never touches the hub balance
// (PoolIOLib.sol:138-147; pinned by `hub reserves never move on a 2-leg swap`,
// AuditPatchRegressions.t.sol:1588). Cross callers therefore pass `Infinity`: passing `baseRes`
// there mirrors a contract bug that was fixed on chain and collapses every cross in a pool whose
// hub is drained.
function capBidTok(k: LegKit, leg: PoolLeg, limit = leg.baseRes): number {
  const depthEdge = (k.center / BPS) * k.depth;
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
// The clip is exact (`_legScaleOut`, Pricing.sol:561-562). When κ>0 the LAST unit of that capacity
// is unfillable: grossOut == res trips `_covToll`'s full-block branch and the swap reverts ZeroValue.
// So this is the chain's clip, not the largest PROFITABLE fill; routers must treat it as an
// exclusive bound.
function capAskBase(k: LegKit, leg: PoolLeg): number {
  const depthEdgeTok = ((BPS - k.center) / BPS) * k.depth;
  const maxTok = Math.min(depthEdgeTok, leg.res);
  const d = k.center + (maxTok / k.depth) * BPS;
  return maxTok * bandPrice(k, k.center, Math.min(d, BPS)); // base ≈ tok · avg fill
}

// ── depthCurve ──────────────────────────────────────────────────────────────────

/**
 * Depth-axis sample grid from `center` toward `edge`: always includes the skewed mid (`center`),
 * curve segment boundaries, the band edge, plus uniform steps so the polyline follows the AIMM
 * offset curve (quartic I-spline via evalQ). Never samples around the raw mark depth (5000):
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
 * Output-side haircut at cumulative gross output `g`: (1 − toll/g)·(1 − half-spread), i.e. the
 * factor turning `Quote.grossOut` into `Quote.amountOut`. `g == 0` takes the marginal toll limit
 * κ/BPS·(1/c − 1) (Q'(c) = 1/c − 1), which is the touch. 0 ⇒ `_covToll` blocks the whole fill.
 */
function netOutMul(leg: PoolLeg | undefined, g: number, half: number): number {
  const fee = 1 - half / PBPS;
  if (!leg || leg.kappaCovBps <= 0 || leg.liab <= 0) return fee;
  if (g > 0) return fee * (1 - covToll(leg.res, leg.liab, leg.kappaCovBps, g) / g);
  const c = leg.res / leg.liab;
  return c >= 1 ? fee : Math.max(0, fee * (1 - (leg.kappaCovBps / BPS) * (1 / c - 1)));
}

/**
 * Annotate a skew-implied ladder with the executable price at each rung. The rung KEEPS its
 * skew price and gross size: the fee and the coverage toll are a cost, not a price, and folding
 * them in renders a fee as market data (a WBTC/WETH touch of ±45 bp that is all minFee and oracle
 * confidence, against a few bp of real skew). `netPrice` carries the cost so the UI can disclose
 * it separately and so the OEV band still prices a crossing at what it actually fills.
 * Ask drains the out leg (tolled); a bid into the hub base can never carry κ (`PoolConfig` rejects it
 * at the risk-config write), so a sell is toll-free by construction. Rungs the coverage wall blocks are dropped:
 * `amountOut` is 0 from there out, so the chain refuses them.
 */
function annotateNet(
  levels: GrossLevel[],
  outLeg: PoolLeg | undefined,
  half: number,
  side: 'bid' | 'ask',
): DepthLevel[] {
  const out: DepthLevel[] = [];
  for (const l of levels) {
    const m = netOutMul(outLeg, side === 'ask' ? l.cumTok : l.cumBase, half);
    if (!(m > 0)) break; // coverage wall blocks the whole fill from here out
    // A proportional haircut on the OUTPUT is a quotient in price space on the buy side and a
    // product on the sell side: paying for m·q tokens costs price/m each, receiving m·b base earns
    // price·m. The two are asymmetric by O(h²) even with no toll at all.
    out.push({ ...l, netPrice: side === 'ask' ? l.price / m : l.price * m });
  }
  return out;
}

/**
 * The Binance-style book (x = price, y = cumulative size outward from mid). Direct pair = analytic
 * polyline through the quartic curve (depth-axis traversal via priceAt / bandPrice); cross pair =
 * numeric sweep of quoteExactIn (marginal = local slope). Prices and sizes are the SKEW-implied
 * (pre-fee, pre-toll) curve: every vertex satisfies quoteExactIn(cumBase).grossOut == cumTok: the
 * acceptance invariant (spec §2). `netPrice` on each rung carries the cost the rung excludes.
 */
export function depthCurve(
  state: PoolState,
  from: string,
  to: string,
  opts?: { unit?: 'token' | 'base' },
): DepthCurve {
  const unit = opts?.unit ?? 'base';
  const base = state.base;

  // Cross (neither side is base): numeric composition.
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
  // Ask drains spoke R; bid drains hub baseRes; both must clip the printed ladder.
  const capAskTok = Math.min(((BPS - k.center) / BPS) * k.depth, leg.res);
  const maxTokBid = capBidTok(k, leg);

  // ASK (buy token): d from skewed center→10000; size = tokens received along the band.
  const asksRaw: GrossLevel[] = dedup(depthBandSamples(k.center, BPS, knotXs)).map((d) => {
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
  const bidsRaw: GrossLevel[] = dedup(depthBandSamples(k.center, 0, knotXs)).map((d) => {
    const t = ((k.center - d) / BPS) * k.depth;
    const exec = bandPrice(k, k.center, d);
    return { price: priceAt(k, d), cumTok: t, cumBase: t * exec };
  });

  const asks = annotateNet(clipDepthLevels(asksRaw, capAskTok), leg, half, 'ask');
  const bids = annotateNet(clipDepthLevels(bidsRaw, maxTokBid), undefined, half, 'bid');
  return {
    mark: k.twap,
    mid: k.mid,
    spreadBps: spread / 100,
    bids,
    asks,
    maxTokBid, // token input capacity: the bid pays in tokens, which no haircut touches
    maxTokAsk: asks[asks.length - 1]?.cumTok ?? 0, // exact reserve clip, coverage cliff excluded
    unit,
  };
}

/**
 * Virtual market depth for a hub-spoke pair: the UI-facing API over `depthCurve`.
 *
 * Reads remaining fillable liquidity on BOTH sides of the spoke's bonding curve:
 * - **Bids** (sell `token` → hub): curve bid band ∩ hub `baseRes` (`capBidTok`)
 * - **Asks** (buy `token` ← hub): curve ask band ∩ spoke `res`
 *
 * Prices are always hub-per-token and SKEW-implied (pre-fee, pre-toll): every cumulative size S
 * satisfies `quoteExactIn(…, S).grossOut` under the ladder (spec D3): no fabricated depth.
 */
export function virtualMarketDepth(state: PoolState, token: string): DepthCurve {
  if (token === state.base) return emptyCurve('base');
  if (!state.legs[token]) return emptyCurve('base');
  return depthCurve(state, state.base, token);
}

/**
 * Reciprocal orientation of a depth curve (token↔base roles swap): price→1/price, bids↔asks,
 * and cumTok↔cumBase (a bid's base notional IS the inverted ask's token size: exact, not scaled).
 * Mid-outward ordering survives: ask price ascending → 1/price descending = a valid bid ladder.
 */
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

/** Keep levels with cumTok ≤ maxTok; append an interpolated terminal vertex at exactly maxTok. */
function clipDepthLevels(levels: GrossLevel[], maxTok: number): GrossLevel[] {
  if (!(maxTok > 0) || levels.length === 0) return [];
  const out: GrossLevel[] = [];
  for (const l of levels) {
    if (l.cumTok <= maxTok + 1e-15) {
      out.push(l); // keep the mid vertex (cumTok=0): required for ladder integrals
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
  const N = 24;
  // token=`to` (received/sold), base=`from` (spent/received) → x is from-per-to (base-per-token).
  // Each cross side hits the sell leg's own depth exhaustion and the BUY leg's token reserve:
  // `_legScaleOut` clips the delivering leg only, so the hub balance is not a wall here
  // (Pricing.sol:806-809) and `capBidTok` takes `Infinity` for its clip. Buy-leg capacity is
  // base-denominated, so divide by the sell leg's mid to reach input units. Capping on the sell
  // leg alone (both sides used the buy leg's reserve nowhere) advertised sizes the chain refuses
  // outright; `_covToll` then blocks the whole fill.
  const kIn = legKit(legIn);
  const kOut = legKit(legOut);
  const askMax = Math.min(capBidTok(kIn, legIn, Infinity), capAskBase(kOut, legOut) / kIn.mid); // from-token
  const bidMax = Math.min(capBidTok(kOut, legOut, Infinity), capAskBase(kIn, legIn) / kOut.mid); // to-token
  // `grossOut` is the skew-implied leg: pure curve impact plus the exact reserve clip, with the
  // toll and the half-spread applied strictly after it. It is what the book prints. `amountOut`
  // is what fills, and is the ONLY valid cliff test: `_covToll` returns the whole `grossOut`
  // well inside the reserve, so a gross sweep stays positive over rungs the chain refuses.
  const asks = sweep(N, askMax, (s) => {
    const q = quoteExactIn(state, from, to, s); // spend s `from`, receive `to`
    return { cumTok: q.grossOut, cumBase: s, net: q.amountOut, fills: q.amountOut > 0 };
  });
  const bids = sweep(N, bidMax, (s) => {
    const q = quoteExactIn(state, to, from, s); // sell s `to`, receive `from`
    return { cumTok: s, cumBase: q.grossOut, net: q.amountOut, fills: q.amountOut > 0 };
  });
  const midX = mid > 0 ? 1 / mid : 0; // from-per-to
  // Oracle mark in the same orientation (from-per-to): twap_to / twap_from.
  const markX = legIn.twap > 0 ? legOut.twap / legIn.twap : 0;
  // Touch cost, q→0: a buy drains `to`, a sell drains `from`, and each pays its own leg's toll.
  const half = spread / 2;
  const askRows = withMarginal(asks, midX, midX / netOutMul(legOut, 0, half), 'ask');
  const bidRows = withMarginal(bids, midX, midX * netOutMul(legIn, 0, half), 'bid');
  return {
    mark: markX,
    mid: midX,
    spreadBps: spread / 100,
    bids: bidRows,
    asks: askRows,
    // Derived, not the raw caps: the sweep stops at the coverage cliff, and advertising past it
    // sizes routes the chain reverts on.
    maxTokBid: bidRows[bidRows.length - 1]?.cumTok ?? 0,
    maxTokAsk: askRows[askRows.length - 1]?.cumTok ?? 0,
    unit,
  };
}

/** A swept node: the gross (printed) cumulative pair and the net (fillable) one. */
interface SweptNode {
  cumTok: number;
  cumBase: number;
  net: number;
  fills: boolean;
}

// Geometric grid dense near the origin. Breaks at the coverage cliff, which only the NET output
// can see: `_covToll` swallows the whole fill well inside the reserve, so `grossOut` stays
// positive over sizes the chain reverts on.
function sweep(n: number, max: number, at: (s: number) => SweptNode): SweptNode[] {
  const out: SweptNode[] = [];
  for (let i = 1; i <= n; i++) {
    const s = max * (i / n) ** 2;
    const c = at(s);
    if (!c.fills || !(c.cumTok > 0) || !(c.cumBase > 0)) break;
    out.push(c);
  }
  return out;
}

/**
 * Swept cumulatives → ladder rungs, marginal (local slope of base-per-token) between successive
 * nodes. Rung 0 is pinned to the zero-volume skew anchor so a cross book has the same touch
 * definition as a direct one: without it the first rung is an AVERAGE over `max/576`, i.e. a
 * function of the sample grid and of pool capacity rather than of price.
 * Order stays mid-outward (cumTok ascending) for BOTH sides, matching the hub-spoke path;
 * depthLevelsToRows/aggregate read cum as monotonically rising.
 */
function withMarginal(
  nodes: SweptNode[],
  mid: number,
  netMid: number,
  side: 'bid' | 'ask',
): DepthLevel[] {
  // `netOutMul` returns EXACTLY 0 once the marginal coverage toll reaches 1 (c <= κ/(κ+BPS)), so
  // the caller's `mid / mul` is Infinity and its `mid * mul` is 0. Either way the wall refuses the
  // whole fill at size 0: the side has no executable price and must be EMPTY, exactly as the
  // hub-spoke path already does (`annotateNet` breaks on the same test). Publishing the degenerate
  // number instead put a non-finite price on the ladder, and `aggregate`'s ask loop walks from
  // Infinity with a break test that is NaN, i.e. forever.
  if (!(netMid > 0) || !isFinite(netMid)) return [];
  const zero: DepthLevel = { price: mid, netPrice: netMid, cumTok: 0, cumBase: 0 };
  const out: DepthLevel[] = [zero];
  for (let i = 0; i < nodes.length; i++) {
    const l = nodes[i];
    const prev = i === 0 ? { cumTok: 0, cumBase: 0, net: 0 } : nodes[i - 1];
    const dT = l.cumTok - prev.cumTok;
    const dB = l.cumBase - prev.cumBase;
    // Ask spends base for tokens, so the haircut lands on cumTok; a bid receives base, so it
    // lands on cumBase. `net` is whichever of the two the fill actually delivers.
    const dNetT = side === 'ask' ? l.net - prev.net : dT;
    const dNetB = side === 'ask' ? dB : l.net - prev.net;
    out.push({
      price: dT > 0 ? dB / dT : mid,
      netPrice: dNetT > 0 ? dNetB / dNetT : netMid,
      cumTok: l.cumTok,
      cumBase: l.cumBase,
    });
  }
  return out;
}

function dedup(xs: number[]): number[] {
  return xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 1e-9);
}

function emptyCurve(unit: 'token' | 'base'): DepthCurve {
  return {
    mark: 0,
    mid: 0,
    spreadBps: 0,
    bids: [],
    asks: [],
    maxTokBid: 0,
    maxTokAsk: 0,
    unit,
  };
}
