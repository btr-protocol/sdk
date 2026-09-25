/**
 * f64 UI helpers ONLY (rounding, stats, axis ticks, display precision).
 * Canonical pricing law lives in `core/src/fixed.rs` + `core/src/pricing.rs`
 * (served via backend `btr-quote`); never add fixed-point/quote math here.
 */

// ─────────────────────────────────────────────────────────────
// Array Statistics
// ─────────────────────────────────────────────────────────────

export function minmax(data: number[]): [min: number, max: number] {
  if (data.length === 0) return [0, 0];
  let min = data[0];
  let max = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  return [min, max];
}

export function min(data: number[]): number {
  if (data.length === 0) return 0;
  let result = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] < result) result = data[i];
  }
  return result;
}

export function max(data: number[]): number {
  if (data.length === 0) return 0;
  let result = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i] > result) result = data[i];
  }
  return result;
}

export function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, v) => a + v, 0) / arr.length;
}

export function sum(arr: number[]): number {
  return arr.reduce((a, v) => a + v, 0);
}

// ─────────────────────────────────────────────────────────────
// Rounding Functions
// ─────────────────────────────────────────────────────────────

export function round(n: number | undefined | null, scale = 5): number {
  if (n == null || !Number.isFinite(n)) return 0;
  const multiplier = 10 ** scale;
  return Math.round((n + Number.EPSILON) * multiplier) / multiplier;
}

export function ceil(n: number, scale: number): number {
  const multiplier = 10 ** scale;
  return Math.ceil((n + Number.EPSILON) * multiplier) / multiplier;
}

export function floor(n: number, scale: number): number {
  const multiplier = 10 ** scale;
  return Math.floor((n + Number.EPSILON) * multiplier) / multiplier;
}

/**
 * Determine appropriate decimal precision based on number magnitude
 * Larger numbers need fewer decimals, smaller numbers need more
 */
export function precision(n: number): number {
  if (n === 0) return 2;
  const absN = Math.abs(n);

  // For very large numbers, use fewer decimals
  if (absN >= 1_000_000) return 0;
  if (absN >= 100_000) return 1;
  if (absN >= 10_000) return 1;
  if (absN >= 1_000) return 2;
  if (absN >= 100) return 2;
  if (absN >= 10) return 3;
  if (absN >= 1) return 4;

  // For small numbers, count leading zeros and add precision
  const leadingZeros = Math.floor(-Math.log10(absN));
  return Math.min(leadingZeros + 4, 12); // Cap at 12 decimal places
}

// ─────────────────────────────────────────────────────────────
// Clamp and Range Functions
// ─────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
}

// ─────────────────────────────────────────────────────────────
// Bigint slippage floors
// ─────────────────────────────────────────────────────────────

const SLIP_SCALE = 1_000_000n; // 1e-6 granularity: finer than any venue's fee tick

/** Haircut integer units by `slip` in BIGINT space. Doing `amountOut * (1 - slip)` in float
 *  first loses precision on large amounts before the value is widened. Rounds DOWN. */
export const applySlip = (units: bigint, slip: number): bigint =>
  (units * (SLIP_SCALE - BigInt(Math.round(slip * Number(SLIP_SCALE))))) / SLIP_SCALE;
