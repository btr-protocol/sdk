/**
 * EIP-2930 access lists for outgoing transactions.
 *
 * Monad prices a cold account at ~10,100 gas and a cold storage slot at ~8,100; a listed entry
 * costs 2,400 / 1,900 and is warm afterwards. Monad also bills the gas LIMIT, not gas used, so the
 * saving is real only when the limit comes from an estimate made WITH the list. Measured on
 * chain 143: Pool.withdraw 846,559 -> 443,906, depositMin 935,121 -> 475,425, a USDC approve
 * 87,643 -> 57,926, but a WMON approve 52,699 -> 48,596 (not worth the margin: skipped).
 *
 * `withAccessList` asks the node for the list, estimates the call with and without it, and returns
 * the tx WITH `accessList` (and a reduced `gas`) only when that is cheaper. It never throws and
 * never waits past its deadline: any failure returns the tx unchanged.
 *
 * The node is not trusted with the bill. Its estimates must pass a floor, the list a cost cap, the
 * limit is capped at the plain estimate, and a REDUCED limit is used only after a second, independent
 * estimate agrees. Only the LIST is cached; every gas figure is re-estimated per call.
 */

import { estimateGas, getChainIdMemo } from './rpc';
import type { AccessListEntry, Address, Eip1193Provider, Hex, TransactionRequest } from './types';

/** Fields that decide gas: the rest of a TransactionRequest (fees, nonce) does not. */
export type AccessListTx = Pick<TransactionRequest, 'from' | 'to' | 'data' | 'value'> &
  Partial<TransactionRequest>;

export interface AccessListOptions {
  /** Chain the tx is for. The provider must report it, else the tx is returned unchanged. */
  chainId: number;
  /** Total budget for the whole lookup, ms. Default 2000, clamped to 50..5000. */
  timeoutMs?: number;
  /** Set `gas` from the with-list estimate. Default true. Pass false when the wallet may drop the
   *  list: a reduced limit without the list would run out of gas. */
  setGas?: boolean;
  /** Headroom over the with-list estimate for the gas limit, percent. Default 30, clamped 0..100. */
  marginPct?: number;
  /** A second, independent endpoint. A REDUCED `gas` is returned only when its with-list estimate is
   *  within 15% of the first; the higher of the two is used. Absent or disagreeing: list only. */
  confirm?: Eip1193Provider;
  /** The route-defining args of the call (tokens, pool, side; never amounts, deadline or floors).
   *  When the exact plan is not ready within `timeoutMs`, the list prefetched for this route (see
   *  `prefetchAccessList`) is attached instead, list only, never with a `gas`. */
  route?: readonly string[];
}

export const MAX_ACCESS_LIST_ADDRESSES = 64;
export const MAX_ACCESS_LIST_KEYS = 512;
const LIST_TTL_MS = 20_000;
const FAIL_TTL_MS = 3_000;
/** The relay serves `eth_createAccessList` only for a call that carries `gas` (<= 30M) and exactly
 *  two params; 5M covers the heaviest call measured (a 935k deposit) with room. */
const LIST_CALL_GAS: Hex = '0x4c4b40';
const ENTRY_ADDR_GAS = 2400n;
const ENTRY_KEY_GAS = 1900n;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const KEY = /^0x[0-9a-fA-F]{64}$/;

/** The list from an RPC reply, duplicates merged, or undefined when its shape or size (after the
 *  merge) is not acceptable. It goes into a signed transaction, so nothing unvalidated passes. */
export function parseAccessList(raw: unknown): AccessListEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ACCESS_LIST_ADDRESSES * 4)
    return undefined;
  const byAddr = new Map<string, { address: Address; keys: Map<string, Hex> }>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') return undefined;
    const { address, storageKeys } = e as { address?: unknown; storageKeys?: unknown };
    if (typeof address !== 'string' || !ADDR.test(address)) return undefined;
    if (!Array.isArray(storageKeys) || storageKeys.length > MAX_ACCESS_LIST_KEYS * 4)
      return undefined;
    let row = byAddr.get(address.toLowerCase());
    if (!row)
      byAddr.set(address.toLowerCase(), (row = { address: address as Address, keys: new Map() }));
    for (const k of storageKeys) {
      if (typeof k !== 'string' || !KEY.test(k)) return undefined;
      row.keys.set(k.toLowerCase(), k as Hex);
    }
  }
  if (byAddr.size > MAX_ACCESS_LIST_ADDRESSES) return undefined;
  let keys = 0;
  const out: AccessListEntry[] = [];
  for (const r of byAddr.values()) {
    keys += r.keys.size;
    if (keys > MAX_ACCESS_LIST_KEYS) return undefined;
    out.push({ address: r.address, storageKeys: [...r.keys.values()] });
  }
  return out;
}

export interface AccessListPlan {
  /** A copy: the caller may keep or change it. */
  accessList: AccessListEntry[];
  /** With-list estimate (the higher of the two when `confirmed`). */
  gasWith: bigint;
  /** Plain estimate. */
  gasWithout: bigint;
  /** A second, independent endpoint agreed: a reduced `gas` may be used. */
  confirmed: boolean;
}

const TIMED_OUT = Symbol('timeout');
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
const clampInt = (v: number | undefined, lo: number, hi: number, d: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? Math.floor(v as number) : d));
export const marginOf = (o: { marginPct?: number }): bigint =>
  BigInt(clampInt(o.marginPct, 0, 100, 30));

/** Intrinsic gas of a call: 21,000 plus 16 per non-zero and 4 per zero calldata byte. */
function intrinsicGas(data: Hex): bigint {
  let g = 21_000n;
  for (let i = 2; i + 1 < data.length + 1; i += 2) g += data.slice(i, i + 2) === '00' ? 4n : 16n;
  return g;
}

/** The relay's figures are plausible: the with-list estimate over its floor, the list's own cost
 *  (2,400 per address, 1,900 per key) at most a quarter of the plain estimate. */
function bounded(list: AccessListEntry[], gasWith: bigint, gasWithout: bigint, data: Hex): boolean {
  const keys = list.reduce((n, e) => n + e.storageKeys.length, 0);
  const cost = ENTRY_ADDR_GAS * BigInt(list.length) + ENTRY_KEY_GAS * BigInt(keys);
  return (
    gasWith >= (gasWithout * 40n) / 100n && gasWith >= intrinsicGas(data) && cost * 4n <= gasWithout
  );
}

const CACHE_MAX = 64;
type Entry = { at: number; ttl: number; list: Promise<AccessListEntry[] | null> };
const cache = new Map<string, Entry>();
const keyOf = (chainId: number, tx: AccessListTx) =>
  [chainId, tx.from, tx.to, tx.data, tx.value ?? '0x0'].map(String).join('|').toLowerCase();

/** Test hook: forget every cached lookup. */
export function clearAccessListCache(): void {
  cache.clear();
}

/** Forget the cached list of one call (its send failed or reverted): the next send re-plans. */
export function dropAccessListPlan(
  tx: AccessListTx,
  chainId: number,
  route?: readonly string[],
): void {
  cache.delete(keyOf(chainId, tx));
  routes.delete(routeKey(chainId, tx, route));
}

const callOf = (tx: AccessListTx): Partial<TransactionRequest> => {
  const call: Partial<TransactionRequest> = { from: tx.from, to: tx.to, data: tx.data };
  if (tx.value !== undefined) call.value = tx.value;
  return call;
};

function listFor(
  p: Eip1193Provider,
  tx: AccessListTx,
  chainId: number,
): Promise<AccessListEntry[] | null> {
  const key = keyOf(chainId, tx);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.list;
  const entry: Entry = {
    at: Date.now(),
    ttl: LIST_TTL_MS,
    list: (
      p.request({
        method: 'eth_createAccessList',
        params: [{ ...callOf(tx), gas: LIST_CALL_GAS }, 'latest'],
      }) as Promise<{
        accessList?: unknown;
        error?: unknown;
      } | null>
    ).then(
      // A list built from a reverting run is a list for the revert, not for the call.
      (r) => (!r || r.error ? null : (parseAccessList(r.accessList) ?? null)),
      () => null,
    ),
  };
  entry.list.then((l) => {
    if (!l) entry.ttl = FAIL_TTL_MS;
  });
  cache.set(key, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return entry.list;
}

async function lookup(
  p: Eip1193Provider,
  tx: AccessListTx,
  opts: AccessListOptions,
  margin: bigint,
): Promise<AccessListPlan | null> {
  if ((await getChainIdMemo(p)) !== opts.chainId) return null;
  const call = callOf(tx);
  const [list, gasWithout] = await Promise.all([
    listFor(p, tx, opts.chainId),
    estimateGas(p, call),
  ]);
  if (!list) return null;
  let gasWith = await estimateGas(p, { ...call, accessList: list });

  // The relay supplied all three figures: bound each.
  if (!bounded(list, gasWith, gasWithout, tx.data as Hex)) return null;

  let confirmed = false;
  if (opts.confirm && opts.confirm !== p) {
    try {
      if ((await getChainIdMemo(opts.confirm)) === opts.chainId) {
        const second = await estimateGas(opts.confirm, { ...call, accessList: list });
        const hi = second > gasWith ? second : gasWith;
        const lo = second > gasWith ? gasWith : second;
        if (lo > 0n && (hi - lo) * 100n <= hi * 15n) {
          gasWith = hi;
          confirmed = true;
        }
      }
    } catch {
      /* no second opinion: list only */
    }
  }
  // Compare what would be BILLED (the limit with its margin) against the plain estimate.
  if (gasWith + (gasWith * margin) / 100n >= gasWithout) return null;
  return {
    accessList: list.map((e) => ({ address: e.address, storageKeys: [...e.storageKeys] })),
    gasWith,
    gasWithout,
    confirmed,
  };
}

type Planned = { plan: AccessListPlan | null; unknown: boolean };

/** The exact-call plan when the list is cheaper, else null; `unknown` when the lookup did not
 *  finish in time or failed (as opposed to deciding "not worth it"). Never throws. The list is
 *  cached briefly; gas is re-estimated on every call. A tx that already has a `gas` is left alone. */
async function planState(
  provider: Eip1193Provider,
  tx: AccessListTx,
  opts: AccessListOptions,
): Promise<Planned> {
  try {
    if (tx.gas !== undefined || !tx.to || !tx.data || tx.data === '0x')
      return { plan: null, unknown: false };
    const run = lookup(provider, tx, opts, marginOf(opts));
    run.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMED_OUT>((r) => {
      timer = setTimeout(() => r(TIMED_OUT), clampInt(opts.timeoutMs, 50, 5000, 2000));
    });
    try {
      const r = await Promise.race([run, late]);
      return r === TIMED_OUT ? { plan: null, unknown: true } : { plan: r, unknown: false };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { plan: null, unknown: true };
  }
}

export async function planAccessList(
  provider: Eip1193Provider,
  tx: AccessListTx,
  opts: AccessListOptions,
): Promise<AccessListPlan | null> {
  return (await planState(provider, tx, opts)).plan;
}

/** Warm the exact-call list cache for `tx` (calldata final, send imminent). Fire and forget. */
export function warmAccessList(provider: Eip1193Provider, tx: AccessListTx, chainId: number): void {
  void getChainIdMemo(provider)
    .then((c) =>
      c === chainId && !tx.gas && tx.to && tx.data && tx.data !== '0x'
        ? listFor(provider, tx, chainId)
        : null,
    )
    .catch(() => {});
}

// ── Route lists ─────────────────────────────────────────────────────────────
// The touched accounts and slots of a call depend on WHO calls WHAT on WHICH route, not on the
// amount, the deadline or the floors (measured: deposit and withdraw return the identical list for
// 1, 2 and 5 USDC and for different deadlines). So the list is fetched when the preview renders,
// under a route key, and a click whose exact plan is not ready yet attaches it, list only.

const ROUTE_TTL_MS = 60_000;
const ROUTE_THROTTLE_MS = 15_000;
type Route = { at: number; tried: number; list: AccessListEntry[] | null };
const routes = new Map<string, Route>();

/** The address-shaped words of calldata, in order: tokens, pools, spenders, recipients. A word
 *  counts when it is >= 2^96 and < 2^160, which no amount, deadline, floor, offset or length of
 *  this protocol reaches (a max-uint approval is 2^256-1, above the range). The preview and the
 *  click build their calldata with the same builder, so both derive the same route here. */
export function routeArgsOf(data: string | undefined): string[] {
  const out: string[] = [];
  const body = (data ?? '').slice(10);
  for (let i = 0; i + 64 <= body.length; i += 64) {
    const w = body.slice(i, i + 64);
    if (/^0{24}[0-9a-fA-F]{40}$/.test(w) && !/^0{40}/.test(w))
      out.push(`0x${w.slice(24).toLowerCase()}`);
  }
  return out;
}

/** Cache key of a route: chain, caller, target, selector and the address words of the calldata
 *  (plus any extra route args the caller names). Never the amounts, deadline or floors. */
export const routeKey = (chainId: number, tx: AccessListTx, extra: readonly string[] = []) =>
  [chainId, tx.from, tx.to, (tx.data ?? '').slice(0, 10), ...routeArgsOf(tx.data), '#', ...extra]
    .map(String)
    .join('|')
    .toLowerCase();

export interface PrefetchOptions {
  chainId: number;
  route?: readonly string[];
  /** Bypass the 15 s throttle (the state just changed: an approve mined). */
  force?: boolean;
  marginPct?: number;
}

/**
 * Fetch and keep the list for a PREVIEW call (final-shaped calldata, placeholder deadline/floors)
 * under its route key. At most 2 relay requests (list + plain estimate batched, then the with-list
 * estimate), at most one attempt per key per 15 s unless `force`. A list is kept only when it passes
 * the same tests as an exact plan; a preview that reverts (allowance short, halted leg) REMOVES any
 * earlier list for the key: a list from a reverting run is never used. Never throws.
 */
export async function prefetchAccessList(
  provider: Eip1193Provider,
  preview: AccessListTx,
  opts: PrefetchOptions,
): Promise<void> {
  try {
    if (preview.gas !== undefined || !preview.to || !preview.data || preview.data === '0x') return;
    const key = routeKey(opts.chainId, preview, opts.route);
    const prev = routes.get(key);
    const now = Date.now();
    if (prev && !opts.force && now - prev.tried < ROUTE_THROTTLE_MS) return;
    const entry: Route = {
      at: now,
      tried: now,
      list: prev && now - prev.at < ROUTE_TTL_MS ? prev.list : null,
    };
    routes.set(key, entry);
    if (routes.size > CACHE_MAX) routes.delete(routes.keys().next().value as string);
    if ((await getChainIdMemo(provider)) !== opts.chainId) return void (entry.list = null);
    const call = callOf(preview);
    const [created, gasWithout] = await Promise.all([
      provider.request({
        method: 'eth_createAccessList',
        params: [{ ...call, gas: LIST_CALL_GAS }, 'latest'],
      }) as Promise<{ accessList?: unknown; error?: unknown } | null>,
      estimateGas(provider, call),
    ]);
    const list = !created || created.error ? undefined : parseAccessList(created.accessList);
    if (!list) return void (entry.list = null);
    const gasWith = await estimateGas(provider, { ...call, accessList: list });
    const m = marginOf(opts);
    const worth =
      bounded(list, gasWith, gasWithout, preview.data) &&
      gasWith + (gasWith * m) / 100n < gasWithout;
    entry.list = worth ? list : null;
    entry.at = Date.now();
  } catch {
    /* a failed prefetch leaves the click to its own lookup */
  }
}

function routeList(tx: AccessListTx, opts: AccessListOptions): AccessListEntry[] | undefined {
  const r = routes.get(routeKey(opts.chainId, tx, opts.route));
  if (!r?.list || Date.now() - r.at >= ROUTE_TTL_MS) return undefined;
  return r.list.map((e) => ({ address: e.address, storageKeys: [...e.storageKeys] }));
}

/** Test hook. */
export function clearRouteCache(): void {
  routes.clear();
}

/**
 * `tx` with `accessList` when that is cheaper than without; otherwise `tx` itself. Reduced `gas`
 * (min of with-list estimate + margin and the 60% floor logic) only from a CONFIRMED exact plan and
 * unless `setGas: false`. When the exact plan is not ready in time (or failed) and `opts.route` has a
 * fresh prefetched list, that list is attached with NO `gas`. `provider` is the read endpoint, not
 * necessarily the wallet.
 */
export async function withAccessList<T extends AccessListTx>(
  provider: Eip1193Provider,
  tx: T,
  opts: AccessListOptions,
): Promise<T & Pick<TransactionRequest, 'accessList' | 'gas'>> {
  const { plan, unknown } = await planState(provider, tx, opts);
  if (!plan) {
    const list = unknown ? routeList(tx, opts) : undefined;
    return list ? { ...tx, accessList: list } : tx;
  }
  const out: T & Pick<TransactionRequest, 'accessList' | 'gas'> = {
    ...tx,
    accessList: plan.accessList,
  };
  if (opts.setGas !== false && plan.confirmed) {
    // Never below 60% of the plain estimate, however low the estimates claim to be; the plan's
    // margin check already guarantees the result is under the plain estimate.
    const limit = plan.gasWith + (plan.gasWith * marginOf(opts)) / 100n;
    const floor = (plan.gasWithout * 60n) / 100n;
    out.gas = hex(limit > floor ? limit : floor);
  }
  return out;
}
