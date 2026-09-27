/** The committed venue table against the dex-evm records it is generated from.
 *  Fails (never skips) without the sibling: CI clones it pinned. */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { poolTag, venuesFromRecords } from '../scripts/gen-venues';
import { DEPLOYED_VENUES } from '../src/venues/deployments.generated';

const DEX = join(import.meta.dir, '..', '..', 'dex-evm');
if (!existsSync(join(DEX, 'deployments', 'chains.json')))
  throw new Error('venues-mirror.test.ts needs ../dex-evm/deployments (CI pins and clones it)');

test('committed table = records', () => {
  expect(DEPLOYED_VENUES).toEqual(venuesFromRecords(DEX));
});

test('tags follow the back registry', () => {
  expect(poolTag('stableCore')).toBe('btr-stable-core');
  expect(poolTag('stablePool')).toBe('btr-stable');
  expect(poolTag('core')).toBe('btr-core');
  expect(poolTag('usd1Core')).toBe('btr-usd1-core');
  expect(poolTag('_doc')).toBeNull();
});

test('every routable symbol has a token; feeds decode to their ticker', () => {
  for (const v of Object.values(DEPLOYED_VENUES)) {
    for (const p of v.pools) for (const s of p.symbols) expect(v.tokens[s]).toBeDefined();
    for (const [n, id] of Object.entries(v.feedIds))
      expect(BigInt(id).toString()).toBe(v.tickerIds[n]);
  }
});
