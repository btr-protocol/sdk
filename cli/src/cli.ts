// `btr`: a read-only command line over the public BTR API. Every command is one entry of the SDK
// operation table (`@btr-protocol/sdk/public`); this file only parses argv and prints. No keys,
// no signing, no transactions.

import { setApiRoot } from '@btr-protocol/sdk';
import { OPS, type Op, UsageError, opByName, runOp } from '@btr-protocol/sdk/public';

export interface Io {
  out(s: string): void;
  err(s: string): void;
  /** Reads a `-` (stdin) or file argument for an `object` param. */
  read(path: string): Promise<string>;
}

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--chain` is shorthand for `--chain-id`, the one flag every chain-scoped command takes. */
const ALIASES: Record<string, string> = { chain: 'chainId' };

function usage(): string {
  const w = Math.max(...OPS.map((o) => o.name.length));
  return [
    'btr: read-only client for the public BTR API (api.btr.markets/v1)',
    '',
    'usage: btr <command> [args] [--json] [--api <url>]',
    '',
    ...OPS.map((o) => `  ${o.name.padEnd(w)}  ${o.description}`),
    '',
    'btr <command> --help lists its arguments. --json prints machine-readable JSON.',
  ].join('\n');
}

function opUsage(op: Op): string {
  const pos = (op.positional ?? []).map((p) =>
    op.params[p]!.type === 'array' ? `<${p}...>` : op.required.includes(p) ? `<${p}>` : `[${p}]`,
  );
  const lines = Object.entries(op.params).map(([k, p]) => {
    const req = op.required.includes(k) ? ' (required)' : '';
    return `  --${kebab(k)} <${p.type === 'array' ? `${p.items?.type ?? 'string'},...` : p.type}>${req}\n      ${p.description}`;
  });
  return [
    `usage: btr ${op.name} ${pos.join(' ')}`.trimEnd(),
    '',
    op.description,
    '',
    ...lines,
  ].join('\n');
}

interface Parsed {
  cmd?: string;
  args: Record<string, unknown>;
  positionals: string[];
  json: boolean;
  help: boolean;
  api?: string;
}

function parseArgv(argv: string[]): Parsed {
  const p: Parsed = { args: {}, positionals: [], json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') p.json = true;
    else if (a === '-h' || a === '--help') p.help = true;
    else if (a === '--') {
      p.positionals.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const raw = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const key = ALIASES[raw] ?? camel(raw);
      // A boolean flag takes a value only as `--flag=v` or a literal true/false after it.
      const bool = p.cmd !== undefined && opByName(p.cmd)?.params[key]?.type === 'boolean';
      const next = argv[i + 1];
      let val: string;
      if (eq >= 0) val = a.slice(eq + 1);
      else if (
        next !== undefined &&
        !next.startsWith('--') &&
        (!bool || /^(true|false)$/.test(next))
      )
        val = argv[++i]!;
      else val = '';
      if (key === 'api') p.api = val;
      else {
        const prev = p.args[key];
        p.args[key] = prev === undefined ? val : `${prev as string},${val}`;
      }
    } else if (p.cmd === undefined) p.cmd = a;
    else p.positionals.push(a);
  }
  return p;
}

/** Map positionals onto the op's declared order; a trailing array param takes the rest. */
function bindPositionals(op: Op, pos: string[], args: Record<string, unknown>): void {
  const names = op.positional ?? [];
  for (let i = 0; i < pos.length; i++) {
    const name = names[i];
    if (!name) throw new UsageError(`${op.name}: unexpected argument ${pos[i]}`);
    if (args[name] !== undefined) throw new UsageError(`${op.name}: ${name} given twice`);
    if (op.params[name]!.type === 'array') {
      args[name] = pos.slice(i).join(',');
      return;
    }
    args[name] = pos[i];
  }
}

const isFlat = (r: unknown): r is Record<string, unknown> =>
  typeof r === 'object' &&
  r !== null &&
  !Array.isArray(r) &&
  Object.values(r).every((v) => v === null || typeof v !== 'object');

const cell = (v: unknown): string => (v === null || v === undefined ? '-' : String(v));

/** Human output: an array of flat rows is a table, an object is `key  value` lines; anything
 *  nested below that is printed as indented JSON. `--json` bypasses all of it. */
export function render(v: unknown): string {
  if (Array.isArray(v) && v.length && v.every(isFlat)) {
    const cols = [...new Set(v.flatMap((r) => Object.keys(r)))];
    const rows = [cols, ...v.map((r) => cols.map((c) => cell(r[c])))];
    const w = cols.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
    return rows
      .map((r) =>
        r
          .map((c, i) => c.padEnd(w[i]!))
          .join('  ')
          .trimEnd(),
      )
      .join('\n');
  }
  if (isFlat(v)) {
    const w = Math.max(0, ...Object.keys(v).map((k) => k.length));
    return Object.entries(v)
      .map(([k, x]) => `${k.padEnd(w)}  ${cell(x)}`)
      .join('\n');
  }
  return JSON.stringify(v, null, 2);
}

/** Runs one invocation; returns the exit code (0 ok, 1 API/transport failure, 2 usage). */
export async function main(argv: string[], io: Io): Promise<number> {
  const p = parseArgv(argv);
  if (p.cmd === undefined || p.cmd === 'help') {
    (p.cmd === undefined && !p.help ? io.err : io.out)(usage());
    return p.cmd === undefined && !p.help ? 2 : 0;
  }
  const op = opByName(p.cmd);
  if (!op) {
    io.err(`btr: unknown command ${p.cmd}\n\n${usage()}`);
    return 2;
  }
  if (p.help) {
    io.out(opUsage(op));
    return 0;
  }
  if (p.api !== undefined) setApiRoot(p.api);
  try {
    bindPositionals(op, p.positionals, p.args);
    for (const [k, prm] of Object.entries(op.params)) {
      if (prm.type === 'object' && typeof p.args[k] === 'string') {
        const text = await io.read(p.args[k] as string);
        try {
          p.args[k] = JSON.parse(text);
        } catch {
          throw new UsageError(`${k}: ${p.args[k]} is not valid JSON`);
        }
      }
    }
    const res = await runOp(op, p.args, true);
    io.out(p.json ? JSON.stringify(res) : render(res));
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof UsageError) {
      io.err(`btr ${op.name}: ${msg}\n\n${opUsage(op)}`);
      return 2;
    }
    io.err(p.json ? JSON.stringify({ error: msg }) : `btr ${op.name}: ${msg}`);
    return 1;
  }
}
