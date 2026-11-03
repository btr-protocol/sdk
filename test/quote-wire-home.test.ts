// The quote fields btr-quote serves on every surface have ONE TS declaration: `QuoteBaseWire`
// in `src/amm/aimm.ts`. A surface's wire type extends it; re-listing the fields is how three hand
// mirrors drifted (front's `/quote` copy, chain mode's `QuotedAmount`). front carries the same gate.

import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(e) && !/\.test\.ts$/.test(e) ? [p] : [];
  });

const FIELD = /^\s+(?:mid_price|mark_price|cov_toll|proto_fee|lp_fee)\??:\s*string/;

test('quote base fields are declared only in QuoteBaseWire', () => {
  const hits = files(join(ROOT, 'src')).flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .flatMap((l, i) => (FIELD.test(l) ? [`${relative(ROOT, f)}:${i + 1}`] : [])),
  );
  expect(hits.map((h) => h.split(':')[0])).toEqual(Array(5).fill('src/amm/aimm.ts'));
  const src = readFileSync(join(ROOT, 'src/amm/aimm.ts'), 'utf8');
  const body = /export interface QuoteBaseWire \{([^}]*)\}/.exec(src)?.[1] ?? '';
  expect(body.split('\n').filter((l) => FIELD.test(l))).toHaveLength(5);
});
