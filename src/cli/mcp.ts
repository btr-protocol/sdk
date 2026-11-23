#!/usr/bin/env bun
// MCP server over stdio (newline-delimited JSON-RPC 2.0), bun only. Tools = the shared command
// table (./table.ts): reads + unsigned builds. No keys, no signing, no tx sending.
import pkg from '../../package.json' with { type: 'json' };
import type { RegistryOpts } from '../venues/live.js';
import { CHAIN, type Cmd, TABLE, defaultChain, toJson, toolName } from './table.js';

const PROTOCOL = '2024-11-05';
/** One tool per command-table entry: the CLI's exact capability set. */
export const TOOLS = TABLE.map((c) => ({
  name: toolName(c),
  description: `[${c.kind}] ${c.description}`,
  inputSchema: {
    type: 'object',
    properties: {
      chain: CHAIN,
      ...Object.fromEntries((c.pos ?? []).map((p) => [p, { type: 'string', description: p }])),
      ...Object.fromEntries(
        Object.entries(c.args ?? {}).map(([k, v]) => [
          k,
          { type: v.type, description: v.description },
        ]),
      ),
    },
    required: [
      ...(c.pos ?? []),
      ...Object.entries(c.args ?? {})
        .filter(([, v]) => v.required)
        .map(([k]) => k),
    ],
  },
}));
const BY_TOOL = new Map<string, Cmd>(TABLE.map((c) => [toolName(c), c]));

type Rec = Record<string, unknown>;

/** MCP arguments -> the CLI's `Args` shape, then the shared handler. */
export async function call(name: unknown, a: Rec = {}, o: RegistryOpts = {}): Promise<unknown> {
  const cmd = BY_TOOL.get(String(name));
  if (!cmd) throw new Error(`unknown tool ${String(name)}`);
  const c = a.chain;
  if (c !== undefined && (typeof c !== 'number' || !Number.isInteger(c) || c <= 0))
    throw new Error('chain must be a positive integer');
  const pos = (cmd.pos ?? []).map((p) => {
    const v = a[p];
    if (v === undefined || v === null || v === '') throw new Error(`${p} is required`);
    return String(v);
  });
  const flags = new Map<string, string>();
  for (const [k, def] of Object.entries(cmd.args ?? {})) {
    const v = a[k];
    if (v === undefined || v === null || v === false) continue;
    flags.set(k, def.type === 'object' && typeof v !== 'string' ? JSON.stringify(v) : String(v));
  }
  return (
    await cmd.run({ chain: (c as number | undefined) ?? (await defaultChain()), flags, pos, o })
  ).data;
}

const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);
const rpcErr = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/** One parsed JSON-RPC message in, response (null for notifications) out. Never throws. */
export async function handle(req: unknown, o: RegistryOpts = {}): Promise<unknown | null> {
  if (!isObj(req) || typeof req.method !== 'string') return rpcErr(null, -32600, 'invalid request');
  const { id, method } = req;
  const params = isObj(req.params) ? req.params : {};
  if (id === undefined) return null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  try {
    if (method === 'initialize')
      return ok({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'btr', version: pkg.version },
      });
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const r = await call(
          params.name,
          isObj(params.arguments) ? params.arguments : undefined,
          o,
        );
        return ok({ content: [{ type: 'text', text: toJson(r) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: (e as Error).message }] });
      }
    }
    if (method === 'ping') return ok({});
    return rpcErr(id, -32601, `no method ${method}`);
  } catch (e) {
    return rpcErr(id, -32603, (e as Error).message);
  }
}

/** One raw line: parse errors answer -32700 with id null. */
export async function handleLine(line: string, o: RegistryOpts = {}): Promise<unknown | null> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return rpcErr(null, -32700, 'parse error');
  }
  return handle(req, o);
}

/** Max bytes of one JSON-RPC line; larger input is dropped with -32700. */
export const MAX_LINE = 1_048_576;

export function serve(): void {
  let buf = '';
  let queue: Promise<void> = Promise.resolve(); // serial: responses keep request order
  process.stdin.setEncoding('utf8');
  let skipping = false; // inside an oversized line: drop input until its newline
  const over = () =>
    process.stdout.write(`${JSON.stringify(rpcErr(null, -32700, 'line too large'))}\n`);
  const feed = (c: string, final = false) => {
    let rest = final ? '\n' : c;
    while (rest) {
      const nl = rest.indexOf('\n');
      const piece = nl < 0 ? rest : rest.slice(0, nl);
      rest = nl < 0 ? '' : rest.slice(nl + 1);
      if (skipping) {
        if (nl >= 0) skipping = false;
        continue;
      }
      buf += piece;
      if (buf.length > MAX_LINE) {
        buf = '';
        over();
        skipping = nl < 0;
        continue;
      }
      if (nl < 0) break;
      const line = buf.trim();
      buf = '';
      if (line)
        queue = queue.then(async () => {
          const res = await handleLine(line);
          if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
        });
    }
  };
  process.stdin.on('data', (c: string) => feed(c));
  process.stdin.on('end', () => feed('', true));
}
if (import.meta.main) serve();
