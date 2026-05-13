/**
 * Synthetic symbol paths — single source of truth for inverted + triangulated pairs.
 *
 * Path semantics: synth = Π leg_i^{exp_i}, where exp_i ∈ {+1, -1}.
 *   exp=+1 → multiply by leg's price
 *   exp=-1 → divide by leg's price (also swap bid↔ask)
 *
 * Used by:
 *   - back/services/collector cross-engine (live in-mem synth computation for WS push)
 *   - back/services/collector HTTP /candles (on-read synth OHLC via Parkinson maths)
 *   - front (symbol whitelist + UI labels)
 *
 * Adding a path = 1 line in this array. Engine + FE auto-pick it up at next boot.
 *
 * @example
 * import { SYNTH_PATHS, isSynth, pathFor } from '@btr-protocol/sdk/types';
 * pathFor('PAXGEUR')  // → { sym: 'PAXGEUR', legs: [['PAXGUSDT', 1], ['EURUSDT', -1]] }
 */

/** Signed leg: [symbol, exponent]. exp=-1 means invert the leg in the product. */
export type Leg = readonly [sym: string, exp: 1 | -1];

/** A synthetic symbol = product of signed legs. */
export type SynthPath = {
  readonly sym: string;
  readonly legs: readonly Leg[];
};

/**
 * Canonical synth path registry.
 * Format: `synth = Π leg^exp` (multiplicative).
 * Examples:
 *   USDCBTC = 1 / BTCUSDC                    → [['BTCUSDC', -1]]
 *   ETHBTC  = ETHUSDT / BTCUSDT              → [['ETHUSDT', 1], ['BTCUSDT', -1]]
 *   PAXGEUR = PAXGUSDT × USDEUR (= /EURUSDT) → [['PAXGUSDT', 1], ['EURUSDT', -1]]
 *
 * Constraint: every leg `sym` must be a raw symbol present in collector cfg
 * (or a previously-declared synth — DAG via SYNTH_PATHS_ORDERED).
 */
export const SYNTH_PATHS: readonly SynthPath[] = Object.freeze([
  // Pure inversions (FX-style + stables)
  { sym: 'USDCBTC',  legs: Object.freeze([['BTCUSDC',  -1]] as const) },
  { sym: 'USDCETH',  legs: Object.freeze([['ETHUSDC',  -1]] as const) },
  { sym: 'USDCSOL',  legs: Object.freeze([['SOLUSDC',  -1]] as const) },
  { sym: 'USDCPAXG', legs: Object.freeze([['PAXGUSDC', -1]] as const) },

  // 2-leg crosses (USDT-denominated → cross via USDT)
  { sym: 'ETHBTC',   legs: Object.freeze([['ETHUSDT',  1], ['BTCUSDT', -1]] as const) },
  { sym: 'SOLBTC',   legs: Object.freeze([['SOLUSDT',  1], ['BTCUSDT', -1]] as const) },
  { sym: 'SOLETH',   legs: Object.freeze([['SOLUSDT',  1], ['ETHUSDT', -1]] as const) },

  // Cross-currency triangulations (sym → EUR via USDT × EURUSD pivot)
  { sym: 'BTCEUR',   legs: Object.freeze([['BTCUSDT',  1], ['EURUSDT', -1]] as const) },
  { sym: 'ETHEUR',   legs: Object.freeze([['ETHUSDT',  1], ['EURUSDT', -1]] as const) },
  { sym: 'PAXGEUR',  legs: Object.freeze([['PAXGUSDT', 1], ['EURUSDT', -1]] as const) },

  // Gold crosses
  { sym: 'BTCPAXG',  legs: Object.freeze([['BTCUSDT',  1], ['PAXGUSDT', -1]] as const) },
  { sym: 'ETHPAXG',  legs: Object.freeze([['ETHUSDT',  1], ['PAXGUSDT', -1]] as const) },
]);

/** Set of synth symbol names (O(1) membership). */
export const SYNTH_SYMS: ReadonlySet<string> = new Set(SYNTH_PATHS.map(p => p.sym));

/** O(1) lookup: sym → SynthPath or undefined. */
const PATH_BY_SYM = new Map(SYNTH_PATHS.map(p => [p.sym, p]));
export function pathFor(sym: string): SynthPath | undefined {
  return PATH_BY_SYM.get(sym);
}

/** Test if a symbol is synthetic (inverted or triangulated). */
export function isSynth(sym: string): boolean {
  return SYNTH_SYMS.has(sym);
}

/** Reverse map: leg sym → synth paths that depend on it. Built once at module load. */
export const SYNTH_DEPS: ReadonlyMap<string, readonly SynthPath[]> = (() => {
  const m = new Map<string, SynthPath[]>();
  for (const p of SYNTH_PATHS) {
    for (const [leg] of p.legs) {
      const arr = m.get(leg) ?? [];
      arr.push(p);
      m.set(leg, arr);
    }
  }
  return new Map([...m.entries()].map(([k, v]) => [k, Object.freeze(v) as readonly SynthPath[]]));
})();

/** All leg symbols referenced by any synth path (deduped). */
export const SYNTH_LEG_SYMS: ReadonlySet<string> = new Set(
  SYNTH_PATHS.flatMap(p => p.legs.map(([sym]) => sym)),
);
