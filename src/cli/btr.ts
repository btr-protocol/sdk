#!/usr/bin/env bun
// `btr` CLI: read-only views of the live registry. No signing, no tx sending.
import { type LiveOpts, fetchAbi, fetchRegistry } from '../venues/live.js';

const USAGE = `btr registry [--chain <id>] [--json]
btr abi <Name>
btr pools [--chain <id>] [--json]`;

export async function run(
  argv: string[],
  out: (s: string) => void,
  o: LiveOpts = {},
): Promise<number> {
  const [cmd, ...rest] = argv;
  const flag = (n: string) => rest.includes(`--${n}`);
  const ci = rest.indexOf('--chain');
  const chain = ci >= 0 ? Number(rest[ci + 1]) : undefined;
  if (chain !== undefined && !Number.isInteger(chain)) {
    out('bad --chain');
    return 2;
  }
  const json = flag('json');
  if (cmd === 'abi') {
    if (!rest[0]) {
      out(USAGE);
      return 2;
    }
    out(JSON.stringify(await fetchAbi(rest[0], o)));
    return 0;
  }
  if (cmd !== 'registry' && cmd !== 'pools') {
    out(USAGE);
    return 2;
  }
  const r = await fetchRegistry(chain, o);
  for (const w of r.warnings) console.error(`warning: ${w}`);
  const body = cmd === 'pools' ? r.pools : r;
  if (json) out(JSON.stringify(body, null, 2));
  else if (cmd === 'pools')
    for (const p of r.pools) out(`${p.tag}\t${p.address}\t${p.symbols.join(',')}`);
  else {
    out(`chain ${r.chainId} (${r.source})`);
    for (const [k, v] of Object.entries(r.contracts)) out(`${k}\t${v}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), console.log));
