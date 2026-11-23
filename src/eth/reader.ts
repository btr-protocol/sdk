/**
 * The one read layer for front, CLI and MCP.
 *
 * `relayProvider(chainId)` is BTR's read relay (`/v1/rpc`) over `httpTransport` (JSON-RPC batch +
 * in-flight dedupe), memoized per (root, chain) so every caller shares one queue. `createReader`
 * puts contract reads on Multicall3: reads issued in the same tick merge into one aggregate3
 * (size-split, per-leg failure). Plain `rpc()` covers what multicall cannot carry (balances,
 * block number, logs, state-override calls, simulations) and rides the transport's JSON-RPC
 * batch. `fresh: true` (security reads: deposit floor, pre-sign simulation) never joins an
 * in-flight duplicate.
 */

import { getApiRoot, withChainId } from '../api';
import { type Call, type MulticallResult, multicall } from './multicall';
import { type TransportOpts, httpTransport } from './transport';
import type { Eip1193Provider } from './types';

export interface RelayOpts extends TransportOpts {
  /** API root; default `getApiRoot()`. */
  base?: string;
  /** Default `gas` for an `eth_call` without one: the relay refuses anonymous calls without it. */
  callGas?: string;
}

/** Above the gateway's 12 s deadline, so the relay's own answer (a 504 included) beats the abort. */
const RELAY_TIMEOUT_MS = 15_000;
const relays = new Map<string, Eip1193Provider>();

export function relayProvider(chainId: number, o: RelayOpts = {}): Eip1193Provider {
  const { base = getApiRoot(), callGas, ...t } = o;
  const url = withChainId(`${base.replace(/\/$/, '')}/v1/rpc`, chainId);
  const key = `${url}|${callGas ?? ''}`;
  // Injected fetch = test/proxy scope: never shared through the memo.
  const hit = !t.fetch && relays.get(key);
  if (hit) return hit;
  const http = httpTransport(url, { chainId, timeout: RELAY_TIMEOUT_MS, ...t });
  const p: Eip1193Provider = callGas
    ? {
        request: (a) => {
          const [call, ...rest] = (a.params ?? []) as Record<string, unknown>[];
          return a.method === 'eth_call' && call && call.gas === undefined
            ? http.request({ ...a, params: [{ ...call, gas: callGas }, ...rest] })
            : http.request(a);
        },
      }
    : http;
  if (!t.fetch) relays.set(key, p);
  return p;
}

export interface ReadOpts {
  /** Pinned block (hex or tag); reads with different pins never merge. */
  block?: string;
  /** Security read: own aggregate3 / request, never an in-flight duplicate. */
  fresh?: boolean;
  /** Max legs per aggregate3 (default MC3_CHUNK). */
  chunkSize?: number;
}

export interface Reader {
  provider: Eip1193Provider;
  /** One contract read; throws on a failed leg. */
  read<T = unknown>(c: Call, o?: ReadOpts): Promise<T>;
  /** Many contract reads, per-leg `{success, result | error}`. */
  readAll(calls: Call[], o?: ReadOpts): Promise<MulticallResult[]>;
  /** Raw JSON-RPC for what multicall cannot carry. */
  rpc<T = unknown>(method: string, params?: unknown[], o?: { fresh?: boolean }): Promise<T>;
}

export function createReader(provider: Eip1193Provider, chainId?: number): Reader {
  const readAll = (calls: Call[], o: ReadOpts = {}) =>
    multicall(provider, calls, { chainId, ...o });
  return {
    provider,
    readAll,
    async read<T>(c: Call, o?: ReadOpts) {
      const [r] = await readAll([c], o);
      if (!r.success) throw r.error instanceof Error ? r.error : new Error(String(r.error));
      return r.result as T;
    },
    rpc: <T>(method: string, params: unknown[] = [], o: { fresh?: boolean } = {}) =>
      provider.request({ method, params, ...(o.fresh && { fresh: true }) }) as Promise<T>,
  };
}
