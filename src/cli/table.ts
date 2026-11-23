// The ONE command table: `btr` (CLI) and `btr-mcp` (MCP tools) are both generated from it, so a
// capability exists in both or in neither. `read` entries only read; `build` entries return unsigned
// `{to, data, value}` calls. Nothing here holds a key, signs or sends.
import * as P from "../protocol.js";
import type { Query } from "../protocol.js";
import type { Args, Res } from "./cmds.js";
import { io } from "./data.js";

export interface Arg {
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required?: boolean;
}
export interface Cmd {
  name: string;
  description: string;
  kind: "read" | "build";
  /** Positional args, in CLI order; always required. */
  pos?: string[];
  /** Named args: `--name value` on the CLI, same-named properties in MCP. */
  args?: Record<string, Arg>;
  run: (a: Args) => Promise<Res>;
}

const cmds = () => import("./cmds.js");
const live = () => import("../venues/live.js");
const reg = () => import("../venues/registry.js");
const str = (description: string, required = false): Arg => ({
  type: "string",
  description,
  required,
});
const WINDOW = { window: str("24h | 7d | 30d (default 24h)") };
const PARAMS = {
  params: str('extra query string passed through, e.g. "limit=50&before=1700000000000"'),
};
const BODY = {
  body: {
    type: "object",
    description: "JSON request body, as the front sends it",
    required: true,
  } as Arg,
};
const FROM = {
  from: str(
    "0x signing wallet: every call is emitted with this `from`, so a wallet refuses another signer; LP outputs (shares, withdrawn tokens) go to it",
    true,
  ),
};
const SLIP = {
  "slippage-bps": str("slippage tolerance in bps, integer in (0, 10000), cap 9990 (default 50)"),
};
const RECIPIENT = {
  recipient: str(
    "0x address that RECEIVES the swap output (default --from); never the zero address, a pool or a token",
  ),
};
const MIN = {
  "min-out": str(
    "optional raw minimum out; default = on-chain preview less --slippage-bps. Refused below preview less the 9990 bps cap or above the preview",
  ),
};

/** `--params` querystring -> object. */
const q = (a: Args): Query => Object.fromEntries(new URLSearchParams(a.flags.get("params") ?? ""));
const body = (a: Args): unknown => {
  const b = a.flags.get("body");
  if (!b) throw new Error("--body is required");
  return JSON.parse(b);
};
const data = async (p: Promise<unknown>): Promise<Res> => ({ data: await p });
const view =
  (
    k:
      | "pools"
      | "metrics"
      | "risk"
      | "flow"
      | "keepers"
      | "quote"
      | "depth"
      | "lpPreview"
      | "debtSwapQuote"
      | "buildSwap"
      | "buildApprove"
      | "buildDeposit"
      | "buildWithdraw"
      | "buildDebtSwap",
  ) =>
  async (a: Args) =>
    (await cmds())[k](a);
const get = (
  name: string,
  description: string,
  fn: (c: number, q: Query, o: ReturnType<typeof io>) => Promise<unknown>,
): Cmd => ({
  name,
  description,
  kind: "read",
  args: PARAMS,
  run: (a) => data(fn(a.chain, q(a), io(a.o))),
});
const postCmd = (
  name: string,
  description: string,
  fn: (c: number, b: never, o: ReturnType<typeof io>) => Promise<unknown>,
): Cmd => ({
  name,
  description,
  kind: "read",
  args: BODY,
  run: (a) => data(fn(a.chain, body(a) as never, io(a.o))),
});

export const TABLE: Cmd[] = [
  // ── front views ──
  {
    name: "pools",
    description: "Pool tree: APY, coverage, volume, TVL, optional LP position of --address",
    kind: "read",
    args: { ...WINDOW, address: str("0x account to show LP positions for") },
    run: view("pools"),
  },
  {
    name: "metrics",
    description:
      "Protocol KPIs and per-leg APR split (fee/hook/toll), deployed, TVL, volume (/v1/summary; --json = raw)",
    kind: "read",
    args: WINDOW,
    run: view("metrics"),
  },
  {
    name: "risk",
    description: "Risk tiles: coverage, skew, oracle age, deployed, per leg",
    kind: "read",
    args: WINDOW,
    run: view("risk"),
  },
  {
    name: "flow",
    description: "LP deposits/withdrawals per leg (/v1/liquidity)",
    kind: "read",
    args: WINDOW,
    run: view("flow"),
  },
  {
    name: "keepers",
    description: "Role Safes, quorum, drift, health, oracle age",
    kind: "read",
    run: view("keepers"),
  },
  // ── quotes ──
  {
    name: "quote",
    description: "Routed quote with the server floor (/v1/chain/route)",
    kind: "read",
    pos: ["in", "out", "amount"],
    args: SLIP,
    run: view("quote"),
  },
  {
    name: "depth",
    description: "Chain quote at each size of a ladder (/v1/chain/quote)",
    kind: "read",
    pos: ["in", "out"],
    args: { amounts: str("comma-separated sizes in IN units, e.g. 1,10,100", true), ...SLIP },
    run: view("depth"),
  },
  {
    name: "lp-preview",
    description: "Pool.previewWithdraw for raw LP shares of a leg (chain read)",
    kind: "read",
    pos: ["pool", "symbol", "lp-raw"],
    run: view("lpPreview"),
  },
  {
    name: "debt-swap-quote",
    description: "swapLiability simulated by eth_call from --from: TO-leg shares minted now",
    kind: "read",
    pos: ["pool", "from-symbol", "to-symbol", "lp-raw"],
    args: FROM,
    run: view("debtSwapQuote"),
  },
  postCmd(
    "lp-rows",
    "Ranked LP exit/entry rows + debt-swap destination (POST /v1/lp-rows)",
    P.lpRows,
  ),
  postCmd(
    "quote-lp",
    "Single-pool quote / LP preview as the front sends it (POST /v1/quote)",
    P.fetchQuote,
  ),
  postCmd(
    "quote-path",
    "Conversion quote a debt swap prices over (POST /v1/quote-path)",
    P.fetchQuotePath,
  ),
  postCmd("depth-book", "Depth ladder over pool wires (POST /v1/depth)", P.fetchDepth),
  // ── wire reads ──
  get("timeseries", "One metric bucketed (/v1/timeseries)", P.fetchTimeseries),
  postCmd(
    "timeseries-bulk",
    "Many metrics in one call (POST /v1/timeseries/bulk)",
    P.fetchTimeseriesBulk,
  ),
  get("liquidity", "LP flow buckets (/v1/liquidity)", P.fetchLiquidity),
  get("activity", "Newest swap + LP rows (/v1/activity)", P.fetchActivity),
  get("pool-assets", "Deployed pools and their asset rosters (/v1/pools)", P.fetchPools),
  get("pool-metrics", "Per-pool APR and its primitives (/v1/pools/metrics)", P.fetchPoolMetrics),
  {
    name: "pool-params",
    description: "One pool's live risk parameters, every leg (/v1/pools/{tag}/params)",
    kind: "read",
    pos: ["pool"],
    run: (a) => data(P.fetchPoolParams(a.chain, a.pos[0], io(a.o))),
  },
  {
    name: "density",
    description: "Observed price density for a pair (/v1/pools/{pair}/density)",
    kind: "read",
    pos: ["pair"],
    args: PARAMS,
    run: (a) => data(P.fetchDensity(a.chain, a.pos[0], q(a), io(a.o))),
  },
  get(
    "oracle-pushes",
    "Oracle push history, newest first (/v1/oracle/pushes)",
    P.fetchOraclePushes,
  ),
  {
    name: "oracle-push",
    description: "One push: tx input + signers (/v1/oracle/pushes/{tx})",
    kind: "read",
    pos: ["tx"],
    args: PARAMS,
    run: (a) => data(P.fetchOraclePush(a.chain, a.pos[0], q(a), io(a.o))),
  },
  get("safety-history", "Safeguard history (/v1/safety/history)", P.fetchSafetyHistory),
  get(
    "safety-breakers",
    "Automatic breakers: gates, trips, alarm hook (/v1/safety/breakers)",
    P.fetchSafetyBreakers,
  ),
  get("health", "Feed gates and ingest integrity (/v1/health)", P.fetchHealth),
  get("assets", 'Asset metadata (/v1/assets, e.g. params "addresses=0x..,0x..")', P.fetchAssets),
  get("md-tickers", "Market-data tickers (/v1/md/tickers)", P.fetchMdTickers),
  {
    name: "md-price",
    description: "Market-data price (/v1/md/price/{symbol})",
    kind: "read",
    pos: ["symbol"],
    run: (a) => data(P.fetchMdPrice(a.chain, a.pos[0], io(a.o))),
  },
  {
    name: "md-ohlc",
    description: 'Market-data OHLC (/v1/md/ohlc/{symbol}, params "tf=60&from=..&to=..")',
    kind: "read",
    pos: ["symbol"],
    args: PARAMS,
    run: (a) => data(P.fetchMdOhlc(a.chain, a.pos[0], q(a), io(a.o))),
  },
  postCmd("indicators", "TA series over caller bars (POST /v1/indicators)", P.fetchIndicators),
  // ── registry ──
  {
    name: "registry",
    description: "Contracts, tokens and pools (live, verified against baked)",
    kind: "read",
    run: async (a) => {
      const r = await (await live()).fetchRegistry(a.chain, a.o);
      return {
        data: r,
        text: [
          `chain ${r.chainId} (${r.source})`,
          ...Object.entries(r.contracts).map(([k, v]) => `${k}\t${v}`),
        ],
      };
    },
  },
  {
    name: "pool-list",
    description: "Registry pool list: tag, address, symbols",
    kind: "read",
    run: async (a) => {
      const r = await (await live()).fetchRegistry(a.chain, a.o);
      return {
        data: {
          pools: r.pools,
          otherPools: r.otherPools,
          degraded: r.degraded,
          source: r.source,
          warnings: r.warnings,
        },
        text: r.pools.map((p) => `${p.tag}\t${p.address}\t${p.symbols.join(",")}`),
      };
    },
  },
  {
    name: "roster",
    description: "Keeper/signer roster",
    kind: "read",
    run: async (a) => data((await live()).rosterFor(a.chain, a.o)),
  },
  {
    name: "abi",
    description: "ABI JSON for a contract by name (e.g. Pool, Admin)",
    kind: "read",
    pos: ["name"],
    run: async (a) => data((await live()).fetchLiveAbi(a.pos[0], a.o, a.chain)),
  },
  {
    name: "abis",
    description: "Index of ABI names served",
    kind: "read",
    run: async (a) => data((await live()).fetchAbis(a.chain, a.o)),
  },
  // ── unsigned builds ──
  {
    name: "build-swap",
    description:
      "Unsigned approve + swap_qe calls for a routed swap; --recipient (default --from) receives the output",
    kind: "build",
    pos: ["in", "out", "amount"],
    args: { ...FROM, ...SLIP, ...RECIPIENT },
    run: view("buildSwap"),
  },
  {
    name: "build-approve",
    description: "Unsigned approvals only, for the routed swap (send before build-swap)",
    kind: "build",
    pos: ["in", "out", "amount"],
    args: { ...FROM, ...SLIP },
    run: view("buildApprove"),
  },
  {
    name: "build-deposit",
    description:
      "Unsigned approve + depositMin for a pool leg; floor = simulated mint less slippage; --from receives the shares",
    kind: "build",
    pos: ["pool", "symbol", "amount"],
    args: { ...FROM, ...SLIP, ...MIN },
    run: view("buildDeposit"),
  },
  {
    name: "build-withdraw",
    description:
      "Unsigned withdraw of LP shares (amount in token units); floor = previewWithdraw less slippage; --from receives the tokens",
    kind: "build",
    pos: ["pool", "symbol", "amount"],
    args: { ...FROM, ...SLIP, ...MIN },
    run: view("buildWithdraw"),
  },
  {
    name: "build-debt-swap",
    description:
      "Unsigned swapLiability FROM-leg -> TO-leg shares; floor = simulated swap less slippage; --from receives the shares",
    kind: "build",
    pos: ["pool", "from-symbol", "to-symbol", "lp-raw"],
    args: { ...FROM, ...SLIP, ...MIN },
    run: view("buildDebtSwap"),
  },
];

export const byName = (n: string): Cmd | undefined => TABLE.find((c) => c.name === n);
/** MCP tool name for a table entry. */
export const toolName = (c: Cmd): string => c.name.replaceAll("-", "_");
export const CHAIN: Arg = { type: "number", description: "EVM chain id (default: baked default)" };

/** JSON for any result: bigints as decimal strings. */
export const toJson = (v: unknown, indent?: number): string =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), indent);

/** Default chain when none is given. */
export const defaultChain = async (): Promise<number> => (await reg()).defaultChainId();
