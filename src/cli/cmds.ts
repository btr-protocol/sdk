// `btr` command bodies. Imported lazily per command by btr.ts so startup stays flat.
// Read-only except `swap` / `lp`, which only BUILD unsigned call JSON: no key, no signing, no send.
import type { RegistryOpts } from "../venues/live.js";
import * as P from "../protocol.js";
import { type Rec, api, io, livePools, rate, rpcProvider, windowArg } from "./data.js";
import { DASH, bps, covBar, pct, poolTree, secs, table, usd } from "./fmt.js";
import type { TreeAsset, TreePool } from "./fmt.js";
import { MAX_SLIPPAGE_BPS, floorFromPreview, lossBps, slippageBps } from "../pool/slippage.js";

export interface Args {
  chain: number;
  flags: Map<string, string>;
  pos: string[];
  o: RegistryOpts;
  /** Slippage cap in bps (default the front's); MCP passes its tighter one. */
  cap?: number;
}
/** What every command returns: `data` (CLI `--json`, MCP result) and, for views, the text lines. */
export interface Res {
  data: unknown;
  text?: string[];
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const flag = (a: Args, k: string): string | undefined => a.flags.get(k);
const need = (a: Args, k: string): string => {
  const v = flag(a, k);
  if (!v) throw new Error(`--${k} is required`);
  return v;
};
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const addrArg = (a: Args, k: string): string => {
  const v = need(a, k);
  if (!ADDR.test(v)) throw new Error(`--${k} must be a 0x address`);
  return v;
};

// ── pools / metrics ────────────────────────────────────────────────────────────

/** LP position per leg of `pool` for `user`: USD then token notional. Null per leg when unreadable. */
async function positions(
  a: Args,
  pool: string,
  user: string,
  tokens: Record<string, string>,
  syms: string[],
) {
  const [{ getAsset, getLPBalance }, { readLegLpValues }, { formatUnits }] = await Promise.all([
    import("../pool/index.js"),
    import("../pool/lpValue.js"),
    import("../utils/format.js"),
  ]);
  const prov = rpcProvider(a.chain, a.o);
  const list = syms.filter((s) => tokens[s.toUpperCase()]);
  const toks = list.map((s) => tokens[s.toUpperCase()] as `0x${string}`);
  const vals = await readLegLpValues(prov, pool as `0x${string}`, toks);
  const res = new Map<string, { usd: number; tok: string }>();
  await Promise.all(
    list.map(async (s, i) => {
      try {
        const [bal, asset] = await Promise.all([
          getLPBalance(prov, pool as `0x${string}`, user as `0x${string}`, toks[i]),
          getAsset(prov, pool as `0x${string}`, toks[i]),
        ]);
        if (bal <= 0n) return;
        const tok = formatUnits(bal, asset.decimals);
        res.set(s, { usd: vals[i].usdPerLp === null ? 0 : Number(tok) * vals[i].usdPerLp, tok });
      } catch {}
    }),
  );
  return res;
}

export async function pools(a: Args): Promise<Res> {
  const s = (await P.fetchSummary(a.chain, windowArg(flag(a, "window")), io(a.o))) as Rec;
  const user = flag(a, "address");
  if (user && !ADDR.test(user)) throw new Error("--address must be a 0x address");
  let tokens: Record<string, string> = {};
  if (user) tokens = (await (await import("../venues/live.js")).fetchRegistry(a.chain, a.o)).tokens;
  const rows: TreePool[] = [];
  for (const p of livePools(s)) {
    const pos = user
      ? await positions(
          a,
          p.address,
          user,
          tokens,
          (p.assets as Rec[]).map((x) => x.symbol),
        )
      : null;
    const cell = (u: number, t: string) => `${usd(u)} ${t}`;
    let total = 0;
    const assets: TreeAsset[] = (p.assets as Rec[]).map((x) => {
      const h = pos?.get(x.symbol);
      total += h?.usd ?? 0;
      return {
        symbol: x.symbol,
        apy: rate(x),
        coverage: x.coverage ?? null,
        volumeUsd: num(x.volumeUsd),
        tvlUsd: num(x.tvlUsd),
        position: h ? cell(h.usd, `${h.tok} ${x.symbol}`) : DASH,
      };
    });
    const cov = num(p.liabilitiesUsd) > 0 ? num(p.tvlUsd) / num(p.liabilitiesUsd) : null;
    rows.push({
      name: p.label ?? p.tag,
      apy: rate(p),
      coverage: cov,
      volumeUsd: num(p.volumeUsd),
      tvlUsd: num(p.tvlUsd),
      position: pos && total > 0 ? usd(total) : DASH,
      assets,
    });
  }
  return { data: { window: s.window, pools: rows }, text: poolTree(rows) };
}

export async function metrics(a: Args): Promise<Res> {
  const s = (await P.fetchSummary(a.chain, windowArg(flag(a, "window")), io(a.o))) as Rec;
  const k = s.protocol as Rec;
  const text = [
    `chain ${s.chainId}  window ${s.window}  TVL ${usd(k.tvlUsd)}  volume ${usd(k.volumeUsd)}  swaps ${num(k.swapCount)}  fees ${usd(k.feesUsd)}  protocol share ${pct(k.protocolSharePct)}`,
  ];
  const rows: string[][] = [];
  const line = (name: string, x: Rec) => [
    name,
    pct(rate(x)),
    pct(x.feeApr),
    pct(x.strategyApr),
    pct(x.tollApr),
    pct(x.venueApr),
    pct(x.investedRatio, 0),
    usd(x.tvlUsd),
    usd(x.volumeUsd),
  ];
  for (const p of livePools(s)) {
    rows.push(line(p.tag, p));
    (p.assets as Rec[]).forEach((x, i, arr) =>
      rows.push(line(`  ${i === arr.length - 1 ? "└─" : "├─"} ${x.symbol}`, x)),
    );
  }
  text.push(
    ...table(
      [
        "POOL / ASSET",
        "APY",
        "FEE APR",
        "HOOK APR",
        "TOLL APR",
        "VENUE",
        "DEPLOYED",
        "TVL",
        "VOLUME",
      ],
      rows,
    ),
  );
  return { data: s, text };
}

// ── risk ───────────────────────────────────────────────────────────────────────

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Risk tiles (risk-panel-1119) from one `/v1/summary` leg list, as of now. */
export function riskTiles(legs: Rec[]) {
  const liab = legs.reduce((t, l) => t + num(l.liabilitiesUsd), 0);
  const tvl = legs.reduce((t, l) => t + num(l.tvlUsd), 0);
  const covs = legs.filter((l) => l.coverage != null).map((l) => num(l.coverage));
  const worst = covs.length ? Math.min(...covs) : 1;
  const lw = (f: (l: Rec) => number) =>
    liab > 0 ? legs.reduce((t, l) => t + num(l.liabilitiesUsd) * f(l), 0) / liab : 0;
  const ages = legs.filter((l) => l.oracleAgeSec != null).map((l) => num(l.oracleAgeSec));
  const skews = legs
    .filter((l) => l.coverage != null)
    .map((l) => Math.abs(num(l.coverage) - 1) * 1e4);
  return {
    coverage: liab > 0 ? tvl / liab : 0,
    worstLegCoverage: worst,
    legsBelowPar: covs.filter((c) => c < 1).length,
    legs: legs.length,
    worstShortfallBps: Math.max(0, 1 - worst) * 1e4,
    absSkewBps: {
      lw: lw((l) => Math.abs(num(l.coverage) - 1) * 1e4),
      median: quantile(skews, 0.5),
    },
    oracleAgeSec: {
      p50: quantile(ages, 0.5),
      p95: quantile(ages, 0.95),
      max: ages.length ? Math.max(...ages) : 0,
    },
    deployedRatio:
      tvl > 0 ? legs.reduce((t, l) => t + num(l.investedRatio) * num(l.tvlUsd), 0) / tvl : 0,
    tvlUsd: tvl,
  };
}

export async function risk(a: Args): Promise<Res> {
  const s = (await P.fetchSummary(a.chain, windowArg(flag(a, "window")), io(a.o))) as Rec;
  const all: Rec[] = livePools(s).flatMap((p) =>
    (p.assets as Rec[]).map((x) => ({ ...x, pool: p.tag })),
  );
  const t = riskTiles(all);
  const data = {
    total: t,
    pools: livePools(s).map((p) => ({ pool: p.tag, ...riskTiles(p.assets) })),
    served: s.risk ?? null,
  };
  const tiles: string[][] = [
    ["Coverage", `${t.coverage.toFixed(3)}x`],
    ["Worst-leg coverage", `${t.worstLegCoverage.toFixed(3)}x`],
    ["Legs below par", `${t.legsBelowPar}/${t.legs}`],
    ["Worst-leg shortfall", bps(t.worstShortfallBps)],
    ["Abs skew (liab-weighted)", `${bps(t.absSkewBps.lw)}  median ${bps(t.absSkewBps.median)}`],
    [
      "Oracle age (median)",
      `${secs(t.oracleAgeSec.p50)}  p95 ${secs(t.oracleAgeSec.p95)}  max ${secs(t.oracleAgeSec.max)}`,
    ],
    ["Deployed", pct(t.deployedRatio)],
    ["TVL", usd(t.tvlUsd)],
  ];
  const m = (s.risk ?? s.riskTotal)?.markout; // served by newer backs only
  if (m)
    tiles.splice(
      6,
      0,
      ["Oracle lag at fill (vw)", bps(m.lagBps?.vw)],
      ["Markout 60s (median / p05)", `${bps(m.h60?.p50)} / ${bps(m.h60?.p05)}`],
    );
  const text = [...table(["RISK", "NOW"], tiles), ""];
  const rows = all.map((x) => [
    `${x.pool}/${x.symbol}`,
    covBar(x.coverage),
    bps(Math.abs(num(x.coverage) - 1) * 1e4),
    secs(x.oracleAgeSec),
    pct(x.investedRatio, 0),
    usd(x.tvlUsd),
  ]);
  text.push(...table(["LEG", "COVERAGE", "SKEW", "ORACLE AGE", "DEPLOYED", "TVL"], rows));
  return { data, text };
}

// ── flow ───────────────────────────────────────────────────────────────────────

const WINDOW_MS: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };

export async function flow(a: Args): Promise<Res> {
  const w = windowArg(flag(a, "window"));
  // The liquidity route takes from/to (ms), not window: convert so the span matches the header.
  const to = Date.now();
  const from = to - WINDOW_MS[w];
  const j = (await P.fetchLiquidity(
    a.chain,
    { from: String(from), to: String(to) },
    io(a.o),
  )) as unknown as Rec;
  const buckets = (j.buckets ?? []) as Rec[];
  const agg = new Map<string, { dep: number; wd: number; n: number }>();
  for (const b of buckets) {
    const k = `${b.poolTag}/${b.symbol}`;
    const r = agg.get(k) ?? { dep: 0, wd: 0, n: 0 };
    if (b.side === "deposit") r.dep += num(b.amountUsd);
    else r.wd += num(b.amountUsd);
    r.n += num(b.eventCount);
    agg.set(k, r);
  }
  const rows = [...agg]
    .filter(([, r]) => r.n > 0)
    .sort((x, y) => y[1].dep + y[1].wd - (x[1].dep + x[1].wd))
    .map(([k, r]) => [k, usd(r.dep), usd(r.wd), usd(r.dep - r.wd), String(r.n)]);
  const sum = (f: (r: { dep: number; wd: number }) => number) =>
    [...agg.values()].reduce((t, r) => t + f(r), 0);
  rows.push([
    "TOTAL",
    usd(sum((r) => r.dep)),
    usd(sum((r) => r.wd)),
    usd(sum((r) => r.dep - r.wd)),
    String([...agg.values()].reduce((t, r) => t + r.n, 0)),
  ]);
  return {
    data: j,
    text: [
      `liquidity flow ${w}`,
      ...table(["POOL / ASSET", "DEPOSITS", "WITHDRAWALS", "NET", "EVENTS"], rows),
    ],
  };
}

// ── keepers ────────────────────────────────────────────────────────────────────

export async function keepers(a: Args): Promise<Res> {
  const [r, h, s] = await Promise.all([
    api("/v1/roster", a.chain, a.o),
    (P.fetchHealth(a.chain, undefined, io(a.o)) as Promise<Rec>).catch((e: Error) => ({
      status: `unreadable (${e.message})`,
    })),
    (P.fetchSummary(a.chain, "24h", io(a.o)) as Promise<Rec>).catch(() => null),
  ]);
  const ages = s
    ? livePools(s).flatMap((p) => (p.assets as Rec[]).map((x) => num(x.oracleAgeSec)))
    : [];
  const text = [
    `chain ${r.chainId}  health ${h.status}${r.degraded ? "  roster degraded" : ""}${ages.length ? `  oracle age max ${secs(Math.max(...ages))}` : ""}`,
  ];
  const rows = (r.safes as Rec[]).map((x) => [
    x.role,
    `${x.threshold}/${(x.owners as string[]).length}`,
    x.drift ? "DRIFT" : "ok",
    x.address,
  ]);
  text.push(...table(["ROLE", "QUORUM", "STATE", "ADDRESS"], rows));
  if (r.refuel) text.push(`refuel ${JSON.stringify(r.refuel)}`);
  return { data: { roster: r, health: h }, text };
}

// ── quote / swap build ─────────────────────────────────────────────────────────

const hex = (v: bigint) => `0x${v.toString(16)}`;

/** Resolve symbol -> address and decimals from the live registry + chain (no baked values). */
async function resolve(a: Args, sym: string, poolHint?: string) {
  const reg = await (await import("../venues/live.js")).fetchRegistry(a.chain, a.o);
  const address = reg.tokens[sym.toUpperCase()];
  if (!address) throw new Error(`unknown token ${sym}`);
  const pool = reg.pools.find(
    (p) =>
      (poolHint ? p.tag === poolHint : true) &&
      p.symbols.map((x) => x.toUpperCase()).includes(sym.toUpperCase()),
  );
  if (!pool) throw new Error(`no live pool${poolHint ? ` ${poolHint}` : ""} lists ${sym}`);
  const { getAsset } = await import("../pool/index.js");
  const { decimals } = await getAsset(rpcProvider(a.chain, a.o), pool.address, address);
  return { reg, address, decimals, pool };
}

function slipArg(a: Args): number {
  return slippageBps(flag(a, "slippage-bps"), a.cap);
}

/** Positive raw integer, else a usage error (BigInt alone throws a bare SyntaxError). */
function rawArg(v: string, name: string): bigint {
  if (!/^\d+$/.test(v.trim()) || !(BigInt(v.trim()) > 0n))
    throw new Error(`${name} must be a positive raw integer`);
  return BigInt(v.trim());
}

async function route(a: Args) {
  const [si, so, amt] = a.pos;
  if (!si || !so || !amt)
    throw new Error("usage: btr quote <IN> <OUT> <amount> [--slippage-bps 50]");
  const bp = slipArg(a);
  const [{ parseUnits }, { chainRoute }] = await Promise.all([
    import("../utils/format.js"),
    import("../chain/quote.js"),
  ]);
  const tin = await resolve(a, si);
  const tout = await resolve(a, so);
  const amountIn = parseUnits(amt, tin.decimals);
  if (!(amountIn > 0n)) throw new Error("amount must be positive");
  const r = await chainRoute({
    chain_id: a.chain,
    token_in: tin.address,
    token_out: tout.address,
    amount_in: hex(amountIn),
    slippage: { mode: "relative", pbps: Math.round(bp * 100) },
  });
  return { r, tin, tout, amountIn, si: si.toUpperCase(), so: so.toUpperCase() };
}

export async function quote(a: Args): Promise<Res> {
  const { r, tin, tout, amountIn, si, so } = await route(a);
  if (!r.best)
    throw new Error(
      `no route ${si} -> ${so}${r.refused.length ? ` (refused: ${r.refused.map((x) => x.name).join(",")})` : ""}`,
    );
  const f = r.best.floors[0];
  const { formatUnits } = await import("../utils/format.js");
  const view = {
    in: `${formatUnits(amountIn, tin.decimals)} ${si}`,
    out: `${formatUnits(BigInt(f.amount_out), tout.decimals)} ${so}`,
    minOut: `${formatUnits(BigInt(f.min_out), tout.decimals)} ${so}`,
    tolPbps: f.tol_pbps,
    block: r.block.number,
    parts: r.best.parts.map((p) =>
      p.hops.map((h) => `${h.pool}:${h.token_in}>${h.token_out}`).join(" , "),
    ),
    swapGated: r.swap_gated ?? null,
  };
  return {
    data: { ...view, floors: r.best.floors },
    text: Object.entries(view).map(
      ([k, v]) => `${k.padEnd(10)}${Array.isArray(v) ? v.join(" | ") : v}`,
    ),
  };
}

/** Every call carries `from` = `--from`, so a wallet refuses a mismatched signer. */
const fromCalls = <C extends object>(from: string, calls: C[]) =>
  calls.map((c) => ({ from, ...c }));

/** `--recipient` (default `--from`): never the zero address, a pool or a token of the registry. */
function recipientArg(
  a: Args,
  from: string,
  reg: { pools: { address: string }[]; tokens: Record<string, string> },
) {
  const r = flag(a, "recipient") === undefined ? from : addrArg(a, "recipient");
  const bad = new Set(
    [
      "0x0000000000000000000000000000000000000000",
      ...reg.pools.map((p) => p.address),
      ...Object.values(reg.tokens),
    ].map((x) => x.toLowerCase()),
  );
  if (bad.has(r.toLowerCase()))
    throw new Error("--recipient must not be the zero address, a pool or a token");
  return r;
}

type Hop = {
  pool: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
};

/** Route parts -> legs with slippage applied ONCE per part (as SDK `planToLegs`): every hop is
 *  floored at its quoted out less `tol_pbps` and a chained hop spends the prior hop's floor, so the
 *  final floor is the part's quoted end-to-end out less tol, never compounded. Refuses a server tol
 *  wider than the request (`bps`) or the cap, and a part whose loss exceeds the cap. */
export function chainLegs(
  parts: { hops: Hop[] }[],
  tolPbps: number,
  bps: number,
  cap = MAX_SLIPPAGE_BPS,
) {
  if (!(Number.isInteger(tolPbps) && tolPbps >= 0 && tolPbps <= bps * 100 && tolPbps <= cap * 100))
    throw new Error(`server tol_pbps ${tolPbps} wider than --slippage-bps ${bps} (cap ${cap})`);
  const tol = BigInt(tolPbps);
  let loss = 0;
  const legs = parts.flatMap((p) => {
    let prevMin: bigint | null = null;
    const out = p.hops.map((h, i) => {
      const quotedOut = BigInt(h.amount_out);
      const minOut = (quotedOut * (1_000_000n - tol)) / 1_000_000n;
      if (!(minOut > 0n)) throw new Error(`zero floor on hop ${h.pool}`);
      const amountIn: bigint = prevMin ?? BigInt(h.amount_in);
      prevMin = minOut;
      return {
        pool: h.pool,
        tokenIn: h.token_in,
        tokenOut: h.token_out,
        amountIn,
        minOut,
        quotedOut,
        chained: i > 0,
      };
    });
    const last = out.at(-1);
    if (last) loss = Math.max(loss, lossBps(last.quotedOut, last.minOut));
    return out;
  });
  if (loss > cap) throw new Error(`route loss ${loss} bps above the ${cap} bps cap`);
  return { legs, lossBps: loss };
}

/** Quote -> exec legs for `from`. The server floor is checked by chainRoute; every pool and token the
 *  route names must be in the live registry. */
async function swapLegs(a: Args) {
  const from = addrArg(a, "from");
  const { fetchRegistry } = await import("../venues/live.js");
  const recipient = recipientArg(a, from, await fetchRegistry(a.chain, a.o));
  const { r, tin, si, so } = await route(a);
  if (!r.best) throw new Error(`no route ${si} -> ${so}`);
  const official = new Set(tin.reg.pools.map((p) => p.address.toLowerCase()));
  const poolOf = (tag: string) => {
    const p = tin.reg.pools.find((x) => x.tag === tag);
    if (!p || !official.has(p.address.toLowerCase()))
      throw new Error(`route names unknown pool ${tag}`);
    return p.address;
  };
  const tokOf = (sym: string) => {
    const t = tin.reg.tokens[sym.toUpperCase()];
    if (!t) throw new Error(`route names unknown token ${sym}`);
    return t;
  };
  const bp = slipArg(a);
  const { legs, lossBps: loss } = chainLegs(r.best.parts, r.best.floors[0].tol_pbps, bp, a.cap);
  const resolved = legs.map((l) => ({
    ...l,
    pool: poolOf(l.pool),
    tokenIn: tokOf(l.tokenIn),
    tokenOut: tokOf(l.tokenOut),
  }));
  const opts = { recipient: recipient as `0x${string}`, sender: from as `0x${string}` };
  const head = {
    chainId: a.chain,
    from,
    recipient,
    floor: r.best.floors[0],
    lossBps: loss,
    swapGated: r.swap_gated ?? null,
  };
  return { legs: resolved as never, opts, head };
}

/** `btr build-swap`: unsigned approve + swap_qe calls; `recipient` receives the output. */
export async function buildSwap(a: Args): Promise<Res> {
  const { legs, opts, head } = await swapLegs(a);
  const { buildSwapCalls } = await import("../router/index.js");
  return { data: { ...head, calls: fromCalls(head.from, buildSwapCalls(legs, opts)) } };
}

/** `btr build-approve`: only the approvals the swap phase spends (send ahead of `build-swap`). */
export async function buildApprove(a: Args): Promise<Res> {
  const { legs, opts, head } = await swapLegs(a);
  const { buildApprovalCalls } = await import("../router/index.js");
  return { data: { ...head, calls: fromCalls(head.from, buildApprovalCalls(legs, opts)) } };
}

// ── lp build / preview ─────────────────────────────────────────────────────────

const LP_USAGE = "<pool-tag> <SYMBOL> <amount> --from 0x.. [--slippage-bps 50] [--min-out <raw>]";

/** The floor every LP build signs: the on-chain `preview` less `--slippage-bps`, or a `--min-out`
 *  inside the cap (`floorFromPreview`). A preview that cannot be read refuses. */
async function lpFloor(a: Args, preview: () => Promise<bigint>, hint = "") {
  const bp = slipArg(a);
  const m = flag(a, "min-out");
  const minOut = m === undefined ? undefined : rawArg(m, "--min-out");
  let p: bigint;
  try {
    p = await preview();
  } catch (e) {
    throw new Error(`on-chain preview failed${hint}: ${(e as Error).message}`);
  }
  return { floor: floorFromPreview(p, bp, minOut, a.cap), preview: p, slippageBps: bp };
}

async function lpArgs(a: Args, kind: string) {
  const [tag, sym, amt] = a.pos;
  if (!tag || !sym || !amt) throw new Error(`usage: btr ${kind} ${LP_USAGE}`);
  const from = addrArg(a, "from");
  slipArg(a);
  const t = await resolve(a, sym, tag);
  const { parseUnits } = await import("../utils/format.js");
  const amount = parseUnits(amt, t.decimals);
  if (!(amount > 0n)) throw new Error("amount must be positive");
  const head = {
    chainId: a.chain,
    from,
    pool: t.pool.tag,
    token: sym.toUpperCase(),
    amountRaw: amount.toString(),
  };
  return { t, amount, from, head };
}

/** `Pool.previewWithdraw(token, lp)`: [token out, aux]. */
async function previewWithdraw(a: Args, pool: string, token: string, lp: bigint) {
  const [{ encodeFn, decodeFn }, { POOL_ABI }] = await Promise.all([
    import("../eth/abi.js"),
    import("../abis/Pool.js"),
  ]);
  const data = encodeFn({ abi: POOL_ABI, functionName: "previewWithdraw", args: [token, lp] });
  const ret = (await rpcProvider(a.chain, a.o).request({
    method: "eth_call",
    params: [{ to: pool, data }, "latest"],
  })) as string;
  return decodeFn<[bigint, bigint]>({ abi: POOL_ABI, functionName: "previewWithdraw", data: ret });
}

/** `btr build-deposit`: [approve, depositMin]; the shares mint to `--from`. */
export async function buildDeposit(a: Args): Promise<Res> {
  const { t, amount, from, head } = await lpArgs(a, "build-deposit");
  const [{ encodeFn }, { ERC20_ABI }, { depositCallData }, { simulateDeposit }] = await Promise.all(
    [
      import("../eth/abi.js"),
      import("../eth/erc20.js"),
      import("../router/index.js"),
      import("../pool/index.js"),
    ],
  );
  const pool = t.pool.address;
  const f = await lpFloor(
    a,
    () =>
      simulateDeposit(
        rpcProvider(a.chain, a.o),
        pool as `0x${string}`,
        from as `0x${string}`,
        t.address as `0x${string}`,
        amount,
      ),
    " (deposit simulates from --from: it needs the balance and the approval mined first)",
  );
  const calls = [
    {
      to: t.address,
      data: encodeFn({ abi: ERC20_ABI, functionName: "approve", args: [pool, amount] }),
      value: 0n,
    },
    { to: pool, data: depositCallData(t.address as `0x${string}`, amount, f.floor), value: 0n },
  ];
  return {
    data: { ...head, ...lpHead(f), kind: "deposit", calls: fromCalls(from, calls) },
  };
}

const lpHead = (f: { floor: bigint; preview: bigint; slippageBps: number }) => ({
  previewRaw: f.preview.toString(),
  minRaw: f.floor.toString(),
  slippageBps: f.slippageBps,
  lossBps: lossBps(f.preview, f.floor),
});

/** `btr build-withdraw <pool-tag> <SYM> <lp-raw>`: [withdraw] burning `lp-raw` shares of the leg,
 *  floored; pays `--from`. */
export async function buildWithdraw(a: Args): Promise<Res> {
  const [tag, sym, raw] = a.pos;
  if (!tag || !sym || !raw)
    throw new Error(
      "usage: btr build-withdraw <pool-tag> <SYMBOL> <lp-raw> --from 0x.. [--slippage-bps 50] [--min-out <raw>]",
    );
  const from = addrArg(a, "from");
  slipArg(a);
  const t = await resolve(a, sym, tag);
  const lp = rawArg(raw, "lp-raw");
  const [{ encodeFn }, { POOL_ABI }, { sendDeadline }] = await Promise.all([
    import("../eth/abi.js"),
    import("../abis/Pool.js"),
    import("../pool/index.js"),
  ]);
  const f = await lpFloor(
    a,
    async () => (await previewWithdraw(a, t.pool.address, t.address, lp))[0],
  );
  const data = encodeFn({
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [t.address, lp, f.floor, sendDeadline()],
  });
  return {
    data: {
      chainId: a.chain,
      from,
      pool: t.pool.tag,
      token: sym.toUpperCase(),
      lpRaw: lp.toString(),
      ...lpHead(f),
      kind: "withdraw",
      calls: fromCalls(from, [{ to: t.pool.address, data, value: 0n }]),
    },
  };
}

/** `<pool-tag> <FROM> <TO> <lp-raw>`: both legs resolved in the named pool. */
async function debtArgs(a: Args, kind: string) {
  const [tag, sf, st, raw] = a.pos;
  if (!tag || !sf || !st || !raw)
    throw new Error(`usage: btr ${kind} <pool-tag> <FROM> <TO> <lp-raw> --from 0x..`);
  const from = addrArg(a, "from");
  const tf = await resolve(a, sf, tag);
  const tt = await resolve(a, st, tag);
  if (tf.address.toLowerCase() === tt.address.toLowerCase())
    throw new Error("FROM and TO must differ");
  const lp = rawArg(raw, "lp-raw");
  return { from, tf, tt, lp, pool: tf.pool.address as `0x${string}` };
}

/** `swapLiability` simulated by eth_call from `from` (floor 1): the TO-leg shares minted now. */
async function simDebtSwap(a: Args, d: Awaited<ReturnType<typeof debtArgs>>): Promise<bigint> {
  const [{ swapLiabilityCallData }, { decodeFn }, { POOL_ABI }, { sendDeadline }] =
    await Promise.all([
      import("../router/index.js"),
      import("../eth/abi.js"),
      import("../abis/Pool.js"),
      import("../pool/index.js"),
    ]);
  const data = swapLiabilityCallData(
    d.tf.address as `0x${string}`,
    d.tt.address as `0x${string}`,
    d.lp,
    1n,
    sendDeadline(),
  );
  const ret = (await rpcProvider(a.chain, a.o).request({
    method: "eth_call",
    params: [{ from: d.from, to: d.pool, data }, "latest"],
  })) as string;
  return decodeFn<bigint>({ abi: POOL_ABI, functionName: "swapLiability", data: ret });
}

/** `btr build-debt-swap`: [swapLiability] FROM-leg shares -> TO-leg shares of `--from`, floored. */
export async function buildDebtSwap(a: Args): Promise<Res> {
  slipArg(a);
  const d = await debtArgs(a, "build-debt-swap");
  const f = await lpFloor(a, () => simDebtSwap(a, d));
  const { buildSwapLiabilityCalls } = await import("../router/index.js");
  const calls = buildSwapLiabilityCalls(d.pool, {
    tokenFrom: d.tf.address as `0x${string}`,
    tokenTo: d.tt.address as `0x${string}`,
    lpAmountIn: d.lp,
    minLpAmountOut: f.floor,
  });
  return {
    data: {
      chainId: a.chain,
      from: d.from,
      pool: d.tf.pool.tag,
      lpRaw: d.lp.toString(),
      ...lpHead(f),
      calls: fromCalls(d.from, calls),
    },
  };
}

/** `btr debt-swap-quote`: the swapLiability simulated by eth_call from `--from` (floor 1): the
 *  TO-leg shares the chain would mint now. Read only. */
export async function debtSwapQuote(a: Args): Promise<Res> {
  const d = await debtArgs(a, "debt-swap-quote");
  const out = await simDebtSwap(a, d);
  const view = { pool: d.tf.pool.tag, lpInRaw: d.lp.toString(), lpOutRaw: out.toString() };
  return { data: view, text: [`${view.pool}: lp in ${view.lpInRaw} -> lp out ${view.lpOutRaw}`] };
}

/** `btr lp-preview <pool-tag> <SYM> <lp-raw>`: `Pool.previewWithdraw` for those shares (both
 *  return words, unlabelled as in the ABI), read only. */
export async function lpPreview(a: Args): Promise<Res> {
  const [tag, sym, raw] = a.pos;
  if (!tag || !sym || !raw) throw new Error("usage: btr lp-preview <pool-tag> <SYMBOL> <lp-raw>");
  const t = await resolve(a, sym, tag);
  const lp = rawArg(raw, "lp-raw");
  const [out, second] = await previewWithdraw(a, t.pool.address, t.address, lp);
  const view = {
    pool: t.pool.tag,
    token: sym.toUpperCase(),
    lpRaw: raw,
    outRaw: out.toString(),
    aux: second.toString(),
  };
  return { data: view, text: Object.entries(view).map(([k, v]) => `${k.padEnd(8)}${v}`) };
}

/** `btr depth <IN> <OUT> --amounts 1,10,100`: chain-mode quote at each size (one `/v1/chain/quote`). */
export async function depth(a: Args): Promise<Res> {
  const [si, so] = a.pos;
  if (!si || !so) throw new Error("usage: btr depth <IN> <OUT> --amounts 1,10,100");
  const sizes = need(a, "amounts").split(",");
  const bp = slipArg(a);
  const [{ parseUnits, formatUnits }, { chainQuote, isRefused }] = await Promise.all([
    import("../utils/format.js"),
    import("../chain/quote.js"),
  ]);
  const tin = await resolve(a, si);
  const tout = await resolve(a, so);
  const r = await chainQuote({
    chain_id: a.chain,
    token_in: tin.address,
    token_out: tout.address,
    amounts_in: sizes.map((x) => hex(parseUnits(x.trim(), tin.decimals))),
    slippage: { mode: "relative", pbps: Math.round(bp * 100) },
  });
  const rows = r.amounts.map((x, i) =>
    isRefused(x)
      ? [sizes[i], `refused ${x.refused.code ?? x.refused.name}`, DASH, DASH]
      : [
          sizes[i],
          formatUnits(BigInt(x.amount_out), tout.decimals),
          formatUnits(BigInt(x.min_out), tout.decimals),
          String(x.tol_pbps),
        ],
  );
  return {
    data: r,
    text: [
      `${si.toUpperCase()} -> ${so.toUpperCase()}  block ${r.block.number}`,
      ...table([`IN ${si.toUpperCase()}`, `OUT ${so.toUpperCase()}`, "MIN OUT", "TOL PBPS"], rows),
    ],
  };
}
