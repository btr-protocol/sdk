import { beforeEach, describe, expect, test } from 'bun:test';
import {
  MAX_ACCESS_LIST_ADDRESSES,
  MAX_ACCESS_LIST_KEYS,
  clearAccessListCache,
  clearRouteCache,
  dropAccessListPlan,
  parseAccessList,
  prefetchAccessList,
  routeArgsOf,
  routeKey,
  withAccessList,
} from './accessList';
import { forgetChainId } from './rpc';
import type { Eip1193Provider } from './types';

const A = `0x${'ab'.repeat(20)}` as const;
const B = `0x${'11'.repeat(20)}` as const;
const K = `0x${'cd'.repeat(32)}` as const;
const tx = { from: A, to: A, data: '0x1234' as const };
const LIST = [{ address: A, storageKeys: [K] }];

type Handler = (params: unknown[]) => unknown;
function mock(h: Partial<Record<string, Handler>>, chain: { id: number } = { id: 143 }) {
  const calls: { method: string; params: unknown[] }[] = [];
  const p: Eip1193Provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push({ method, params: params ?? [] });
      if (method === 'eth_chainId') return `0x${chain.id.toString(16)}`;
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
const good = (without = 100_000, withList = 50_000) => ({
  eth_createAccessList: () => ({ accessList: LIST }),
  eth_estimateGas: est(without, withList),
});
const opts = { chainId: 143 };

beforeEach(() => {
  clearAccessListCache();
  clearRouteCache();
});

describe('withAccessList', () => {
  test('confirmed: list + gas = min(with + 30%, plain)', async () => {
    const { p } = mock(good());
    const { p: second } = mock(good(100_000, 52_000));
    const out = await withAccessList(p, tx, { ...opts, confirm: second });
    expect(out.accessList).toEqual(LIST);
    expect(BigInt(out.gas as string)).toBe(67_600n); // higher estimate 52,000 x 1.3
  });

  test('no independent reader: list only, never a reduced gas', async () => {
    const { p } = mock(good());
    const out = await withAccessList(p, tx, opts);
    expect(out.accessList).toEqual(LIST);
    expect(out.gas).toBeUndefined();
  });

  test('independent estimate disagrees by more than 15%, or fails: list only', async () => {
    for (const second of [mock(good(100_000, 70_000)).p, mock({ eth_chainId: undefined }).p]) {
      clearAccessListCache();
      const out = await withAccessList(mock(good()).p, tx, { ...opts, confirm: second });
      expect(out.accessList).toEqual(LIST);
      expect(out.gas).toBeUndefined();
    }
  });

  test('setGas:false attaches the list only', async () => {
    const out = await withAccessList(mock(good()).p, tx, {
      ...opts,
      setGas: false,
      confirm: mock(good()).p,
    });
    expect(out.accessList).toEqual(LIST);
    expect(out.gas).toBeUndefined();
  });

  test('a caller-set gas skips the list entirely', async () => {
    const { p, calls } = mock(good());
    const t = { ...tx, gas: '0x99' as const };
    expect(await withAccessList(p, t, opts)).toBe(t);
    expect(calls.length).toBe(0);
  });

  test('relay returns a tiny with-list estimate: no plan', async () => {
    const { p } = mock(good(100_000, 5_000));
    expect(await withAccessList(p, tx, opts)).toBe(tx);
  });

  test('below intrinsic gas of the calldata: no plan', async () => {
    const { p } = mock(good(30_000, 12_000)); // 40% floor is 12,000 but intrinsic is 21,000+
    expect(await withAccessList(p, tx, opts)).toBe(tx);
  });

  test('list cost over 25% of the plain estimate: no plan', async () => {
    const big = Array.from({ length: 20 }, (_, i) => ({
      address: `0x${i.toString(16).padStart(40, '0')}`,
      storageKeys: [K],
    }));
    // 20 x (2,400 + 1,900) = 86,000 > 25% of 300,000
    const { p } = mock({
      eth_createAccessList: () => ({ accessList: big }),
      eth_estimateGas: est(300_000, 150_000),
    });
    expect(await withAccessList(p, tx, opts)).toBe(tx);
  });

  test('dearer, or cheaper by less than the margin: unchanged', async () => {
    for (const [without, withList] of [
      [100_000, 150_000],
      [100_000, 90_000],
    ]) {
      clearAccessListCache();
      expect(await withAccessList(mock(good(without, withList)).p, tx, opts)).toBe(tx);
    }
  });

  test('equal-margin boundary: with x 1.3 == plain is refused, one gas less is taken', async () => {
    expect(await withAccessList(mock(good(65_000, 50_000)).p, tx, opts)).toBe(tx);
    clearAccessListCache();
    expect((await withAccessList(mock(good(65_001, 50_000)).p, tx, opts)).accessList).toEqual(LIST);
  });

  test('createAccessList unsupported, erroring or reporting a revert: unchanged', async () => {
    expect(await withAccessList(mock({ eth_estimateGas: est(100_000, 50_000) }).p, tx, opts)).toBe(
      tx,
    );
    clearAccessListCache();
    const b = mock({
      eth_createAccessList: () => ({ accessList: LIST, error: 'execution reverted' }),
      eth_estimateGas: est(100_000, 50_000),
    });
    expect(await withAccessList(b.p, tx, opts)).toBe(tx);
  });

  test('estimate failure: unchanged', async () => {
    const { p } = mock({ eth_createAccessList: () => ({ accessList: LIST }) });
    expect(await withAccessList(p, tx, opts)).toBe(tx);
  });

  test('timeout: unchanged, within the deadline', async () => {
    const { p } = mock({
      eth_createAccessList: () => new Promise(() => {}),
      eth_estimateGas: est(100_000, 50_000),
    });
    const t0 = Date.now();
    expect(await withAccessList(p, tx, { ...opts, timeoutMs: 1 })).toBe(tx); // clamped to 50
    expect(Date.now() - t0).toBeLessThan(500);
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
      const { p } = mock({
        eth_createAccessList: () => bad,
        eth_estimateGas: est(100_000, 50_000),
      });
      expect(await withAccessList(p, tx, opts)).toBe(tx);
    }
  });

  test('no calldata (plain transfer): unchanged, nothing asked', async () => {
    const { p, calls } = mock({});
    const t = { from: A, to: A };
    expect(await withAccessList(p, t, opts)).toBe(t);
    expect(calls.length).toBe(0);
  });

  test('the list is cached, the gas is not: a second send re-estimates but does not re-ask the list', async () => {
    const { p, calls } = mock(good());
    await withAccessList(p, tx, opts);
    const lists = () => calls.filter((c) => c.method === 'eth_createAccessList').length;
    const gas = () => calls.filter((c) => c.method === 'eth_estimateGas').length;
    expect([lists(), gas()]).toEqual([1, 2]);
    await withAccessList(p, tx, opts);
    expect([lists(), gas()]).toEqual([1, 4]);
    await withAccessList(p, { ...tx, data: '0x5678' as const }, opts);
    expect(lists()).toBe(2);
  });

  test('a failure is cached only briefly; a dropped plan is re-asked', async () => {
    const { p, calls } = mock({ eth_estimateGas: est(100_000, 50_000) });
    await withAccessList(p, tx, opts);
    await withAccessList(p, tx, opts);
    const n = () => calls.filter((c) => c.method === 'eth_createAccessList').length;
    expect(n()).toBe(1); // within 3 s: not re-asked
    dropAccessListPlan(tx, 143);
    await withAccessList(p, tx, opts);
    expect(n()).toBe(2);
  });

  test('keys separate by chain and by account', async () => {
    const { p, calls } = mock(good());
    await withAccessList(p, tx, opts);
    await withAccessList(p, { ...tx, from: B }, opts);
    expect(calls.filter((c) => c.method === 'eth_createAccessList').length).toBe(2);
    const other = mock(good(), { id: 1 });
    expect(await withAccessList(other.p, tx, { chainId: 1 })).not.toBe(tx);
    expect(other.calls.filter((c) => c.method === 'eth_createAccessList').length).toBe(1);
  });

  test('chain switch between plan and use: the cached list is not used on the other chain', async () => {
    const chain = { id: 143 };
    const { p, calls } = mock(good(), chain);
    expect((await withAccessList(p, tx, opts)).accessList).toEqual(LIST);
    chain.id = 1;
    forgetChainId(p); // what onChainChanged does
    const n = calls.length;
    expect(await withAccessList(p, tx, opts)).toBe(tx);
    expect(calls.slice(n).some((c) => c.method === 'eth_estimateGas')).toBe(false);
  });

  test('createAccessList carries gas and exactly two params; one lookup makes at most 3 relay calls', async () => {
    const { p, calls } = mock(good());
    await withAccessList(p, tx, { ...opts, confirm: mock(good()).p });
    const create = calls.filter((c) => c.method === 'eth_createAccessList');
    expect(create).toHaveLength(1);
    expect(create[0].params).toHaveLength(2);
    expect(BigInt((create[0].params[0] as { gas: string }).gas)).toBeLessThanOrEqual(30_000_000n);
    expect(
      calls.filter((c) => ['eth_createAccessList', 'eth_estimateGas'].includes(c.method)),
    ).toHaveLength(3);
  });

  test('a reduced limit is never below 60% of the plain estimate', async () => {
    // with-list 40,000 x 1.3 = 52,000 < 60,000 = 60% of 100,000
    const out = await withAccessList(mock(good(100_000, 40_000)).p, tx, {
      ...opts,
      confirm: mock(good(100_000, 40_000)).p,
    });
    expect(BigInt(out.gas as string)).toBe(60_000n);
  });

  test('the returned list is a copy', async () => {
    const { p } = mock(good());
    const a = await withAccessList(p, tx, opts);
    a.accessList?.[0].storageKeys.push(K);
    const b = await withAccessList(p, tx, opts);
    expect(b.accessList?.[0].storageKeys).toHaveLength(1);
  });
});

describe('parseAccessList', () => {
  const entry = (i: number, keys = 0) => ({
    address: `0x${i.toString(16).padStart(40, '0')}`,
    storageKeys: Array.from({ length: keys }, (_, j) => `0x${j.toString(16).padStart(64, '0')}`),
  });
  test('addresses cap', () => {
    expect(
      parseAccessList(Array.from({ length: MAX_ACCESS_LIST_ADDRESSES }, (_, i) => entry(i + 1))),
    ).toHaveLength(MAX_ACCESS_LIST_ADDRESSES);
    expect(
      parseAccessList(
        Array.from({ length: MAX_ACCESS_LIST_ADDRESSES + 1 }, (_, i) => entry(i + 1)),
      ),
    ).toBeUndefined();
  });
  test('storage keys cap in total', () => {
    expect(parseAccessList([entry(1, MAX_ACCESS_LIST_KEYS)])).toBeDefined();
    expect(parseAccessList([entry(1, MAX_ACCESS_LIST_KEYS), entry(2, 1)])).toBeUndefined();
  });
  test('duplicates merge before the caps', () => {
    const dup = Array.from({ length: 200 }, () => entry(1, 2));
    const out = parseAccessList(dup);
    expect(out).toHaveLength(1);
    expect(out?.[0].storageKeys).toHaveLength(2);
  });
});

describe('route lists', () => {
  const word = (n: bigint) => n.toString(16).padStart(64, '0');
  const addr = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');
  /** selector + token + amount + deadline, as a builder would emit it */
  const mk = (token: string, amount: bigint, deadline: bigint) =>
    `0xdeadbeef${addr(token)}${word(amount)}${word(deadline)}` as `0x${string}`;
  const preview = { ...tx, data: mk(A, 1_000_000n, 1_800_000_000n) };
  const click = { ...tx, data: mk(A, 2_000_000n, 1_800_000_777n) }; // other amount and deadline
  const stuck = () => ({
    eth_createAccessList: () => new Promise(() => {}),
    eth_estimateGas: est(100_000, 50_000),
  });
  const count = (calls: { method: string }[], m: string) =>
    calls.filter((c) => c.method === m).length;
  const rt = { chainId: 143 };

  test('route args are the address-shaped words only', () => {
    expect(routeArgsOf(preview.data)).toEqual([A]);
    expect(routeArgsOf(`0xaabbccdd${word(2n ** 256n - 1n)}${word(1n)}`)).toEqual([]);
  });

  test('a click whose exact plan is late attaches the prefetched list, list only, never gas', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const out = await withAccessList(mock(stuck()).p, click, {
      ...opts,
      timeoutMs: 60,
      confirm: mock(good()).p,
    });
    expect(out.accessList).toEqual(LIST);
    expect(out.gas).toBeUndefined();
  });

  test('the exact plan wins when it is ready', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const out = await withAccessList(mock(good(100_000, 40_000)).p, click, {
      ...opts,
      confirm: mock(good(100_000, 40_000)).p,
    });
    expect(BigInt(out.gas as string)).toBe(60_000n);
  });

  test('an exact plan that says "not worth it" is not overridden by the route list', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    expect(await withAccessList(mock(good(100_000, 99_000)).p, click, opts)).toBe(click);
  });

  test('a preview that failed the worth test is not attached', async () => {
    await prefetchAccessList(mock(good(100_000, 99_000)).p, preview, rt);
    expect(await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).toBe(click);
  });

  test('a reverting preview is never kept, and removes an earlier list', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const reverting = mock({
      eth_createAccessList: () => ({ accessList: LIST, error: 'execution reverted' }),
      eth_estimateGas: est(100_000, 50_000),
    });
    await prefetchAccessList(reverting.p, preview, { ...rt, force: true });
    expect(await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).toBe(click);
  });

  test('approve then action: a preview made while the allowance is short caches nothing; the forced post-approve one does', async () => {
    const short = mock({
      eth_createAccessList: () => ({ accessList: LIST, error: 'execution reverted' }),
      eth_estimateGas: est(100_000, 50_000),
    });
    await prefetchAccessList(short.p, preview, rt);
    expect(await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).toBe(click);
    await prefetchAccessList(mock(good()).p, preview, { ...rt, force: true }); // approve mined
    expect(
      (await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).accessList,
    ).toEqual(LIST);
  });

  test('throttle: one attempt per key per 15 s unless forced; at most 2 relay requests', async () => {
    const m = mock(good());
    await prefetchAccessList(m.p, preview, rt);
    await prefetchAccessList(m.p, click, rt); // same route, other amount: throttled
    expect(count(m.calls, 'eth_createAccessList')).toBe(1);
    expect(count(m.calls, 'eth_estimateGas')).toBe(2);
    await prefetchAccessList(m.p, preview, { ...rt, force: true });
    expect(count(m.calls, 'eth_createAccessList')).toBe(2);
  });

  test('keys separate by account, chain, target, token and selector; amounts and deadlines do not matter', () => {
    const k = (t: object, c = 143) => routeKey(c, { ...preview, ...t });
    expect(k({})).toBe(k({ data: click.data }));
    expect(k({})).not.toBe(k({ from: B }));
    expect(k({})).not.toBe(k({ to: B }));
    expect(k({})).not.toBe(k({}, 1));
    expect(k({})).not.toBe(k({ data: mk(B, 1_000_000n, 1_800_000_000n) }));
    expect(k({})).not.toBe(
      k({ data: preview.data.replace('deadbeef', 'cafebabe') as `0x${string}` }),
    );
  });

  test('a route list for another account or chain is not attached', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const other = { ...click, from: B };
    expect(await withAccessList(mock(stuck()).p, other, { ...opts, timeoutMs: 60 })).toBe(other);
    expect(
      await withAccessList(mock(stuck(), { id: 1 }).p, click, { chainId: 1, timeoutMs: 60 }),
    ).toBe(click);
  });

  test('expires after 60 s', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const real = Date.now;
    Date.now = () => real() + 61_000;
    try {
      expect(await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).toBe(click);
    } finally {
      Date.now = real;
    }
  });

  test('a failed refresh does not extend a stale list: the 60 s TTL holds', async () => {
    await prefetchAccessList(mock(good()).p, preview, rt);
    const real = Date.now;
    const t0 = real();
    try {
      Date.now = () => t0 + 30_000;
      const down = mock({}); // every call fails
      await prefetchAccessList(down.p, preview, { ...rt, force: true });
      expect(
        (await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).accessList,
      ).toEqual(LIST); // still served at 30 s
      Date.now = () => t0 + 61_000;
      await prefetchAccessList(down.p, preview, { ...rt, force: true });
      expect(await withAccessList(mock(stuck()).p, click, { ...opts, timeoutMs: 60 })).toBe(click);
    } finally {
      Date.now = real;
    }
  });

  test("a click whose own plain estimate is under half the preview's does not take the route list", async () => {
    await prefetchAccessList(mock(good(100_000, 50_000)).p, preview, rt);
    const cheap = mock({
      eth_createAccessList: () => new Promise(() => {}),
      eth_estimateGas: est(30_000, 15_000),
    });
    expect(await withAccessList(cheap.p, click, { ...opts, timeoutMs: 80 })).toBe(click);
    clearAccessListCache(); // forget the click's plain estimate
    const alike = mock({
      eth_createAccessList: () => new Promise(() => {}),
      eth_estimateGas: est(60_000, 30_000),
    });
    expect((await withAccessList(alike.p, click, { ...opts, timeoutMs: 80 })).accessList).toEqual(
      LIST,
    );
  });

  test('an explicit route is the key: a huge amount does not change it; the heuristic fallback would', () => {
    const huge = { ...preview, data: mk(A, 2n ** 100n, 1_800_000_000n) };
    const r = [A.toLowerCase()];
    expect(routeKey(143, preview, r)).toBe(routeKey(143, huge, r));
    expect(routeKey(143, preview)).not.toBe(routeKey(143, huge)); // the amount reads as an address
    expect(routeKey(143, preview, r)).not.toBe(routeKey(143, preview, [B]));
  });
});
