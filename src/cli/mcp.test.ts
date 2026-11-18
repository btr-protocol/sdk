import { expect, test } from 'bun:test';
import { fetchRegistry } from '../venues/live';
import * as live from '../venues/live';
import { MAX_LINE } from './mcp';

test('oversized stdin line is refused with -32700', async () => {
  const p = Bun.spawn(['bun', 'src/cli/mcp.ts'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  p.stdin.write('x'.repeat(MAX_LINE + 10));
  p.stdin.end();
  const out = await new Response(p.stdout).text();
  expect(JSON.parse(out.trim().split('\n')[0]).error.code).toBe(-32700);
});

test('fetchRegistry rejects a non-integer chain before any request', async () => {
  await expect(fetchRegistry(1.5)).rejects.toThrow('positive integer');
});

test('live ABI fetch has its own name', () => {
  expect(typeof live.fetchLiveAbi).toBe('function');
  expect('fetchAbi' in live).toBe(false);
});
