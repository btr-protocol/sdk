/** Re-pull chainlist, probe every candidate live, and rewrite `.rpc` in the dex-evm
 *  `deployments/chains.json`: the ONE list of public RPCs (back/keepers via `btr-rpc`, and, through
 *  `gen-rpcs.ts`, the wallet network prompt and the browser). Nothing else keeps an RPC list.
 *
 *   bun scripts/refresh-rpcs.ts [--dry] [--grow] [--force] [--chains 56,143] [--chainlist <rpcs.json>]
 *   CHAINS_JSON=<path> overrides the target; the default is ../dex-evm/deployments/chains.json.
 *
 * Candidates = chainlist.org/rpcs.json (with its `tracking` flag) + the rows already in the file.
 * An endpoint is EXCLUDED when it is tracking (`yes`), carries a key or is a MEV/private variant,
 * is not a public https host, is dead, answers another chain id, cannot `eth_call`, or trails the
 * cohort's head by more than 2 blocks (a chain faster than ~1.3 blocks/s gets 1.5 s instead: 2
 * blocks of it is below the probe's own jitter). CORS is NOT a criterion: a row that answers a
 * browser preflight from btr.markets gets `"browser": true`, one that does not stays a good
 * back-only row. The sdk's wallet/browser picks are made among `browser` rows.
 *
 * Deterministic and reviewable: rows already in the file keep their hand-tuned numbers and their
 * order (a refresh never reorders the primary), only dropping when they fail. A chain with no
 * rows is populated (trusted host, tracking, latency bucket, url, up to MAX_ROWS); one that has
 * measured rows is widened only with --grow. Run it on a cron and
 * review the diff: a refresh that rewrites half a chain is the signal to read, not to merge.
 * The file is only written after every chain probed; a failed chainlist fetch aborts. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Tracking, norm, trusted, unusable } from './lib/rpcUrl';

/** The chains BTR serves or will: BNB, Monad, X Layer, Base, Avalanche, Arbitrum, Ethereum,
 *  Robinhood, Arc (mainnet + testnet), Polygon, HyperEVM. */
export const CHAIN_IDS = [1, 56, 137, 143, 196, 999, 4663, 5042, 5042002, 8453, 42161, 43114];
const CHAINLIST = 'https://chainlist.org/rpcs.json';
const ORIGIN = 'https://btr.markets';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
/** Rows per chain after a refresh; existing rows are never cut to reach it, only new ones held back. */
export const MAX_ROWS = 6;
const MAX_LAG_BLOCKS = 2;
const MAX_LAG_MS = 1500;
const ROUNDS = 3;
const ROUND_GAP_MS = 700;
const BATCH_LADDER = [2, 8, 16, 50, 100];
const TIMEOUT_MS = 8000;

export type Row = string | (Record<string, unknown> & { url: string });
export interface Chains {
  note?: string;
  slugs: Record<string, string>;
  default: number;
  rpc: Record<string, Row[]>;
  rps?: Record<string, number>;
  [k: string]: unknown;
}
export interface Probe {
  url: string;
  p50: number;
  lagBlocks: number;
  lagMs: number;
  batchMax: number;
  /** Answers a browser preflight from btr.markets. */
  browser: boolean;
}

// ── candidate filter ────────────────────────────────────────────────────────

export const urlOf = (r: Row) => norm(typeof r === 'string' ? r : r.url);

/** Latency bucket, coarse on purpose: a 40 ms wobble must not reorder the file. */
export const bucket = (ms: number) => (ms <= 150 ? 0 : ms <= 300 ? 1 : ms <= 600 ? 2 : 3);
const trackRank = (t: Tracking) => (t === 'none' ? 0 : t === undefined ? 1 : 2);

export const lagOk = (lagBlocks: number, lagMs: number) =>
  lagBlocks <= MAX_LAG_BLOCKS || lagMs <= MAX_LAG_MS;

/** Largest batch size that answered in full; 1 = the endpoint takes no batches. */
export function batchMaxOf(ok: Record<number, boolean>): number {
  let best = 1;
  for (const n of BATCH_LADDER) {
    if (!ok[n]) break;
    best = n;
  }
  return best;
}

// ── selection ───────────────────────────────────────────────────────────────

/** An existing row with its `browser` flag set from the probe (absent when not browser-callable).
 *  A bare string stays a string unless it earns the flag: `{url}` and `"url"` mean the same to
 *  `btr-rpc` (unpaced, weight 1, no known batch limit). An object gets its measured `batch_max`
 *  only when it had none. */
function flagged(r: Row, p: Probe): Row {
  if (typeof r === 'string') return p.browser ? { url: r, browser: true } : r;
  const { browser: _, ...rest } = r;
  return { ...rest, batch_max: r.batch_max ?? p.batchMax, ...(p.browser ? { browser: true } : {}) };
}

/** The chain's next rows: the existing rows that still pass (file order, form and numbers kept;
 *  an object row with no `batch_max` gets the measured one), then, when `grow`, new passers ranked
 *  (trusted host, tracking, latency bucket, url) up to MAX_ROWS at weight 1. A new row must be
 *  `tracking: none` per chainlist or a trusted host: unknown is not clean. New rows name no `rps`
 *  (unpaced, learned down on a throttle; `.rps` is the floor): an invented rate would be a
 *  measurement nobody made. A chain that already has measured rows is only pruned unless `grow`:
 *  a load-tested pool is not widened by whatever chainlist lists today. */
export function selectRows(
  existing: Row[],
  passed: Map<string, Probe>,
  tracking: Map<string, Tracking>,
  opt: { grow: boolean; trusted: (url: string) => boolean },
): Row[] {
  const out: Row[] = [];
  const have = new Set<string>();
  for (const r of existing) {
    const u = urlOf(r);
    const p = passed.get(u);
    if (!p || have.has(u)) continue;
    have.add(u);
    out.push(flagged(r, p));
  }
  if (!opt.grow) return out;
  const fresh = [...passed.values()]
    .filter((p) => !have.has(p.url) && (tracking.get(p.url) === 'none' || opt.trusted(p.url)))
    .sort(
      (a, b) =>
        Number(opt.trusted(b.url)) - Number(opt.trusted(a.url)) ||
        trackRank(tracking.get(a.url)) - trackRank(tracking.get(b.url)) ||
        bucket(a.p50) - bucket(b.p50) ||
        (a.url < b.url ? -1 : 1),
    );
  for (const p of fresh) {
    if (out.length >= MAX_ROWS) break;
    out.push({
      url: p.url,
      batch_max: p.batchMax,
      weight: 1,
      ...(p.browser ? { browser: true } : {}),
    });
  }
  return out;
}

// ── file format: the layout chains.json already has, so a refresh diffs only its rows ───────

const rowLine = (r: Row) =>
  typeof r === 'string'
    ? JSON.stringify(r)
    : `{${Object.entries(r)
        .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(', ')}}`;

const mapLines = (m: Record<string, unknown>, ind: string) =>
  Object.entries(m)
    .map(([k, v]) => `${ind}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');

export function render(f: Chains): string {
  const rpc = Object.entries(f.rpc)
    .map(([id, rows]) =>
      rows.every((r) => typeof r === 'string')
        ? `    ${JSON.stringify(id)}: [${rows.map(rowLine).join(', ')}]`
        : `    ${JSON.stringify(id)}: [\n${rows.map((r) => `      ${rowLine(r)}`).join(',\n')}\n    ]`,
    )
    .join(',\n');
  const parts = [
    ...(f.note === undefined ? [] : [`  "note": ${JSON.stringify(f.note)}`]),
    `  "slugs": {\n${mapLines(f.slugs, '  ')}\n  }`,
    `  "default": ${f.default}`,
    `  "rpc": {\n${rpc}\n  }`,
    ...(f.rps ? [`  "rps": {\n${mapLines(f.rps, '  ')}\n  }`] : []),
  ];
  return `{\n${parts.join(',\n')}\n}\n`;
}

// ── probing ─────────────────────────────────────────────────────────────────

async function call(url: string, body: unknown, origin?: string) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'manual', // a listed host must not steer the probe to another address
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      json: (await res.json()) as unknown,
      res,
      ms: performance.now() - t0,
      t: performance.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}
const req = (id: number, method: string, params: unknown[] = []) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});
const hex = (j: unknown) => {
  const r = (j as { result?: string })?.result;
  if (typeof r !== 'string') throw new Error('no result');
  return Number.parseInt(r, 16);
};

async function pool<T, R>(limit: number, items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let k = i++; k < items.length; k = i++) out[k] = await fn(items[k]);
    }),
  );
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Phase A: right chain, answers, `eth_call` works. Returns p50 ms of 5 head reads, or why not. */
async function alive(url: string, chainId: number): Promise<number | string> {
  // One retry: a throttle or a blip must not read as a verdict on a row someone load-tested.
  const first = await aliveOnce(url, chainId);
  if (typeof first === 'number') return first;
  await new Promise((r) => setTimeout(r, 1500));
  const again = await aliveOnce(url, chainId);
  return typeof again === 'number' ? again : first;
}

async function aliveOnce(url: string, chainId: number): Promise<number | string> {
  try {
    const id = hex((await call(url, req(1, 'eth_chainId'))).json);
    if (id !== chainId) return `chainId ${id}`;
    const ms: number[] = [];
    for (let i = 0; i < 5; i++) ms.push((await call(url, req(2, 'eth_blockNumber'))).ms);
    const c = (
      await call(url, req(3, 'eth_call', [{ to: MULTICALL3, data: '0x42cbb15c' }, 'latest']))
    ).json as {
      error?: unknown;
    };
    if (c.error) return 'eth_call refused';
    return Math.round(median(ms));
  } catch (e) {
    return `dead: ${String((e as Error).message).slice(0, 40)}`;
  }
}

/** Phase B: head lag against the cohort, in blocks and ms. Samples are aligned to one instant
 *  using the chain's own block time, so a slow responder is not blamed for being slow. */
async function lagOf(urls: string[]): Promise<Map<string, { blocks: number; ms: number }>> {
  const rounds: { n: number; t: number }[][] = [];
  for (let r = 0; r < ROUNDS; r++) {
    rounds.push(
      await Promise.all(
        urls.map(async (u) => {
          try {
            const x = await call(u, req(1, 'eth_blockNumber'));
            return { n: hex(x.json), t: x.t };
          } catch {
            return { n: Number.NaN, t: 0 };
          }
        }),
      ),
    );
    if (r < ROUNDS - 1) await new Promise((res) => setTimeout(res, ROUND_GAP_MS));
  }
  const best = (r: { n: number; t: number }[]) =>
    r.filter((s) => Number.isFinite(s.n)).sort((a, b) => b.n - a.n)[0];
  const [first, last] = [best(rounds[0]), best(rounds[ROUNDS - 1])];
  const dn = first && last ? last.n - first.n : 0;
  const bt = dn > 0 ? Math.max(1, (last.t - first.t) / dn) : 12_000;
  const lags = urls.map(() => [] as number[]);
  for (const round of rounds) {
    const tRef = median(round.filter((s) => Number.isFinite(s.n)).map((s) => s.t));
    const at = round.map((s) => s.n + (tRef - s.t) / bt);
    // The 75th percentile, not the max: one endpoint claiming a far-ahead head must not make every
    // honest one look late.
    const fin = at.filter(Number.isFinite).sort((a, b) => a - b);
    const head = fin[Math.floor(0.75 * (fin.length - 1))];
    at.forEach((x, i) => lags[i].push(Number.isFinite(x) ? head - x : Number.POSITIVE_INFINITY));
  }
  return new Map(urls.map((u, i) => [u, { blocks: median(lags[i]), ms: median(lags[i]) * bt }]));
}

/** Phase C: batch ladder and a browser CORS preflight from btr.markets. */
/** Would a browser page on btr.markets be allowed to call this endpoint (preflight and response)? */
async function corsOk(url: string): Promise<boolean> {
  try {
    const pre = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });
    const ao = pre.headers.get('access-control-allow-origin');
    const ah = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    if (!(ao === '*' || ao === ORIGIN) || !(ah.includes('*') || ah.includes('content-type')))
      return false;
    const post = await call(url, req(1, 'eth_chainId'), ORIGIN);
    const po = post.res.headers.get('access-control-allow-origin');
    return po === '*' || po === ORIGIN;
  } catch {
    return false;
  }
}

/** Phase C: the batch ladder, and the `browser` flag. CORS is a property of the row, not a
 *  criterion: a back-only endpoint without CORS is still a good back endpoint. */
async function wide(url: string): Promise<{ batchMax: number; browser: boolean }> {
  const ok: Record<number, boolean> = {};
  for (const n of BATCH_LADDER) {
    try {
      const { json } = await call(
        url,
        Array.from({ length: n }, (_, i) => req(i, 'eth_blockNumber')),
      );
      ok[n] =
        Array.isArray(json) && json.length === n && json.every((x) => 'result' in (x as object));
    } catch {
      ok[n] = false;
    }
    if (!ok[n]) break;
  }
  return { batchMax: batchMaxOf(ok), browser: await corsOk(url) };
}

interface Report {
  chain: number;
  kept: string[];
  dropped: [string, string][];
}

async function refreshChain(
  id: number,
  existing: Row[],
  list: { url: string; tracking?: Tracking }[],
  grow: boolean,
): Promise<{ rows: Row[]; report: Report }> {
  const tracking = new Map<string, Tracking>();
  const cand = new Map<string, string>(); // norm url → why not ('' = candidate)
  for (const c of list) tracking.set(norm(c.url), c.tracking);
  // Existing rows face the same filter: a hand-tuned row that chainlist flags as tracking goes too.
  for (const u of [...existing.map(urlOf), ...list.map((c) => norm(c.url))])
    if (!cand.has(u)) cand.set(u, unusable(u, tracking.get(u)) ?? '');
  const dropped: [string, string][] = [];
  for (const [u, why] of cand) if (why) dropped.push([u, why]);
  const live = [...cand].filter(([, why]) => !why).map(([u]) => u);

  const a = await pool(16, live, (u) => alive(u, id));
  const p50 = new Map<string, number>();
  live.forEach((u, i) =>
    typeof a[i] === 'number' ? p50.set(u, a[i] as number) : dropped.push([u, a[i] as string]),
  );

  const lag = await lagOf([...p50.keys()]);
  const stay = [...p50.keys()].filter((u) => {
    const l = lag.get(u)!;
    if (lagOk(l.blocks, l.ms)) return true;
    dropped.push([u, `lag ${l.blocks.toFixed(1)} blocks`]);
    return false;
  });

  const w = await pool(6, stay, wide);
  const passed = new Map<string, Probe>();
  stay.forEach((u, i) => {
    const r = w[i];
    const l = lag.get(u)!;
    passed.set(u, {
      url: u,
      p50: p50.get(u)!,
      lagBlocks: l.blocks,
      lagMs: l.ms,
      batchMax: r.batchMax,
      browser: r.browser,
    });
  });

  const rows = selectRows(existing, passed, tracking, {
    grow: grow || existing.length === 0,
    trusted: (u) => trusted(id, u),
  });
  const kept = rows.map(urlOf);
  for (const u of passed.keys()) if (!kept.includes(u)) dropped.push([u, 'over MAX_ROWS']);
  return {
    rows,
    report: { chain: id, kept, dropped: dropped.sort((x, y) => (x[0] < y[0] ? -1 : 1)) },
  };
}

// ── main ────────────────────────────────────────────────────────────────────

/** A refresh that would empty a chain, or cut it by more than half, is a bad run (a throttled
 *  runner, a chainlist outage), not a verdict: it writes nothing unless `--force`. */
export function sanity(before: number, after: number): string | null {
  if (before > 0 && after === 0) return 'would drop every row';
  if (before >= 4 && after * 2 < before) return `would cut ${before} rows to ${after}`;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => {
    const i = args.indexOf(k);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} needs a value`);
    return v;
  };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const target =
    process.env.CHAINS_JSON ?? join(root, '..', 'dex-evm', 'deployments', 'chains.json');
  if (!existsSync(target)) throw new Error(`${target} absent`);
  const ids = opt('--chains')?.split(',').map(Number) ?? CHAIN_IDS;

  const listFile = opt('--chainlist');
  const raw = listFile ? readFileSync(listFile, 'utf8') : await (await fetch(CHAINLIST)).text();
  const all = JSON.parse(raw) as { chainId: number; rpc: { url: string; tracking?: Tracking }[] }[];
  if (!Array.isArray(all) || all.length < 100)
    throw new Error('chainlist: implausible payload, nothing written');

  const file = JSON.parse(readFileSync(target, 'utf8')) as Chains;
  const extra = Object.keys(file).filter(
    (k) => !['note', 'slugs', 'default', 'rpc', 'rps'].includes(k),
  );
  if (extra.length)
    throw new Error(`chains.json has keys render() would drop: ${extra.join(', ')}`);
  const bad: string[] = [];
  for (const id of ids) {
    const list = (all.find((c) => c.chainId === id)?.rpc ?? []).filter(
      (c) => typeof c?.url === 'string',
    );
    const before = (file.rpc[id] ?? []).filter(
      (r) => typeof r === 'string' || typeof r?.url === 'string',
    );
    const { rows, report } = await refreshChain(id, before, list, args.includes('--grow'));
    console.log(`\n== ${id}: kept ${report.kept.length} of ${before.length} existing`);
    for (const u of report.kept) console.log(`  + ${u}`);
    for (const [u, why] of report.dropped) console.log(`  - ${u}  (${why})`);
    const why = sanity(before.length, rows.length);
    if (why) bad.push(`${id}: ${why}`);
    if (rows.length) file.rpc[id] = rows;
    else delete file.rpc[id];
  }
  if (bad.length && !args.includes('--force'))
    throw new Error(`refusing to write (pass --force to override):\n  ${bad.join('\n  ')}`);
  if (args.includes('--dry')) return console.log('\n--dry: nothing written');
  writeFileSync(target, render(file));
  console.log(`\nwrote ${target}`);
}

if (import.meta.main) await main();
