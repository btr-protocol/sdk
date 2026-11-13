import { expect, test } from 'bun:test';
import type { Eip1193Provider } from '../eth/types';
import { getPoolSolvency } from './index';

const pool = '0x1111111111111111111111111111111111111111' as const;
const word = (n: bigint) => n.toString(16).padStart(64, '0');

test.each([0n, 10n ** 17n])(
  'poolSolvencyWad exposes raw toll %p from the same call',
  async (toll) => {
    const provider = {
      request: async ({ method, params }) => {
        expect(method).toBe('eth_call');
        expect(params).toEqual([expect.objectContaining({ to: pool }), 'latest']);
        return `0x${word(10n ** 18n)}${word(1n)}${word(toll)}`;
      },
    } as Eip1193Provider;
    expect(await getPoolSolvency(provider, pool)).toEqual({
      cWad: 10n ** 18n,
      ok: true,
      exitTollWad: toll,
    });
  },
);
