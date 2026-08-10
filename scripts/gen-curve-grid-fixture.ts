/**
 * Extract the deployability slice of the quartic-I-spline grid → checked-in test fixture.
 * Usage: bun scripts/gen-curve-grid-fixture.ts
 *
 * Source grid (dex/research/stable-core/out/spline_shared_grid.json) is 6.6 MB and gitignored
 * (`research/**​/out/`), so a clean clone of sdk cannot read it. Only the portable presets' knot
 * grid + weights are needed by src/amm/__fixtures__/profiles.ts, which is ~13 KB — small enough
 * to track. src/amm/__fixtures__/grid.test.ts re-verifies the slice against the full grid
 * whenever the artifact IS present, so drift cannot hide.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GRID_PATH, type SplineGrid, sliceGrid } from '../src/amm/__fixtures__/grid';

const OUT = resolve(import.meta.dir, '../src/amm/__fixtures__/spline_grid.json');

if (!existsSync(GRID_PATH)) {
  console.error(`source grid absent: ${GRID_PATH}\nrun the dex/research/stable-core fit first`);
  process.exit(1);
}
const full = JSON.parse(readFileSync(GRID_PATH, 'utf8')) as SplineGrid;
writeFileSync(OUT, `${JSON.stringify(sliceGrid(full), null, 2)}\n`);
console.log(`wrote ${OUT} (${Object.keys(full.walls).length} walls)`);
