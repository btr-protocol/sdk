// Back-cached pool state (`/v1/pools/state`), bulk risk params and the activity `after=` cursor: the
// one store the front, the CLI and the MCP share. Ints arrive as decimal strings and leave as bigint;
// a null `feeParams`/`solvency` stays null (refuse, never 0); a stale/superseded entry is flagged
// for a chain read instead of being served as fresh.
import {
  type ApiOpts,
  HttpError,
  btrApi,
  btrFetch,
  getApiRoot,
  parseJson,
  withChainId,
} from "./api.js";
import type { PoolRiskParams } from "./types/protocol-metrics.js";

type Opt = Omit<ApiOpts, "query" | "body">;
type Hex = `0x${string}`;

export type PoolStatus = "live" | "superseded" | "halted" | "retired";

export interface PoolLegMark {
  px: number;
  stale: boolean;
  src: string;
  ts: string;
}
export interface PoolLegState {
  token: Hex;
  symbol: string;
  snapshotBlock: number;
  stale: boolean;
  ageMs: number;
  decimals: number;
  flags: number;
  reserves: bigint;
  liabilities: bigint;
  invested: bigint;
  liquidReserves: bigint;
  liquidityIndexWad: bigint;
  minLiquidity: bigint;
  depositCapCode: number;
  deadSeedPow10: number;
  curveId: number;
  minFeePbps: number;
  lpToken: Hex;
  lpTotalSupply: bigint;
  hook: { flags: number; target: Hex } | null;
  mark: PoolLegMark | null;
}
export interface PoolStateEntry {
  address: Hex;
  tag: string;
  generation: string;
  status: PoolStatus;
  seq: number;
  etag: string;
  snapshotBlock: number;
  stale: boolean;
  storageVersion: number;
  /** null = not served: the caller refuses (or reads chain), never defaults to 0. */
  feeParams: { protoSharePct: number; flowCooldownSecs: number } | null;
  solvency: { cWad: bigint; ok: boolean; tollWad: bigint } | null;
  legs: PoolLegState[];
}
export interface PoolStateSnapshot {
  v: 1;
  chainId: number;
  block: number;
  servedAt: number;
  pools: PoolStateEntry[];
}

const big = (v: unknown, k: string): bigint => {
  if (typeof v !== "string" || !/^\d+$/.test(v))
    throw new Error(`pool state: ${k} not a decimal int`);
  return BigInt(v);
};
const int = (v: unknown, k: string): number => {
  if (!Number.isSafeInteger(v)) throw new Error(`pool state: ${k} not an integer`);
  return v as number;
};
type W = Record<string, unknown>;

function parseLeg(l: W): PoolLegState {
  return {
    token: String(l.token).toLowerCase() as Hex,
    symbol: String(l.symbol),
    snapshotBlock: int(l.snapshotBlock, "snapshotBlock"),
    stale: l.stale !== false,
    ageMs: int(l.ageMs, "ageMs"),
    decimals: int(l.decimals, "decimals"),
    flags: int(l.flags, "flags"),
    reserves: big(l.reserves, "reserves"),
    liabilities: big(l.liabilities, "liabilities"),
    invested: big(l.invested, "invested"),
    liquidReserves: big(l.liquidReserves, "liquidReserves"),
    liquidityIndexWad: big(l.liquidityIndexWad, "liquidityIndexWad"),
    minLiquidity: big(l.minLiquidity, "minLiquidity"),
    depositCapCode: int(l.depositCapCode, "depositCapCode"),
    deadSeedPow10: int(l.deadSeedPow10, "deadSeedPow10"),
    curveId: int(l.curveId, "curveId"),
    minFeePbps: int(l.minFeePbps, "minFeePbps"),
    lpToken: String(l.lpToken).toLowerCase() as Hex,
    lpTotalSupply: big(l.lpTotalSupply, "lpTotalSupply"),
    hook: l.hook
      ? { flags: int((l.hook as W).flags, "hook.flags"), target: (l.hook as W).target as Hex }
      : null,
    mark: (l.mark as PoolLegMark | null) ?? null,
  };
}

/** Wire -> typed snapshot. Throws on a malformed int: a half-parsed pool must not price anything. */
export function parsePoolState(raw: unknown): PoolStateSnapshot {
  const r = raw as W;
  if (r?.v !== 1 || !Array.isArray(r.pools)) throw new Error("pool state: unknown version");
  return {
    v: 1,
    chainId: int(r.chainId, "chainId"),
    block: int(r.block, "block"),
    servedAt: int(r.servedAt, "servedAt"),
    pools: (r.pools as W[]).map((p) => {
      const s = p.solvency as W | null | undefined;
      const f = p.feeParams as W | null | undefined;
      const status = String(p.status) as PoolStatus;
      return {
        address: String(p.address).toLowerCase() as Hex,
        tag: String(p.tag),
        generation: String(p.generation),
        status,
        seq: int(p.seq, "seq"),
        etag: String(p.etag ?? ""),
        snapshotBlock: int(p.snapshotBlock, "snapshotBlock"),
        // A superseded generation is always stale: withdrawals read it from chain.
        stale: p.stale !== false || status === "superseded",
        storageVersion: int(p.storageVersion, "storageVersion"),
        feeParams: f
          ? {
              protoSharePct: int(f.protoSharePct, "protoSharePct"),
              flowCooldownSecs: int(f.flowCooldownSecs, "flowCooldownSecs"),
            }
          : null,
        solvency: s
          ? { cWad: big(s.cWad, "cWad"), ok: s.ok === true, tollWad: big(s.tollWad, "tollWad") }
          : null,
        legs: ((p.legs as W[]) ?? []).map(parseLeg),
      };
    }),
  };
}

/** True when this leg (or its pool) must be read from chain instead of the snapshot. */
export const legNeedsChain = (p: PoolStateEntry, l?: PoolLegState): boolean =>
  p.stale || p.status === "superseded" || !!l?.stale;

// ETag store: one entry per request URL, shared by every caller in the process.
const store = new Map<string, { etag: string; snap: PoolStateSnapshot }>();
const listeners = new Set<(chainId: number, s: PoolStateSnapshot) => void>();

/** Pool selector: one pool by address or tag (a tag returns every generation). */
export type PoolSel = { address: string } | { tag: string };

/**
 * `GET /v1/pools/state` (or `/v1/pools/{address|tag}/state`) with `If-None-Match`: a 304 reuses the
 * stored snapshot. Throws `HttpError` (503/404 included): the caller falls back to chain reads.
 */
export async function fetchPoolState(
  chainId: number,
  sel?: PoolSel,
  o: Opt = {},
): Promise<PoolStateSnapshot> {
  const id = sel && ("address" in sel ? sel.address : sel.tag);
  const path = withChainId(
    id ? `/v1/pools/${encodeURIComponent(id)}/state` : "/v1/pools/state",
    chainId,
  );
  const url = `${o.base ?? getApiRoot()}${path}`;
  const prev = store.get(url);
  const headers = new Headers(o.headers);
  if (prev?.etag) headers.set("If-None-Match", prev.etag);
  const res = await btrFetch(url, { ...o, headers });
  if (res.status === 304) {
    if (!prev) throw new HttpError(304, "pool state: 304 without a stored snapshot");
    return prev.snap;
  }
  const snap = parsePoolState(await parseJson<unknown>(res, url));
  store.set(url, { etag: res.headers.get("etag") ?? "", snap });
  if (!id) for (const f of listeners) f(chainId, snap);
  return snap;
}

/** Last full-chain snapshot fetched in this process (no request). */
export const poolStateCached = (
  chainId: number,
  base = getApiRoot(),
): PoolStateSnapshot | undefined =>
  store.get(`${base}${withChainId("/v1/pools/state", chainId)}`)?.snap;
/** Called after every full-chain fetch that returned a new body. */
export function onPoolState(f: (chainId: number, s: PoolStateSnapshot) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
/** Test-only: forget stored snapshots. */
export const resetPoolStateStore = (): void => store.clear();

/** Bulk risk params row: the single-pool body plus its generation status. */
export type PoolParamsRow = PoolRiskParams & {
  address: string;
  generation?: string;
  status?: string;
};
export interface PoolParamsBulk<K extends string> {
  chainId: number;
  pools: Record<string, K extends "tags" ? PoolParamsRow[] : PoolParamsRow | null>;
  errors: Record<string, string>;
}
/** `GET /v1/pools/params?tags=|addresses=` (<= 32): one call for many pools. */
export function fetchPoolParamsBulk(
  chainId: number,
  sel: { tags: string[] },
  o?: Opt,
): Promise<PoolParamsBulk<"tags">>;
export function fetchPoolParamsBulk(
  chainId: number,
  sel: { addresses: string[] },
  o?: Opt,
): Promise<PoolParamsBulk<"addresses">>;
export function fetchPoolParamsBulk(
  chainId: number,
  sel: { tags: string[] } | { addresses: string[] },
  o: Opt = {},
): Promise<PoolParamsBulk<string>> {
  const [k, v] = "tags" in sel ? ["tags", sel.tags] : ["addresses", sel.addresses];
  if (!v.length || v.length > 32) throw new Error(`${k}: 1..32 entries`);
  return btrApi(`/v1/pools/params`, chainId, {
    ...o,
    query: { [k]: [...new Set(v.map((x) => x.toLowerCase()))].sort().join(",") },
  });
}

export interface ActivityRow {
  txHash: string;
  logIndex: number;
  block: number;
  t: number;
  [k: string]: unknown;
}
export interface ActivityPage<R extends ActivityRow = ActivityRow> {
  chainId: number;
  events: R[];
  nextAfter: string | null;
  nextBefore?: number | null;
}
/** Activity cursor of a row: `<tsMs>:<block>:<logIndex>`. */
export const activityCursor = (r: Pick<ActivityRow, "t" | "block" | "logIndex">): string =>
  `${r.t}:${r.block}:${r.logIndex}`;
/** `GET /v1/activity?after=`: rows strictly after the cursor, oldest first. */
export const fetchActivityAfter = <R extends ActivityRow = ActivityRow>(
  chainId: number,
  after: string,
  query: Record<string, string | number | undefined> = {},
  o?: Opt,
) => btrApi<ActivityPage<R>>("/v1/activity", chainId, { ...o, query: { ...query, after } });
/** Merge new rows into a newest-first list, deduped on `txHash:logIndex`. */
export function mergeActivity<R extends ActivityRow>(
  prev: readonly R[],
  add: readonly R[],
  cap = 400,
): R[] {
  const key = (r: R) => `${r.txHash}:${r.logIndex}`;
  const seen = new Map<string, R>();
  for (const r of [...add, ...prev]) if (!seen.has(key(r))) seen.set(key(r), r);
  return [...seen.values()]
    .sort((a, b) => b.t - a.t || b.block - a.block || b.logIndex - a.logIndex)
    .slice(0, cap);
}
