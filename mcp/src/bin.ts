#!/usr/bin/env bun
// btr-mcp [--http] [--host 127.0.0.1] [--port 8787] [--path /mcp] [--allow-origin <o,...|*>] [--api <url>]
// Default transport is stdio; --http serves stateless streamable HTTP.

import { setApiRoot } from '@btr-protocol/sdk';
import { mcpFetchHandler } from './http.ts';
import { serveStdio } from './stdio.ts';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    'usage: btr-mcp [--http [--host H] [--port P] [--path /mcp] [--allow-origin o,...|*]] [--api URL]',
  );
  process.exit(0);
}
const api = flag('api');
if (api) setApiRoot(api);

if (argv.includes('--http')) {
  const maxBodyBytes = 1 << 20;
  const server = Bun.serve({
    hostname: flag('host') ?? '127.0.0.1',
    port: Number(flag('port') ?? process.env.PORT ?? 8787),
    maxRequestBodySize: maxBodyBytes,
    fetch: mcpFetchHandler({
      path: flag('path') ?? '/mcp',
      allowOrigins: flag('allow-origin')?.split(','),
      maxBodyBytes,
    }),
  });
  console.error(`btr-mcp: streamable HTTP on ${server.url}`);
} else {
  await serveStdio(Bun.stdin.stream(), (line) => process.stdout.write(`${line}\n`));
}
