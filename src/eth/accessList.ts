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
 */

import { estimateGas, getChainId } from './rpc';
import type { AccessListEntry, Address, Eip1193Provider, Hex, TransactionRequest } from './types';

/** Fields that decide gas: the rest of a TransactionRequest (fees, nonce) does not. */
export type AccessListTx = Pick<TransactionRequest, 'from' | 'to' | 'data' | 'value'> &
  Partial<TransactionRequest>;

export interface AccessListOptions {
  /** Chain the tx is for. The provider must report it, else the tx is returned unchanged. */
  chainId: number;
  /** Total budget for the whole lookup (list + both estimates), ms. Default 2000. */
  timeoutMs?: number;
  /** Set `gas` from the with-list estimate. Default true. Pass false when the wallet may drop the
   *  list: a reduced limit without the list would run out of gas. */
  setGas?: boolean;
  /** Headroom over the with-list estimate for the gas limit, in percent. Default 20. */
  marginPct?: number;
  /** How long a lookup stays cached for the same (chain, from, to, data, value), ms. Default 20000. */
  cacheMs?: number;
}

export const MAX_ACCESS_LIST_ADDRESSES = 64;
export const MAX_ACCESS_LIST_KEYS = 512;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const KEY = /^0x[0-9a-fA-F]{64}$/;

/** The list from an RPC reply, or undefined when its shape or size is not acceptable. It goes into
 *  a signed transaction, so nothing unvalidated passes. */
export function parseAccessList(raw: unknown): AccessListEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ACCESS_LIST_ADDRESSES)
    return undefined;
  let keys = 0;
  const out: AccessListEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') return undefined;
    const { address, storageKeys } = e as { address?: unknown; storageKeys?: unknown };
    if (typeof address !== 'string' || !ADDR.test(address)) return undefined;
    if (!Array.isArray(storageKeys)) return undefined;
    keys += storageKeys.length;
    if (keys > MAX_ACCESS_LIST_KEYS) return undefined;
    for (const k of storageKeys) if (typeof k !== 'string' || !KEY.test(k)) return undefined;
    out.push({ address: address as Address, storageKeys: [...(storageKeys as Hex[])] });
  }
  return out;
}

export interface AccessListPlan {
  accessList: AccessListEntry[];
  /** Gas estimate with the list. */
  gasWith: bigint;
  /** Gas estimate without it. */
  gasWithout: bigint;
}

const TIMED_OUT = Symbol('timeout');
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;

const chainIds = new WeakMap<Eip1193Provider, Promise<number>>();
function chainOf(p: Eip1193Provider): Promise<number> {
  let c = chainIds.get(p);
  if (!c) {
    c = getChainId(p);
    chainIds.set(p, c);
    // A failed read is not a fact about the endpoint: ask again next time.
    c.catch(() => chainIds.delete(p));
  }
  return c;
}

const CACHE_MAX = 64;
const cache = new Map<string, { at: number; plan: Promise<AccessListPlan | null> }>();

/** Test hook: forget every cached lookup. */
export function clearAccessListCache(): void {
  cache.clear();
}

async function lookup(
  p: Eip1193Provider,
  tx: AccessListTx,
  chainId: number,
  margin: bigint,
): Promise<AccessListPlan | null> {
  if ((await chainOf(p)) !== chainId) return null;
  const call: Partial<TransactionRequest> = { from: tx.from, to: tx.to, data: tx.data };
  if (tx.value !== undefined) call.value = tx.value;
  const [created, gasWithout] = await Promise.all([
    p.request({ method: 'eth_createAccessList', params: [call, 'latest'] }) as Promise<{
      accessList?: unknown;
      error?: unknown;
    } | null>,
    estimateGas(p, call),
  ]);
  // A list built from a reverting run is a list for the revert, not for the call.
  if (!created || created.error) return null;
  const accessList = parseAccessList(created.accessList);
  if (!accessList) return null;
  const gasWith = await estimateGas(p, { ...call, accessList });
  // Compare what would be BILLED: the limit with its margin, against the plain estimate.
  if (gasWith <= 0n || gasWith + (gasWith * margin) / 100n >= gasWithout) return null;
  return { accessList, gasWith, gasWithout };
}

/** The list and both estimates when the list is cheaper, else null. Never throws; cached briefly
 *  so a re-render or a retry does not re-ask the node. */
export async function planAccessList(
  provider: Eip1193Provider,
  tx: AccessListTx,
  opts: AccessListOptions,
): Promise<AccessListPlan | null> {
  try {
    if (!tx.to || !tx.data || tx.data === '0x') return null; // plain transfer / creation: nothing to warm
    const margin = BigInt(Math.max(0, Math.floor(opts.marginPct ?? 20)));
    const key = [opts.chainId, tx.from, tx.to, tx.data, tx.value ?? '0x0', margin]
      .map(String)
      .join('|')
      .toLowerCase();
    const now = Date.now();
    const ttl = opts.cacheMs ?? 20_000;
    let hit = cache.get(key);
    if (!hit || now - hit.at > ttl) {
      const plan = lookup(provider, tx, opts.chainId, margin).catch(() => null);
      hit = { at: now, plan };
      cache.set(key, hit);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMED_OUT>((r) => {
      timer = setTimeout(() => r(TIMED_OUT), opts.timeoutMs ?? 2000);
    });
    try {
      const r = await Promise.race([hit.plan, late]);
      return r === TIMED_OUT ? null : r;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * `tx` with `accessList` (and, unless `setGas: false`, a `gas` limit from the with-list estimate
 * plus margin) when that is cheaper than without; otherwise `tx` itself. `provider` is the read
 * endpoint, not necessarily the wallet. A `gas` the caller already set is kept.
 */
export async function withAccessList<T extends AccessListTx>(
  provider: Eip1193Provider,
  tx: T,
  opts: AccessListOptions,
): Promise<T & Pick<TransactionRequest, 'accessList' | 'gas'>> {
  const plan = await planAccessList(provider, tx, opts);
  if (!plan) return tx;
  const out: T & Pick<TransactionRequest, 'accessList' | 'gas'> = {
    ...tx,
    accessList: plan.accessList,
  };
  if (opts.setGas !== false && tx.gas === undefined) {
    const margin = BigInt(Math.max(0, Math.floor(opts.marginPct ?? 20)));
    out.gas = hex(plan.gasWith + (plan.gasWith * margin) / 100n);
  }
  return out;
}
