import type { Eip1193Provider } from '../eth/types.js';
// Data layer for the `btr` CLI: live API reads only (/v1/summary, /v1/roster, ...), no keys, no sends.
import { btrApi } from '../protocol.js';
import type { RegistryOpts } from '../venues/live.js';

export type Rec = Record<string, any>; // untyped wire JSON

/** One `/v1/*` call through the SDK's generic (`btrApi`), honouring the CLI's injected fetch/base. */
export const io = (o: RegistryOpts) => ({
  fetch: o.fetch as typeof fetch | undefined,
  base: o.base,
  timeoutMs: o.timeoutMs,
});
export const api = (path: string, chain: number, o: RegistryOpts, body?: unknown): Promise<Rec> =>
  btrApi(path, chain, { ...io(o), body });

const CALL_GAS = '0x989680'; // 10M: the relay's anonymous eth_call cap

/** Read-only JSON-RPC relay (`/v1/rpc`): the same one the front uses. */
export function rpcProvider(chain: number, o: RegistryOpts): Eip1193Provider {
  let id = 0;
  return {
    async request({ method, params }) {
      const ps = (params ?? []) as unknown[];
      // The relay refuses an anonymous eth_call without `gas` (and over its anon cap, 10M).
      const call = ps[0] as Rec | undefined;
      const sent =
        method === 'eth_call' && call && call.gas === undefined
          ? [{ ...call, gas: CALL_GAS }, ...ps.slice(1)]
          : ps;
      const j = await api('/v1/rpc', chain, o, { jsonrpc: '2.0', id: ++id, method, params: sent });
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
