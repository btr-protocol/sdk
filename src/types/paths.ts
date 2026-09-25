/**
 * Synthetic symbol paths: single source of truth for inverted + triangulated pairs.
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
