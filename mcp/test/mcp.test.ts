import { afterEach, describe, expect, test } from 'bun:test';
import { OPS } from '@btr-protocol/sdk/public';
import { FIXTURES, useFixtures } from '../../test/publicFetch.ts';
import { mcpFetchHandler } from '../src/http.ts';
import { PROTOCOL_VERSIONS, type Reply, handleMessage, handlePayload } from '../src/server.ts';
import { serveStdio } from '../src/stdio.ts';

let restore = (): void => {};
afterEach(() => restore());
const fx = () => {
  const f = useFixtures();
  restore = f.restore;
  return f;
};

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

type ToolResult = { content: { type: string; text: string }[]; isError: boolean };
async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const r = (await handleMessage(rpc('tools/call', { name, arguments: args }))) as Reply;
  if (!('result' in r)) throw new Error(JSON.stringify(r));
  return r.result as ToolResult;
}
const ok = async (name: string, args?: Record<string, unknown>): Promise<unknown> => {
  const r = await call(name, args);
  expect(r.isError).toBe(false);
  return JSON.parse(r.content[0]!.text);
};

describe('lifecycle', () => {
  test('initialize echoes a supported version, else offers the newest', async () => {
    const a = (await handleMessage(rpc('initialize', { protocolVersion: '2025-06-18' }))) as {
      result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } };
    };
    expect(a.result.protocolVersion).toBe('2025-06-18');
    expect(a.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(a.result.serverInfo.name).toBe('btr');
    const b = (await handleMessage(rpc('initialize', { protocolVersion: '1999-01-01' }))) as {
      result: { protocolVersion: string };
    };
    expect(b.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });
  test('notifications get no reply; ping; unknown method; invalid request', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await handleMessage(rpc('ping'))).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await handleMessage(rpc('resources/list'))).toMatchObject({ error: { code: -32601 } });
    expect(await handleMessage({ id: 1, method: 'ping' })).toMatchObject({
      error: { code: -32600 },
    });
    expect(await handlePayload([])).toMatchObject({ error: { code: -32600 } });
    const batch = (await handlePayload([
      rpc('ping', undefined, 1),
      rpc('ping', undefined, 2),
    ])) as Reply[];
    expect(batch.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('tools/list', () => {
  test('one read-only tool per SDK operation, nothing else', async () => {
    const r = (await handleMessage(rpc('tools/list'))) as {
      result: {
        tools: {
          name: string;
          inputSchema: { type: string; additionalProperties: boolean };
          annotations: Record<string, boolean>;
        }[];
      };
    };
    const tools = r.result.tools;
    expect(tools.map((t) => t.name)).toEqual(OPS.map((o) => `btr_${o.name}`));
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
    }
  });
});

describe('tools/call against recorded fixtures', () => {
  test('btr_chains', async () => {
    fx();
    expect(await ok('btr_chains')).toEqual(FIXTURES.chains!.response);
  });
  test('btr_venues', async () => {
    fx();
    const all = FIXTURES.venues!.response as Record<string, unknown>;
    expect(await ok('btr_venues', { chainId: 143 })).toEqual(all['143']);
  });
  test('btr_registry (offline)', async () => {
    const { calls } = fx();
    const v = (await ok('btr_registry', { chainId: 143 })) as { chainId: number; versions: object };
    expect(v.chainId).toBe(143);
    expect(Object.keys(v.versions).length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
  test('btr_pools', async () => {
    fx();
    expect(await ok('btr_pools', { chainId: 143 })).toEqual(FIXTURES.pools!.response);
    expect(await ok('btr_pools', { chainId: 143, detail: true })).toEqual(
      FIXTURES['assets-pools']!.response,
    );
  });
  test('btr_quote', async () => {
    const { calls } = fx();
    const args = { tokenIn: 'USDC', tokenOut: 'WETH', amounts: ['1000000', '10000000'] };
    expect(await ok('btr_quote', args)).toEqual(FIXTURES['chain-quote']!.response);
    expect(calls[0]!.body).toEqual(FIXTURES['chain-quote']!.body);
  });
  test('btr_route', async () => {
    fx();
    const args = { tokenIn: 'USDC', tokenOut: 'WBTC', amountIn: '1000000000' };
    expect(await ok('btr_route', args)).toEqual(FIXTURES['chain-route']!.response);
  });
  test('btr_depth', async () => {
    fx();
    expect(await ok('btr_depth', { request: FIXTURES.depth!.body as object as never })).toEqual(
      FIXTURES.depth!.response,
    );
  });
  test('btr_marks', async () => {
    fx();
    expect(await ok('btr_marks', { symbols: ['BTC-USDC'] })).toEqual({
      'BTC-USDC': FIXTURES['price-BTC-USDC']!.response,
    });
  });
  test('btr_ohlc', async () => {
    fx();
    expect(await ok('btr_ohlc', { symbol: 'BTC-USDC', tf: 3600, limit: 3 })).toEqual(
      FIXTURES['ohlc-BTC-USDC']!.response,
    );
  });
  test('JSON args are not coerced from text: a string chainId is refused', async () => {
    fx();
    const r = await call('btr_pools', { chainId: '143' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('invalid arguments: chainId must be an integer');
  });
  test('API failure is a tool error result, unknown tool a protocol error', async () => {
    fx();
    const r = await call('btr_ohlc', { symbol: 'NOPE-X' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('request failed: BTR API 404');
    expect(await handleMessage(rpc('tools/call', { name: 'btr_swap' }))).toMatchObject({
      error: { code: -32602 },
    });
    expect(
      await handleMessage(rpc('tools/call', { name: 'btr_chains', arguments: [1] })),
    ).toMatchObject({ error: { code: -32602 } });
  });
});

describe('streamable HTTP (stateless)', () => {
  const h = mcpFetchHandler();
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    h(
      new Request('http://127.0.0.1:8787/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  test('request gets JSON, notification 202', async () => {
    const r = await post(rpc('tools/list'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(((await r.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(
      OPS.length,
    );
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  });
  test('tools/call over HTTP', async () => {
    fx();
    const r = await post(rpc('tools/call', { name: 'btr_chains', arguments: {} }));
    const body = (await r.json()) as { result: ToolResult };
    expect(JSON.parse(body.result.content[0]!.text)).toEqual(FIXTURES.chains!.response);
  });
  test('GET/DELETE 405, wrong path 404, health 200', async () => {
    expect((await h(new Request('http://x/mcp'))).status).toBe(405);
    expect((await h(new Request('http://x/mcp', { method: 'DELETE' }))).status).toBe(405);
    expect((await h(new Request('http://x/other', { method: 'POST' }))).status).toBe(404);
    expect((await h(new Request('http://x/health'))).status).toBe(200);
  });
  test('parse error, unsupported protocol version, oversized body', async () => {
    expect((await post('{')).status).toBe(400);
    expect((await post(rpc('ping'), { 'mcp-protocol-version': '1999-01-01' })).status).toBe(400);
    expect((await post(rpc('ping'), { 'mcp-protocol-version': '2025-06-18' })).status).toBe(200);
    const small = mcpFetchHandler({ maxBodyBytes: 10 });
    const r = await small(
      new Request('http://x/mcp', { method: 'POST', body: JSON.stringify(rpc('ping')) }),
    );
    expect(r.status).toBe(413);
  });
  test('Origin: loopback by default, allowlist when configured', async () => {
    expect((await post(rpc('ping'), { origin: 'https://evil.example' })).status).toBe(403);
    const local = await post(rpc('ping'), { origin: 'http://localhost:3000' });
    expect(local.status).toBe(200);
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const hosted = mcpFetchHandler({ allowOrigins: ['https://btr.markets'] });
    const req = (origin: string) =>
      hosted(
        new Request('http://x/mcp', {
          method: 'POST',
          headers: { origin },
          body: JSON.stringify(rpc('ping')),
        }),
      );
    expect((await req('https://btr.markets')).status).toBe(200);
    expect((await req('http://localhost:3000')).status).toBe(403);
    const pre = await hosted(
      new Request('http://x/mcp', {
        method: 'OPTIONS',
        headers: { origin: 'https://btr.markets' },
      }),
    );
    expect(pre.status).toBe(204);
  });
});

describe('stdio', () => {
  test('newline-delimited JSON-RPC, split chunks, notifications silent, parse errors answered', async () => {
    const enc = new TextEncoder();
    const lines = `${JSON.stringify(rpc('initialize', { protocolVersion: '2025-06-18' }))}\n${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\nnot json\n${JSON.stringify(rpc('ping', undefined, 2))}`;
    async function* chunks() {
      for (let i = 0; i < lines.length; i += 7) yield enc.encode(lines.slice(i, i + 7));
    }
    const out: string[] = [];
    await serveStdio(chunks(), (l) => out.push(l));
    const replies = out.map((l) => JSON.parse(l) as Reply);
    expect(replies).toHaveLength(3);
    expect(replies.find((r) => r.id === 1)).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    });
    expect(replies.find((r) => r.id === 2)).toMatchObject({ result: {} });
    expect(replies.find((r) => r.id === null)).toMatchObject({ error: { code: -32700 } });
  });
});
