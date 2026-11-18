#!/usr/bin/env bun
// Read-only MCP server over stdio (newline-delimited JSON-RPC 2.0). No signing, no tx sending.
import { type LiveOpts, fetchAbi, fetchRegistry } from '../venues/live.js';

const chainProp = {
  chainId: { type: 'number', description: 'EVM chain id (default: baked default)' },
};
export const TOOLS = [
  {
    name: 'get_registry',
    description: 'BTR contracts, tokens and pools for a chain (live API, baked fallback)',
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
];

// biome-ignore lint/suspicious/noExplicitAny: untyped JSON wire
async function call(name: string, a: any, o: LiveOpts): Promise<unknown> {
  if (name === 'get_abi') return fetchAbi(String(a?.name), o);
  if (name === 'get_registry' || name === 'list_pools') {
    const r = await fetchRegistry(a?.chainId, o);
    return name === 'list_pools' ? { pools: r.pools, source: r.source, warnings: r.warnings } : r;
  }
  throw new Error(`unknown tool ${name}`);
}

/** One JSON-RPC request in, response (or null for notifications) out. */
// biome-ignore lint/suspicious/noExplicitAny: untyped JSON wire
export async function handle(req: any, o: LiveOpts = {}): Promise<unknown | null> {
  const { id, method, params } = req;
  if (id === undefined) return null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  try {
    if (method === 'initialize')
      return ok({
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'btr', version: '0.1.0' },
      });
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const r = await call(params?.name, params?.arguments, o);
        return ok({ content: [{ type: 'text', text: JSON.stringify(r) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: (e as Error).message }] });
      }
    }
    if (method === 'ping') return ok({});
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `no method ${method}` } };
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: (e as Error).message } };
  }
}

if (import.meta.main) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (c: string) => {
    buf += c;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const res = await handle(JSON.parse(line));
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    }
  });
}
