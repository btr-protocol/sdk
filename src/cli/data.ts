import type { Eip1193Provider } from "../eth/types.js";
// Data layer for the `btr` CLI: live API reads only (/v1/summary, /v1/roster, ...), no keys, no sends.
import { relayProvider } from "../eth/reader.js";
import type { RegistryOpts } from "../venues/live.js";

export type Rec = Record<string, any>; // untyped wire JSON

/** Read-only JSON-RPC relay (`/v1/rpc`): the SDK's one read provider, the front's too.
 *  10M gas: the relay refuses an anonymous eth_call without `gas` (its anon cap). */
export const rpcProvider = (chain: number, o: RegistryOpts): Eip1193Provider =>
  relayProvider(chain, { base: o.base, fetch: o.fetch, callGas: "0x989680" });

export const WINDOWS = ["24h", "7d", "30d"];
export function windowArg(v: string | undefined): string {
  const w = v ?? "24h";
  if (!WINDOWS.includes(w)) throw new Error(`--window must be one of ${WINDOWS.join("|")}`);
  return w;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** APY, else APR, else the sum of the parts: always a number (unhooked leg => strategy 0). */
export const rate = (x: Rec): number =>
  x.apy ?? x.apr ?? x.aprPartial ?? num(x.feeApr) + num(x.strategyApr) + num(x.tollApr);

/** Live pools only: superseded generations are served too and would double-count. */
export const livePools = (s: Rec): Rec[] =>
  (s.pools as Rec[]).filter((p) => (p.status ?? "live") === "live" && !p.readOnly);
