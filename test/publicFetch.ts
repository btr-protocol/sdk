// Replays `test/fixtures/public/*.json` (recorded by `scripts/record-public-fixtures.ts`) as
// `globalThis.fetch`, so the src/public, cli and mcp tests run offline against real API bodies.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resetChainClientState, setApiRoot } from '../src/index.ts';

export interface Fixture {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  status: number;
  response: unknown;
}

const DIR = join(import.meta.dir, 'fixtures', 'public');
export const FIXTURES: Record<string, Fixture> = Object.fromEntries(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture]),
);

export const API_ROOT = 'https://fixtures.btr.test';

export interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** Install the replaying fetch; returns the call log and a restore function. Unknown requests
 *  answer 404 so a test never silently reaches the network. `override` replaces a fixture's
 *  response for one test. */
export function useFixtures(override: Partial<Record<string, unknown>> = {}): {
  calls: Call[];
  restore: () => void;
} {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  setApiRoot(API_ROOT);
  resetChainClientState();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = `${url.pathname}${url.search}`;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    for (const [name, f] of Object.entries(FIXTURES)) {
      if (f.method !== method || f.path !== path || url.origin !== API_ROOT) continue;
      if (f.body !== undefined && JSON.stringify(f.body) !== JSON.stringify(body)) continue;
      const response = name in override ? override[name] : f.response;
      return new Response(JSON.stringify(response), {
        status: f.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}
