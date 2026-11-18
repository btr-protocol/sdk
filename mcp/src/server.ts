// BTR MCP server: the SDK operation table (`@btr-protocol/sdk/public`) as read-only MCP tools.
// Transport-free core: `handleMessage` answers one JSON-RPC message; `stdio.ts` and `http.ts`
// only frame bytes. No keys, no signing, no transaction tools.

import { OPS, type Op, UsageError, opInputSchema, runOp } from '@btr-protocol/sdk/public';

export const SERVER_NAME = 'btr';
export const SERVER_VERSION = '0.1.0';
/** Newest first; `initialize` echoes the client's version when listed, else offers the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

const TOOL_PREFIX = 'btr_';

type Id = string | number | null;
interface Req {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}
export type Reply =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

const err = (id: Id, code: number, message: string): Reply => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

export const toolName = (op: Op): string => `${TOOL_PREFIX}${op.name}`;

const TOOLS = OPS.map((op) => ({
  name: toolName(op),
  description: op.description,
  inputSchema: opInputSchema(op),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
}));

const INSTRUCTIONS =
  'Read-only tools over the public BTR API (api.btr.markets/v1). Token amounts are integer base ' +
  'units; tokens may be addresses or registry symbols (btr_registry lists them). Nothing here ' +
  'signs or sends a transaction.';

async function callTool(id: Id, params: Record<string, unknown>): Promise<Reply> {
  const name = params.name;
  const op = typeof name === 'string' ? OPS.find((o) => toolName(o) === name) : undefined;
  if (!op) return err(id, -32602, `unknown tool ${String(name)}`);
  const args = params.arguments ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return err(id, -32602, 'arguments must be an object');
  }
  try {
    const res = await runOp(op, args as Record<string, unknown>);
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(res) }], isError: false },
    };
  } catch (e) {
    // A refused argument or a failed API call is a tool result the model can read and act on,
    // not a protocol error.
    const kind = e instanceof UsageError ? 'invalid arguments' : 'request failed';
    const msg = e instanceof Error ? e.message : String(e);
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `${kind}: ${msg}` }], isError: true },
    };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Answer one JSON-RPC message. Notifications and client responses get `null` (no reply). */
export async function handleMessage(msg: unknown): Promise<Reply | null> {
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return err(null, -32600, 'invalid request');
  if (typeof msg.method !== 'string') {
    // A response to a server request we never send, or junk: nothing to answer.
    return 'id' in msg && ('result' in msg || 'error' in msg)
      ? null
      : err(null, -32600, 'invalid request');
  }
  const req = msg as unknown as Req;
  if (req.id === undefined) return null; // notification
  const id = req.id;
  const params = isObj(req.params) ? req.params : {};
  switch (req.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const version = PROTOCOL_VERSIONS.find((v) => v === asked) ?? PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call':
      return callTool(id, params);
    default:
      return err(id, -32601, `method not found: ${req.method}`);
  }
}

/** A parsed body: one message or a (legacy) batch. Batches answer every non-notification. */
export async function handlePayload(payload: unknown): Promise<Reply | Reply[] | null> {
  if (!Array.isArray(payload)) return handleMessage(payload);
  if (!payload.length) return err(null, -32600, 'empty batch');
  const out = (await Promise.all(payload.map(handleMessage))).filter((r): r is Reply => !!r);
  return out.length ? out : null;
}
