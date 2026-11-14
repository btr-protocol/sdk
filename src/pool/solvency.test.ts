import { expect, test } from 'bun:test';
import type { PoolState } from '../amm/aimm';
import { chainNowMs, syncChainClock, withPoolSolvency } from './index';

test('degraded sweep: the toll word is unknown (null), never a 0 settlement toll', () => {
  const st = withPoolSolvency({ base: 'USDC', legs: {} } as PoolState, {
    ok: false,
    exitTollWad: 0n,
  });
  expect(st.exitTollWad).toBeNull();
  expect(st.solvencyAtMs).toBeGreaterThan(0);
});

test('the chain rate C rides the state, null when the read had none', () => {
  const base = { base: 'USDC', legs: {} } as PoolState;
  expect(
    withPoolSolvency(base, { ok: true, exitTollWad: 0n, cWad: 98n * 10n ** 16n }).solvencyCWad,
  ).toBe(98n * 10n ** 16n);
  expect(withPoolSolvency(base, { ok: true, exitTollWad: 0n }).solvencyCWad).toBeNull();
});

test('an unstamped read is stamped in chain time: a device 100 s behind the chain stamps ahead of its clock', async () => {
  const ahead = Math.floor(Date.now() / 1000) + 100;
  const chain = { request: async () => ({ timestamp: `0x${ahead.toString(16)}` }) } as never;
  await syncChainClock(chain);
  try {
    const gap = chainNowMs() - Date.now();
    expect(gap).toBeGreaterThan(99_000);
    expect(gap).toBeLessThan(101_000);
    const st = withPoolSolvency({ base: 'USDC', legs: {} } as PoolState, {
      ok: true,
      exitTollWad: 1n,
    });
    expect((st.solvencyAtMs as number) - Date.now()).toBeGreaterThan(99_000);
    // A read that carries its own header time keeps it.
    expect(
      withPoolSolvency({ base: 'USDC', legs: {} } as PoolState, {
        ok: true,
        exitTollWad: 1n,
        observedAtMs: 42,
      }).solvencyAtMs,
    ).toBe(42);
  } finally {
    await syncChainClock({
      request: async () => ({ timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` }),
    } as never);
  }
});
