// Streamable HTTP transport, stateless: every POST carries complete JSON-RPC and gets a JSON
// reply (`application/json`, no SSE stream, no session id). That is all a read-only tool server
// needs, and it lets any replica behind a load balancer answer any request.

import { PROTOCOL_VERSIONS, handlePayload } from './server.ts';

export interface HttpOpts {
  /** Endpoint path. Default `/mcp`. */
  path?: string;
  /** Allowed browser `Origin`s; `*` allows any. Requests without `Origin` (non-browser) always
   *  pass. Default: loopback origins only, the DNS-rebinding guard the MCP spec requires. */
  allowOrigins?: readonly string[];
  /** Largest accepted body in bytes. Default 1 MiB. */
  maxBodyBytes?: number;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const rpcError = (status: number, code: number, message: string): Response =>
  json({ jsonrpc: '2.0', id: null, error: { code, message } }, status);

/** A fetch handler (`Bun.serve({ fetch })`, or any Web-standard host) serving MCP at `path`. */
export function mcpFetchHandler(opts: HttpOpts = {}): (req: Request) => Promise<Response> {
  const path = opts.path ?? '/mcp';
  const allow = opts.allowOrigins;
  const max = opts.maxBodyBytes ?? 1 << 20;
  const originOk = (o: string | null): boolean =>
    o === null || (allow ? allow.includes('*') || allow.includes(o) : LOOPBACK.test(o));

  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true });
    if (url.pathname !== path) return json({ error: 'not found' }, 404);
    const origin = req.headers.get('origin');
    if (!originOk(origin)) return json({ error: 'origin not allowed' }, 403);
    const cors: Record<string, string> = origin
      ? { 'access-control-allow-origin': origin, vary: 'origin' }
      : {};
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type, accept, mcp-protocol-version',
          'access-control-max-age': '600',
        },
      });
    }
    if (req.method !== 'POST') {
      // No server-initiated stream and no sessions to delete: the spec's answer is 405.
      return new Response(null, { status: 405, headers: { ...cors, allow: 'POST, OPTIONS' } });
    }
    const pv = req.headers.get('mcp-protocol-version');
    if (pv !== null && !(PROTOCOL_VERSIONS as readonly string[]).includes(pv)) {
      return rpcError(400, -32600, `unsupported MCP-Protocol-Version ${pv}`);
    }
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > max) return rpcError(413, -32600, 'body too large');
    const body = await req.arrayBuffer();
    if (body.byteLength > max) return rpcError(413, -32600, 'body too large');
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return rpcError(400, -32700, 'parse error');
    }
    const reply = await handlePayload(payload);
    if (reply === null) return new Response(null, { status: 202, headers: cors });
    return json(reply, 200, cors);
  };
}
