#!/usr/bin/env bun
import { main } from './cli.ts';

const code = await main(process.argv.slice(2), {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
  read: (path) => (path === '-' ? Bun.stdin.text() : Bun.file(path).text()),
});
process.exit(code);
