#!/usr/bin/env bun
// `btr` CLI (bun only): the front's features in a terminal. Read-only views of the live API, plus
// `swap` / `lp` that only BUILD unsigned call JSON. No keys, no signing, no broadcast.
// Each command is imported on demand so startup stays flat. Data goes to `out`; usage, warnings and
// errors go to stderr; exit 0 ok, 1 failure, 2 usage.
import type { RegistryOpts } from '../venues/live.js';

const USAGE = `btr pools [--window 24h|7d|30d] [--address 0x..] [--json]   pool tree: APY, coverage, volume, TVL, position
btr metrics [--window w] [--json]                           APR split (fee/hook/toll), deployed, TVL, volume
btr risk [--window w] [--json]                              coverage, skew, oracle age, deployed, per-leg
btr flow [--window w] [--json]                              LP deposits/withdrawals per leg
btr keepers [--json]                                        role Safes, health, oracle age
btr quote <IN> <OUT> <amount> [--slippage-bps 50] [--json] routed quote with server floor
btr swap <IN> <OUT> <amount> --from 0x.. [--slippage-bps 50]   unsigned approve+swap calls (JSON)
btr lp deposit|withdraw <pool-tag> <SYM> <amount> --from 0x.. --min-out <raw>   unsigned LP calls (JSON)
btr pools --list [--json]                                   registry pool list (tag, address, symbols)
btr registry [--json] | roster | abi <Name> | abis
common: --chain <id>, --trust-live, --fallback-baked`;

const VALUE = new Set(['chain', 'window', 'address', 'from', 'slippage-bps', 'min-out']);
const err = (s: string) => console.error(s);

export async function run(
  argv: string[],
  out: (s: string) => void,
  o: RegistryOpts = {},
): Promise<number> {
  try {
    const [cmd, ...rest] = argv;
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
    const flag = (n: string) => flags.has(n);
    const chain = flags.has('chain') ? Number(flags.get('chain')) : undefined;
    if (chain !== undefined && !(Number.isInteger(chain) && chain > 0)) {
      err('--chain must be a positive integer');
      return 2;
    }
    const opts: RegistryOpts = {
      ...o,
      trustLive: o.trustLive ?? flag('trust-live'),
      fallback: o.fallback ?? (flag('fallback-baked') ? 'baked' : undefined),
    };
    const reg = await import('../venues/registry.js');
    const id = chain ?? reg.defaultChainId();
    const a = { chain: id, flags, pos, o: opts, out };
    if (cmd === 'pools' && flag('list')) {
      // registry listing: tag, address, symbols (no metrics)
      const r = await (await import('../venues/live.js')).fetchRegistry(chain, opts);
      for (const w of r.warnings) err(`warning: ${w}`);
      if (flag('json')) out(JSON.stringify(r.pools, null, 2));
      else for (const p of r.pools) out(`${p.tag}\t${p.address}\t${p.symbols.join(',')}`);
      return 0;
    }
    switch (cmd) {
      case 'pools':
      case 'metrics':
      case 'risk':
      case 'flow':
      case 'keepers':
      case 'quote':
      case 'swap':
      case 'lp':
        return await (await import('./cmds.js'))[cmd](a);
      case 'abi':
      case 'abis':
      case 'roster':
      case 'registry': {
        const live = await import('../venues/live.js');
        if (cmd === 'abi') {
          if (!pos[0]) {
            err(USAGE);
            return 2;
          }
          out(JSON.stringify(await live.fetchLiveAbi(pos[0], opts, id)));
        } else if (cmd === 'abis') out(JSON.stringify(await live.fetchAbis(id, opts), null, 2));
        else if (cmd === 'roster') out(JSON.stringify(await live.rosterFor(id, opts), null, 2));
        else {
          const r = await live.fetchRegistry(chain, opts);
          for (const w of r.warnings) err(`warning: ${w}`);
          if (r.degraded) err('warning: registry reports degraded (roster/abis may be missing)');
          if (flag('json')) out(JSON.stringify(r, null, 2));
          else {
            out(`chain ${r.chainId} (${r.source})`);
            for (const [k, v] of Object.entries(r.contracts)) out(`${k}\t${v}`);
          }
        }
        return 0;
      }
      default:
        err(USAGE);
        return 2;
    }
  } catch (e) {
    err(`btr: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), console.log));
