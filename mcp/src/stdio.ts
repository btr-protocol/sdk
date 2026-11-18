// stdio transport: newline-delimited JSON-RPC on stdin/stdout, as MCP clients spawn local servers.
// stdout carries protocol only; diagnostics go to stderr.

import { handlePayload } from './server.ts';

/** Serve MCP over a line stream until it ends. Replies are written in completion order. */
export async function serveStdio(
  input: AsyncIterable<Uint8Array>,
  write: (line: string) => void,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = '';
  const pending = new Set<Promise<void>>();
  const dispatch = (line: string): void => {
    if (!line.trim()) return;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'parse error' },
        }),
      );
      return;
    }
    const p = handlePayload(payload).then((r) => {
      if (r !== null) write(JSON.stringify(r));
    });
    pending.add(p);
    p.finally(() => pending.delete(p));
  };
  for await (const chunk of input) {
    buf += dec.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      dispatch(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  dispatch(buf + dec.decode());
  await Promise.all(pending);
}
