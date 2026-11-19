// Data layer for the `btr` CLI: live API reads only (/v1/summary, /v1/roster, ...), no keys, no sends.
import { getApiRoot, withChainId } from '../api.js';
import type { Eip1193Provider } from '../eth/types.js';
import type { RegistryOpts } from '../venues/live.js';

export type Rec = Record<string, any>; // untyped wire JSON

export async function api(
  path: string,
  chain: number,
  o: RegistryOpts,
  init?: RequestInit,
): Promise<any> {
  const f = o.fetch ?? fetch;
  const res = await f(`${o.base ?? getApiRoot()}${withChainId(path, chain)}`, {
    ...init,
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** Read-only JSON-RPC relay (`/v1/rpc`): the same one the front uses. */
export function rpcProvider(chain: number, o: RegistryOpts): Eip1193Provider {
  let id = 0;
  return {
    async request({ method, params }) {
      const j = await api('/v1/rpc', chain, o, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
      });
      if (j.error) throw new Error(`rpc ${method}: ${j.error.message ?? 'error'}`);
      return j.result;
    },
  };
}

export const WINDOWS = ['24h', '7d', '30d'];
export function windowArg(v: string | undefined): string {
  const w = v ?? '24h';
  if (!WINDOWS.includes(w)) throw new Error(`--window must be one of ${WINDOWS.join('|')}`);
  return w;
}
export const summary = (chain: number, window: string, o: RegistryOpts): Promise<Rec> =>
  api(`/v1/summary?window=${window}`, chain, o);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** APY, else APR, else the sum of the parts: always a number (unhooked leg => strategy 0). */
export const rate = (x: Rec): number =>
  x.apy ?? x.apr ?? x.aprPartial ?? num(x.feeApr) + num(x.strategyApr) + num(x.tollApr);

/** Live pools only: superseded generations are served too and would double-count. */
export const livePools = (s: Rec): Rec[] =>
  (s.pools as Rec[]).filter((p) => (p.status ?? 'live') === 'live' && !p.readOnly);
