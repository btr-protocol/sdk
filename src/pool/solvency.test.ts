import { expect, test } from 'bun:test';
import type { PoolState } from '../amm/aimm';
import type { Eip1193Provider } from '../eth/types';
import { getPoolSolvency, previewWithdrawFor, withPoolSolvency } from './index';

const pool = '0x1111111111111111111111111111111111111111' as const;
const token = '0x2222222222222222222222222222222222222222' as const;
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const solvencyProvider = (ok: boolean, toll: bigint) =>
  ({
    request: async ({ method, params }) => {
      expect(method).toBe('eth_call');
      expect(params).toEqual([expect.objectContaining({ to: pool }), 'latest']);
      return `0x${word(10n ** 18n)}${word(ok ? 1n : 0n)}${word(toll)}`;
    },
  }) as Eip1193Provider;

test.each([0n, 10n ** 17n])(
  'poolSolvencyWad exposes raw toll %p from the same call',
  async (toll) => {
    const s = await getPoolSolvency(solvencyProvider(true, toll), pool);
    expect(s).toMatchObject({ cWad: 10n ** 18n, ok: true, exitTollWad: toll });
    expect(s.observedAtMs).toBeGreaterThan(0);
  },
);

test('degraded sweep: the toll word is unknown (null), never a 0 settlement toll', async () => {
  const s = await getPoolSolvency(solvencyProvider(false, 0n), pool);
  expect(s.ok).toBe(false);
  expect(s.exitTollWad).toBeNull();
  const st = withPoolSolvency({ base: 'USDC', legs: {} } as PoolState, {
    ok: false,
    exitTollWad: 0n,
  });
  expect(st.exitTollWad).toBeNull();
  expect(st.solvencyAtMs).toBeGreaterThan(0);
});

test('previewWithdrawFor: display shares go out raw at the leg decimals', async () => {
  const sent: string[] = [];
  const provider = {
    request: async ({ params }) => {
      sent.push((params as [{ data: string }])[0].data);
      return `0x${word(123n)}${word(0n)}`;
    },
  } as Eip1193Provider;
  const pv = previewWithdrawFor(provider, (sym) =>
    sym === 'WBTC' ? { token, decimals: 8 } : null,
  );
  expect(await pv({ addr: pool }, 'WBTC', 0.01000001)).toBe(123n);
  // previewWithdraw(address,uint256): the share word is 1_000_001 raw (8 decimals), not 0.01.
  expect(sent[0].slice(-64)).toBe(word(1_000_001n));
  expect(await pv({ addr: pool }, 'USDC', 1)).toBeNull();
  expect(await pv({}, 'WBTC', 1)).toBeNull();
});
