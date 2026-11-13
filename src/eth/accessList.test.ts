import { beforeEach, describe, expect, test } from 'bun:test';
import {
  MAX_ACCESS_LIST_ADDRESSES,
  MAX_ACCESS_LIST_KEYS,
  clearAccessListCache,
  parseAccessList,
  withAccessList,
} from './accessList';
import type { Eip1193Provider } from './types';

const A = `0x${'ab'.repeat(20)}` as const;
const K = `0x${'cd'.repeat(32)}` as const;
const tx = { from: A, to: A, data: '0x1234' as const };
const LIST = [{ address: A, storageKeys: [K] }];

type Handler = (params: unknown[]) => unknown;
function mock(h: Partial<Record<string, Handler>>, chain = 143) {
  const calls: { method: string; params: unknown[] }[] = [];
  const p: Eip1193Provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push({ method, params: params ?? [] });
      if (method === 'eth_chainId') return `0x${chain.toString(16)}`;
      const f = h[method];
      if (!f) throw new Error(`unsupported ${method}`);
      return f(params ?? []);
    },
  } as Eip1193Provider;
  return { p, calls };
}
const est =
  (without: number, withList: number): Handler =>
  (params) =>
    `0x${((params[0] as { accessList?: unknown }).accessList ? withList : without).toString(16)}`;
const opts = { chainId: 143 };

beforeEach(clearAccessListCache);

describe('withAccessList', () => {
  test('cheaper: attaches list and a gas limit from the with-list estimate + 20%', async () => {
    const { p } = mock({
      eth_createAccessList: () => ({ accessList: LIST, gasUsed: '0x1' }),
      eth_estimateGas: est(1000, 500),
    });
    const out = await withAccessList(p, tx, opts);
    expect(out.accessList).toEqual(LIST);
    expect(BigInt(out.gas as string)).toBe(600n);
  });

  test('setGas:false attaches the list only', async () => {
    const { p } = mock({
      eth_createAccessList: () => ({ accessList: LIST }),
      eth_estimateGas: est(1000, 500),
    });
    const out = await withAccessList(p, tx, { ...opts, setGas: false });
    expect(out.accessList).toEqual(LIST);
    expect(out.gas).toBeUndefined();
  });

  test('a gas the caller set is kept', async () => {
    const { p } = mock({
      eth_createAccessList: () => ({ accessList: LIST }),
      eth_estimateGas: est(1000, 500),
    });
    expect((await withAccessList(p, { ...tx, gas: '0x99' as const }, opts)).gas).toBe('0x99');
  });

  test('dearer, or cheaper by less than the margin: unchanged', async () => {
    for (const [without, withList] of [
      [100, 150],
      [1000, 900],
    ]) {
      clearAccessListCache();
      const { p } = mock({
        eth_createAccessList: () => ({ accessList: LIST }),
        eth_estimateGas: est(without, withList),
      });
      expect(await withAccessList(p, tx, opts)).toBe(tx);
    }
  });

  test('createAccessList unsupported, erroring or reporting a revert: unchanged', async () => {
    const a = mock({ eth_estimateGas: est(1000, 500) });
    expect(await withAccessList(a.p, tx, opts)).toBe(tx);
    clearAccessListCache();
    const b = mock({
      eth_createAccessList: () => ({ accessList: LIST, error: 'execution reverted' }),
      eth_estimateGas: est(1000, 500),
    });
    expect(await withAccessList(b.p, tx, opts)).toBe(tx);
    clearAccessListCache();
    const c = mock({
      eth_createAccessList: () => {
        throw new Error('boom');
      },
      eth_estimateGas: est(1000, 500),
    });
    expect(await withAccessList(c.p, tx, opts)).toBe(tx);
  });

  test('estimate failure: unchanged', async () => {
    const { p } = mock({ eth_createAccessList: () => ({ accessList: LIST }) });
    expect(await withAccessList(p, tx, opts)).toBe(tx);
  });

  test('timeout: unchanged, within the deadline', async () => {
    const { p } = mock({
      eth_createAccessList: () => new Promise(() => {}),
      eth_estimateGas: est(1000, 500),
    });
    const t0 = Date.now();
    expect(await withAccessList(p, tx, { ...opts, timeoutMs: 50 })).toBe(tx);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test('wrong chain: unchanged and nothing asked', async () => {
    const { p, calls } = mock(
      { eth_createAccessList: () => ({ accessList: LIST }), eth_estimateGas: est(1000, 500) },
      1,
    );
    expect(await withAccessList(p, tx, opts)).toBe(tx);
    expect(calls.some((c) => c.method === 'eth_createAccessList')).toBe(false);
  });

  test('malformed results: unchanged', async () => {
    for (const bad of [
      null,
      { accessList: 'x' },
      { accessList: [] },
      { accessList: [{ address: '0x12', storageKeys: [] }] },
      { accessList: [{ address: A, storageKeys: ['0x12'] }] },
      { accessList: [{ address: A }] },
      { accessList: [null] },
    ]) {
      clearAccessListCache();
      const { p } = mock({ eth_createAccessList: () => bad, eth_estimateGas: est(1000, 500) });
      expect(await withAccessList(p, tx, opts)).toBe(tx);
    }
  });

  test('no calldata (plain transfer): unchanged, nothing asked', async () => {
    const { p, calls } = mock({});
    const t = { from: A, to: A };
    expect(await withAccessList(p, t, opts)).toBe(t);
    expect(calls.length).toBe(0);
  });

  test('cached: a second call with the same tx does not re-ask', async () => {
    const { p, calls } = mock({
      eth_createAccessList: () => ({ accessList: LIST }),
      eth_estimateGas: est(1000, 500),
    });
    await withAccessList(p, tx, opts);
    const n = calls.length;
    const again = await withAccessList(p, tx, opts);
    expect(calls.length).toBe(n);
    expect(again.accessList).toEqual(LIST);
    // another calldata is a different lookup
    await withAccessList(p, { ...tx, data: '0x5678' as const }, opts);
    expect(calls.length).toBeGreaterThan(n);
  });

  test('a failure is cached too (a retry does not re-ask)', async () => {
    const { p, calls } = mock({ eth_estimateGas: est(1000, 500) });
    await withAccessList(p, tx, opts);
    const n = calls.length;
    await withAccessList(p, tx, opts);
    expect(calls.length).toBe(n);
  });
});

describe('parseAccessList caps', () => {
  const entry = (i: number, keys = 0) => ({
    address: `0x${i.toString(16).padStart(40, '0')}`,
    storageKeys: Array.from({ length: keys }, () => K),
  });
  test('addresses', () => {
    expect(
      parseAccessList(Array.from({ length: MAX_ACCESS_LIST_ADDRESSES }, (_, i) => entry(i))),
    ).toHaveLength(MAX_ACCESS_LIST_ADDRESSES);
    expect(
      parseAccessList(Array.from({ length: MAX_ACCESS_LIST_ADDRESSES + 1 }, (_, i) => entry(i))),
    ).toBeUndefined();
  });
  test('storage keys in total', () => {
    expect(parseAccessList([entry(1, MAX_ACCESS_LIST_KEYS)])).toBeDefined();
    expect(parseAccessList([entry(1, MAX_ACCESS_LIST_KEYS), entry(2, 1)])).toBeUndefined();
  });
});
