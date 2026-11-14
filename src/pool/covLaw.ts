/**
 * Coverage toll v3: bigint mirror of dex-evm `CovLib` (tools/covlaw.py is the integer reference;
 * `covLaw.test.ts` replays test/proto/cov_vectors.json bit for bit). Rational U-barrier plus an
 * optional knee on the negative side, charge-only potential. All values are bigint, `/` floors,
 * `cdiv` is ceil. WAD = 1e18, BPS = 1e4. Pro-pool rounding at every site (see IMPL.md).
 * The pack/unpack codec lives in `cov.ts`.
 */
import { kappaBps } from './cov.js';

const WAD = 10n ** 18n;
const BPS = 10_000n;
const cdiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// ---- law -------------------------------------------------------------------------------------

interface Side {
  pole: bigint;
  span: bigint;
  kb: bigint;
}

/** `(bk, kb2)`: the knee's distance from c_min (WAD) and κ₂ bps; (0, 0) = no knee. */
function kneeOf(b: bigint, kneeBits: bigint): [bigint, bigint] {
  const kb2 = BigInt(kappaBps(Number((kneeBits >> 6n) & 63n)));
  if (kb2 === 0n) return [0n, 0n];
  return [((kneeBits & 63n) * 2n - (b & 63n) * 2n) * 10n ** 16n, kb2];
}

function side(b: bigint, neg: boolean, kNeg: bigint): Side {
  const cMin = (b & 63n) * 2n * 10n ** 16n;
  const t = WAD + ((b >> 6n) & 63n) * 5n * 10n ** 14n;
  if (neg) return { pole: cMin, span: t - cMin, kb: kNeg };
  const pole = 105n * 10n ** 16n + ((b >> 15n) & 31n) * 5n * 10n ** 16n;
  return {
    pole,
    span: pole - t - ((b >> 12n) & 7n) * 5n * 10n ** 16n,
    kb: BigInt(kappaBps(Number(b >> 26n))),
  };
}

function phi(kb: bigint, span: bigint, kb2: bigint, bk: bigint, y: bigint, up: boolean): bigint {
  if (y >= span) return 0n;
  const n = kb * (span - y) ** 2n + (y < bk ? kb2 * (bk - y) ** 2n : 0n);
  const d = BPS * y;
  return up ? cdiv(n, d) : n / d;
}

/** Post-state distance from the pole, rounded toward the mover's side; `wall` at/over the pole. */
function y1(pole: bigint, neg: boolean, r1: bigint, l1: bigint): { y: bigint; wall: boolean } {
  const x = r1 * WAD;
  if (neg ? x <= pole * l1 : x >= pole * l1) return { y: 0n, wall: true };
  const y = neg ? x / l1 - pole : pole - cdiv(x, l1);
  return { y: y === 0n ? 1n : y, wall: false };
}

interface CovBook {
  /** `Asset.covBits`. */
  covBits: bigint;
  /** `Asset.kneeBits` (0 when the leg has no knee). */
  kneeBits: bigint;
  /** Live κ⁻ (the leg's, or a class row's override), bps. */
  kNeg: bigint;
}

/** `CovLib.toll`: (toll, wall) of the move (r0,l0) -> (r1,l1), in the leg's own units. */
export function covToll(
  b: bigint,
  kneeBits: bigint,
  kNeg: bigint,
  r0: bigint,
  l0: bigint,
  r1: bigint,
  l1: bigint,
): [bigint, boolean] {
  const a = r1 * l0;
  const c = r0 * l1;
  if (l0 === 0n || a === c) return [0n, false];
  const neg = a < c;
  const { pole, span, kb } = side(b, neg, kNeg);
  const [bk, kb2] = neg ? kneeOf(b, kneeBits) : [0n, 0n];
  const { y, wall } = y1(pole, neg, r1, l1);
  if (wall) return [0n, true];
  const y0 = neg ? cdiv(r0 * WAD, l0) - pole : pole - (r0 * WAD) / l0;
  const p0 = phi(kb, span, kb2, bk, y0, false);
  const p1 = phi(kb, span, kb2, bk, y, true);
  return [p1 > p0 ? cdiv(l1 * (p1 - p0), WAD) : 0n, false];
}

/** `CovLib.debitToll`: the Φ⁺ toll of debiting `face` from a leg's claims at constant reserves (a
 *  cross exit's or liability swap's from-leg), scaled to the payout `out = face·C·rate`:
 *  `min(cdiv(cdiv(t·out, face)·WAD, C), out)`. A wall saturates to `out`. Requires `face ≤ l`. */
export function covDebitToll(
  b: bigint,
  r: bigint,
  l: bigint,
  face: bigint,
  out: bigint,
  cWad: bigint,
): bigint {
  const [t, wall] = covToll(b, 0n, 0n, r, l, r, l - face);
  if (wall) return out;
  if (t === 0n) return 0n;
  const d = cdiv(cdiv(t * out, face) * WAD, cWad);
  return d < out ? d : out;
}

/** `CovLib.walls`: does the move end on/over a pole? */
export function covWalls(b: bigint, r0: bigint, l0: bigint, r1: bigint, l1: bigint): boolean {
  const a = r1 * l0;
  const c = r0 * l1;
  if (a === c) return false;
  const { pole } = side(b, a < c, 0n);
  return y1(pole, a < c, r1, l1).wall;
}

/** Distance from the pole where the marginal toll reaches 1, rounded up (WAD). */
function star(span: bigint, kb: bigint, kb2: bigint, bk: bigint): bigint {
  let q = cdiv(kb * span * span, BPS + kb);
  if (kb2 !== 0n && q <= (bk - 1n) ** 2n) {
    q = cdiv(kb * span * span + kb2 * bk * bk, BPS + kb + kb2);
  }
  const y = isqrt(q);
  return y * y < q ? y + 1n : y;
}

/** `CovLib.cap`: the largest amount a swap leg may move (out: paid out; in: taken in). */
export function covCap(
  b: bigint,
  kneeBits: bigint,
  neg: boolean,
  kNeg: bigint,
  r0: bigint,
  l: bigint,
): bigint {
  if (l === 0n) return neg ? r0 : 0n;
  const { pole, span, kb } = side(b, neg, kNeg);
  const [bk, kb2] = neg ? kneeOf(b, kneeBits) : [0n, 0n];
  const y = star(span, kb, kb2, bk);
  if (neg) {
    const v = r0 - cdiv(l * (pole + y), WAD);
    return v > 0n ? v : 0n;
  }
  const v = (l * (pole - y) - 1n) / WAD - r0;
  return v > 0n ? v : 0n;
}

/** `CovLib._legToll` (internal; what `swapToll` sums): a swap leg's toll; `null` = refused past the cap. */
export function covLegToll(
  b: bigint,
  kneeBits: bigint,
  neg: boolean,
  kNeg: bigint,
  r: bigint,
  l: bigint,
  amount: bigint,
): bigint | null {
  if (amount > covCap(b, kneeBits, neg, kNeg, r, l)) return null;
  if (l === 0n) return 0n;
  return covToll(b, kneeBits, kNeg, r, l, neg ? r - amount : r + amount, l)[0];
}

/** `CovLib.swapToll`: the whole swap's toll in OUT units, capped at `gross`; `null` = a leg refused. */
export function covSwapToll(
  out: CovBook & { r: bigint; l: bigint },
  gross: bigint,
  inn: { covBits: bigint; r: bigint; l: bigint },
  amountIn: bigint,
): bigint | null {
  let t = covLegToll(out.covBits, out.kneeBits, true, out.kNeg, out.r, out.l, gross);
  if (t === null) return null;
  if (amountIn > 0n) {
    const ti = covLegToll(inn.covBits, 0n, false, 0n, inn.r, inn.l, amountIn);
    if (ti === null) return null;
    t += cdiv(ti * gross, amountIn);
  }
  return t < gross ? t : gross;
}
