import { describe, expect, test } from 'bun:test';
import { observedAtSecs } from './feed.js';

describe('observedAtSecs: the clock the contract gates on', () => {
  test('unsigned feed falls back to updatedAtSecs', () => {
    expect(observedAtSecs({ sourceTsMs: 0, updatedAtSecs: 1_000 })).toBe(1_000);
  });

  // The relay stamps updatedAtSecs=now on an older signed quote. Taking the min is what stops a
  // withheld blob from reading fresh; using updatedAtSecs alone under-states age by the relay lag.
  test('signed feed takes the min, so relay lag counts against freshness', () => {
    expect(observedAtSecs({ sourceTsMs: 900_000, updatedAtSecs: 1_000 })).toBe(900);
    expect(observedAtSecs({ sourceTsMs: 1_500_000, updatedAtSecs: 1_000 })).toBe(1_000);
  });
});
