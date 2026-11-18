#!/usr/bin/env bun
import {
  type RegistryOpts,
  fetchAbi,
  fetchAbis,
  fetchRegistry,
  rosterFor,
} from '../venues/live.js';
// `btr` CLI (bun only): read-only views of the live registry. No signing, no tx sending.
// Data goes to `out`; usage, warnings and errors go to stderr; exit 0 ok, 1 failure, 2 usage.
import { defaultChainId } from '../venues/registry.js';

const USAGE = `btr registry [--chain <id>] [--json]
btr pools [--chain <id>] [--json]
btr roster [--chain <id>]
btr abi <Name>
btr abis [--chain <id>]
flags: --trust-live (accept live that differs from baked), --fallback-baked (use baked if live is down)`;

const err = (s: string) => console.error(s);

export async function run(
  argv: string[],
  out: (s: string) => void,
  o: RegistryOpts = {},
): Promise<number> {
  try {
    const [cmd, ...rest] = argv;
    const flag = (n: string) => rest.includes(`--${n}`);
    const ci = rest.indexOf('--chain');
    const chain = ci >= 0 ? Number(rest[ci + 1]) : undefined;
    if (chain !== undefined && !(Number.isInteger(chain) && chain > 0)) {
      err('--chain must be a positive integer');
      return 2;
    }
    const opts: RegistryOpts = {
      ...o,
      trustLive: o.trustLive ?? flag('trust-live'),
      fallback: o.fallback ?? (flag('fallback-baked') ? 'baked' : undefined),
    };
    if (cmd === 'abi') {
      if (!rest[0] || rest[0].startsWith('--')) {
        err(USAGE);
        return 2;
      }
      out(JSON.stringify(await fetchAbi(rest[0], opts, chain ?? defaultChainId())));
      return 0;
    }
    if (cmd === 'abis') {
      out(JSON.stringify(await fetchAbis(chain ?? defaultChainId(), opts), null, 2));
      return 0;
    }
    if (cmd === 'roster') {
      out(JSON.stringify(await rosterFor(chain ?? defaultChainId(), opts), null, 2));
      return 0;
    }
    if (cmd !== 'registry' && cmd !== 'pools') {
      err(USAGE);
      return 2;
    }
    const r = await fetchRegistry(chain, opts);
    for (const w of r.warnings) err(`warning: ${w}`);
    if (r.degraded) err('warning: registry reports degraded (roster/abis may be missing)');
    if (flag('json')) out(JSON.stringify(cmd === 'pools' ? r.pools : r, null, 2));
    else if (cmd === 'pools')
      for (const p of r.pools) out(`${p.tag}\t${p.address}\t${p.symbols.join(',')}`);
    else {
      out(`chain ${r.chainId} (${r.source})`);
      for (const [k, v] of Object.entries(r.contracts)) out(`${k}\t${v}`);
    }
    return 0;
  } catch (e) {
    err(`btr: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), console.log));
