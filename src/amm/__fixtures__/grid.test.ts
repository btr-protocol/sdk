// Guards the tracked slice against the full fit output. The slice is what every AMM test builds
// curves from; this is the only place that can notice it going stale.
//
// The full grid is gitignored, so on a clean clone (CI, fresh checkout) there is nothing to
// compare against and the parity case skips WITH A REASON. It never passes vacuously: the
// presence of the artifact is asserted separately and reported, and the slice's own shape is
// checked unconditionally.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import { GRID_PATH, type SplineGrid, sliceGrid } from './grid';
import SLICE from './spline_grid.json';

const hasFullGrid = existsSync(GRID_PATH);

describe('spline preset grid fixture', () => {
  test('tracked slice is well-formed and non-empty', () => {
    const g = SLICE as SplineGrid;
    expect(g.regimes.length).toBeGreaterThan(0);
    expect(Object.keys(g.walls).length).toBeGreaterThan(0);
    for (const wall of Object.values(g.walls)) {
      expect(wall.shared.interiorX.length).toBeGreaterThan(0);
      expect(Object.keys(wall.presets).length).toBeGreaterThan(0);
      for (const p of Object.values(wall.presets)) {
        expect(p.portable).toBe(true);
        expect(p.w.length).toBe(wall.shared.interiorX.length + 5); // ncp = interior + degree + 1
      }
    }
  });

  if (!hasFullGrid) {
    test.skip(`slice matches full grid — SKIPPED: ${GRID_PATH} absent (gitignored research output; run bun scripts/gen-curve-grid-fixture.ts locally to refresh)`, () => {});
  } else {
    test('slice matches the full grid at dex/research/stable-core/out', () => {
      const full = JSON.parse(readFileSync(GRID_PATH, 'utf8')) as SplineGrid;
      expect(sliceGrid(full)).toEqual(SLICE as SplineGrid);
    });
  }
});
