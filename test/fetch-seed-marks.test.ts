import { expect, test } from 'bun:test';

test('fetch-seed-marks without a chain exits non-zero with usage and writes nothing', () => {
  const r = Bun.spawnSync(['bun', 'scripts/fetch-seed-marks.ts'], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, CHAIN: '' },
  });
  expect(r.exitCode).toBe(2);
  expect(r.stderr.toString()).toContain('usage:');
});
