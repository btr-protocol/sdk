#!/usr/bin/env bun
// `btr` CLI (bun only): every entry of the shared command table (./table.ts), the same set `btr-mcp`
// serves. Reads hit the live API; `build-*` only BUILD unsigned call JSON. No keys, no signing, no
// broadcast. Data goes to `out`; usage, warnings and errors go to stderr; exit 0 ok, 1 failure, 2 usage.
import type { RegistryOpts } from '../venues/live.js';
import { TABLE, byName, defaultChain, toJson } from './table.js';

const usage = () =>
  [
    ...TABLE.map((c) => {
      const pos = (c.pos ?? []).map((p) => `<${p}>`).join(' ');
      const args = Object.entries(c.args ?? {})
        .map(([k, v]) => (v.required ? `--${k} ..` : `[--${k} ..]`))
        .join(' ');
      return `btr ${[c.name, pos, args].filter(Boolean).join(' ')}\n    ${c.description}`;
    }),
    'common: --chain <id>, --json, --trust-live, --fallback-baked',
  ].join('\n');

const VALUE = new Set([
  'chain',
  ...TABLE.flatMap((c) =>
    Object.entries(c.args ?? {})
      .filter(([, v]) => v.type !== 'boolean')
      .map(([k]) => k),
  ),
]);
const err = (s: string) => console.error(s);

export async function run(
  argv: string[],
  out: (s: string) => void,
  o: RegistryOpts = {},
): Promise<number> {
  try {
    const [name, ...rest] = argv;
    const cmd = name ? byName(name) : undefined;
    if (!cmd) {
      err(usage());
      return 2;
    }
    const flags = new Map<string, string>();
    const pos: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (!t.startsWith('--')) pos.push(t);
      else if (VALUE.has(t.slice(2))) {
        const v = rest[++i];
        if (v === undefined || v.startsWith('--')) throw new Error(`${t} needs a value`);
        flags.set(t.slice(2), v);
      } else flags.set(t.slice(2), '1');
    }
    const chain = flags.has('chain') ? Number(flags.get('chain')) : undefined;
    if (chain !== undefined && !(Number.isInteger(chain) && chain > 0)) {
      err('--chain must be a positive integer');
      return 2;
    }
    if (pos.length < (cmd.pos ?? []).length) {
      err(usage());
      return 2;
    }
    const opts: RegistryOpts = {
      ...o,
      trustLive: o.trustLive ?? flags.has('trust-live'),
      fallback: o.fallback ?? (flags.has('fallback-baked') ? 'baked' : undefined),
    };
    const r = await cmd.run({ chain: chain ?? (await defaultChain()), flags, pos, o: opts });
    const w = (r.data as { warnings?: unknown })?.warnings;
    if (Array.isArray(w)) for (const x of w) err(`warning: ${x}`);
    if (r.text && !flags.has('json')) for (const l of r.text) out(l);
    else out(toJson(r.data, 2));
    return 0;
  } catch (e) {
    err(`btr: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), console.log));
