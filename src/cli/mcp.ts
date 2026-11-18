#!/usr/bin/env bun
// Read-only MCP server over stdio (newline-delimited JSON-RPC 2.0), bun only.
// No signing, no tx sending.
import {
  type RegistryOpts,
  fetchLiveAbi,
  fetchAbis,
  fetchRegistry,
  rosterFor,
} from '../venues/live.js';
import { defaultChainId } from '../venues/registry.js';

const PROTOCOL = '2024-11-05';
const chainProp = {
  chainId: { type: 'number', description: 'EVM chain id (default: baked default)' },
};
export const TOOLS = [
  {
    name: 'get_registry',
    description: 'BTR contracts, tokens and pools for a chain (live API, verified against baked)',
    inputSchema: { type: 'object', properties: chainProp },
  },
  {
    name: 'get_abi',
    description: 'ABI JSON for a BTR contract by name (e.g. Pool, Admin)',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'list_pools',
    description: 'Deployed BTR pools for a chain',
    inputSchema: { type: 'object', properties: chainProp },
  },
  {
    name: 'list_abis',
    description: 'Index of ABI names served for a chain',
    inputSchema: { type: 'object', properties: chainProp },
  },
  {
    name: 'get_roster',
    description: 'Keeper/signer roster for a chain',
    inputSchema: { type: 'object', properties: chainProp },
  },
];

type Rec = Record<string, unknown>;

function chainArg(a: Rec | undefined): number | undefined {
  const c = a?.chainId;
  if (c === undefined) return undefined;
  if (typeof c !== 'number' || !Number.isInteger(c) || c <= 0)
    throw new Error('chainId must be a positive integer');
  return c;
}

async function call(name: unknown, a: Rec | undefined, o: RegistryOpts): Promise<unknown> {
  const chain = chainArg(a);
  if (name === 'get_abi') return fetchLiveAbi(String(a?.name), o, chain ?? defaultChainId());
  if (name === 'list_abis') return fetchAbis(chain ?? defaultChainId(), o);
  if (name === 'get_roster') return rosterFor(chain ?? defaultChainId(), o);
  if (name === 'get_registry' || name === 'list_pools') {
    const r = await fetchRegistry(chain, o);
    return name === 'list_pools'
      ? {
          pools: r.pools,
          otherPools: r.otherPools,
          degraded: r.degraded,
          source: r.source,
          warnings: r.warnings,
        }
      : r;
  }
  throw new Error(`unknown tool ${String(name)}`);
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
        serverInfo: { name: 'btr', version: '0.1.0' },
      });
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const r = await call(
          params.name,
          isObj(params.arguments) ? params.arguments : undefined,
          o,
        );
        return ok({ content: [{ type: 'text', text: JSON.stringify(r) }] });
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

if (import.meta.main) {
  let buf = '';
  let queue: Promise<void> = Promise.resolve(); // serial: responses keep request order
  process.stdin.setEncoding('utf8');
  const feed = (c: string, final = false) => {
    buf += final ? '\n' : c;
    if (buf.length > MAX_LINE && buf.indexOf('\n') < 0) {
      buf = '';
      process.stdout.write(`${JSON.stringify(rpcErr(null, -32700, 'line too large'))}\n`);
      return;
    }
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line)
        queue = queue.then(async () => {
          const res = await handleLine(line);
          if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
        });
      i = buf.indexOf('\n');
    }
  };
  process.stdin.on('data', (c: string) => feed(c));
  process.stdin.on('end', () => feed('', true));
}
