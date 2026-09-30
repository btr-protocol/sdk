/** Regenerate `src/venues/nxr-marks.generated.json` from `NXR_MARKS` in `src/venues/nxr.ts`.
 *
 *   bun scripts/gen-nxr-marks.ts
 *
 * The JSON is what back's indexer compiles in (`include_str!`), so a symbol present here but not
 * in it leaves a chain listing that asset unindexable: its ingest refuses on "no NXR mark source".
 * `test/nxr-marks-mirror.test.ts` fails when the committed file drifts. */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NXR_MARKS, nxrPair } from '../src/venues/nxr';

type Basis = { symbol: string; invert?: true };

/** `usd` is the denominated row (the reciprocal served pair, inverted back, when NXR only carries
 *  that); `usdc` is the declared USDC basis, absent when the asset has none. */
export function marksJson(): Record<string, unknown> {
  const out: Record<string, { usd: Basis; usdc?: Basis }> = {};
  for (const [sym, m] of Object.entries(NXR_MARKS)) {
    const usdc = nxrPair(sym, 'USDC');
    out[sym] = {
      usd: m.nxrQuote ? { symbol: m.nxrQuote, invert: true } : { symbol: m.nxrSymbol },
      ...(usdc && { usdc: { symbol: usdc.nxrSymbol } }),
    };
  }
  return {
    _generated: 'Derived from src/venues/nxr.ts NXR_MARKS. Do not edit by hand.',
    ...out,
  };
}

if (import.meta.main) {
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'venues',
    'nxr-marks.generated.json',
  );
  writeFileSync(out, `${JSON.stringify(marksJson(), null, 2)}\n`);
  console.log(`gen-nxr-marks: wrote ${out}`);
}
