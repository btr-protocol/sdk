/**
 * The one read provider for front, CLI and MCP: BTR's read relay (`/v1/rpc`) over `httpTransport`
 * (JSON-RPC batch + in-flight dedupe), memoized per (root, chain) so every caller in a process
 * shares one queue. Contract reads go through `multicall` on top of it. `fresh: true` on a request
 * (security reads: deposit floor, pre-sign simulation) never joins an in-flight duplicate.
 */

import { getApiRoot, withChainId } from '../api';
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
  // Injected fetch/timeout = test/proxy/CLI scope: never shared through the memo.
  const own = !!(t.fetch || t.timeout);
  let http = own ? undefined : relays.get(url);
  if (!http) {
    http = httpTransport(url, { chainId, ...t, timeout: t.timeout ?? RELAY_TIMEOUT_MS });
    if (!own) relays.set(url, http);
  }
  if (!callGas) return http;
  // Gas default sits above the one memoized transport, so CLI and front share its queue.
  const h = http;
  return {
    request: (a) => {
      const [call, ...rest] = (a.params ?? []) as Record<string, unknown>[];
      return a.method === 'eth_call' && call && call.gas === undefined
        ? h.request({ ...a, params: [{ ...call, gas: callGas }, ...rest] })
        : h.request(a);
    },
  };
}
