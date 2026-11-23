import { beforeEach, describe, expect, test } from "bun:test";
import { HttpError } from "./api.js";
import {
  activityCursor,
  fetchPoolParamsBulk,
  fetchPoolState,
  legNeedsChain,
  parsePoolState,
  resetPoolStateStore,
} from "./poolState.js";
import { call } from "./cli/mcp.js";

const leg = (o: Record<string, unknown> = {}) => ({
  token: "0xD18B7EC58CDF4876F6AFEBD3ED1730E4CE10414B",
  symbol: "CBBTC",
  snapshotBlock: 10,
  stale: false,
  ageMs: 500,
  decimals: 8,
  flags: 3824,
  reserves: "29093926",
  liabilities: "28602723",
  invested: "0",
  liquidReserves: "29093926",
  liquidityIndexWad: "1000280056705725967",
  minLiquidity: "0",
  depositCapCode: 36,
  deadSeedPow10: 1,
  curveId: 6,
  minFeePbps: 300,
  lpToken: "0xdb8b343bb0c89ccf34862d0f33351d60fca9b19d",
  lpTotalSupply: "28593834",
  hook: { flags: 0, target: "0x0000000000000000000000000000000000000000" },
  mark: null,
  ...o,
});
const pool = (o: Record<string, unknown> = {}) => ({
  address: "0xBBBBBBBD7060B1CED79C381EAD40D73FCB9AE0C6",
  tag: "btr-core",
  generation: "v2",
  status: "live",
  seq: 1,
  etag: "e",
  snapshotBlock: 10,
  stale: false,
  storageVersion: 12,
  feeParams: { protoSharePct: 10, flowCooldownSecs: 15 },
  solvency: { cWad: "997472456410008521", ok: true, tollWad: "708529511881702" },
  legs: [leg()],
  ...o,
});
const body = (pools = [pool()]) => ({ v: 1, chainId: 143, block: 10, servedAt: 1000, pools });

beforeEach(() => resetPoolStateStore());

describe("parsePoolState", () => {
  test("decimal-string ints become bigint, addresses lowercased", () => {
    const s = parsePoolState(body());
    const l = s.pools[0].legs[0];
    expect(l.reserves).toBe(29093926n);
    expect(l.liquidityIndexWad).toBe(1000280056705725967n);
    expect(s.pools[0].solvency?.cWad).toBe(997472456410008521n);
    expect(s.pools[0].address).toBe("0xbbbbbbbd7060b1ced79c381ead40d73fcb9ae0c6");
  });
  test("null feeParams/solvency stay null, never 0", () => {
    const p = parsePoolState(body([pool({ feeParams: null, solvency: null })])).pools[0];
    expect(p.feeParams).toBeNull();
    expect(p.solvency).toBeNull();
  });
  test("a number where a decimal string belongs is refused", () => {
    expect(() => parsePoolState(body([pool({ legs: [leg({ reserves: 1 })] })]))).toThrow(
      "reserves",
    );
  });
  test("superseded is always stale; stale leg needs chain", () => {
    const s = parsePoolState(
      body([pool({ status: "superseded" }), pool({ legs: [leg({ stale: true })] })]),
    );
    expect(s.pools[0].stale).toBe(true);
    expect(legNeedsChain(s.pools[0])).toBe(true);
    expect(legNeedsChain(s.pools[1])).toBe(false);
    expect(legNeedsChain(s.pools[1], s.pools[1].legs[0])).toBe(true);
  });
  test("halted and retired pools read chain", () => {
    const s = parsePoolState(body([pool({ status: "halted" }), pool({ status: "retired" })]));
    expect(s.pools.map((p) => legNeedsChain(p))).toEqual([true, true]);
  });
});

describe("fetchPoolState", () => {
  test("ETag round trip: 304 reuses the stored snapshot", async () => {
    const seen: (string | null)[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const inm = new Headers(init.headers).get("If-None-Match");
      seen.push(inm);
      return inm === '"x1"'
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify(body()), { status: 200, headers: { etag: '"x1"' } });
    }) as unknown as typeof fetch;
    const a = await fetchPoolState(143, undefined, { fetch: f, base: "http://t" });
    const b = await fetchPoolState(143, undefined, { fetch: f, base: "http://t" });
    expect(seen).toEqual([null, '"x1"']);
    expect(b).toBe(a);
  });
  test("a body for another chain is refused", async () => {
    const f = (async () => new Response(JSON.stringify(body()))) as unknown as typeof fetch;
    await expect(fetchPoolState(1, undefined, { fetch: f, base: "http://c" })).rejects.toThrow(
      "chainId",
    );
  });
  test("503 throws HttpError for the chain fallback", async () => {
    const f = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await expect(
      fetchPoolState(143, { tag: "btr-core" }, { fetch: f, base: "http://t" }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

test("fetchPoolParamsBulk: one call, sorted dedup addresses, <= 32", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    return new Response(JSON.stringify({ chainId: 143, pools: {}, errors: {} }));
  }) as unknown as typeof fetch;
  await fetchPoolParamsBulk(
    143,
    { addresses: ["0xB", "0xa", "0xb"] },
    { fetch: f, base: "http://t" },
  );
  expect(urls).toEqual(["http://t/v1/pools/params?addresses=0xa%2C0xb&chainId=143"]);
  expect(() => fetchPoolParamsBulk(143, { tags: [] })).toThrow();
});

test("activityCursor is t:block:logIndex", () => {
  const r = { txHash: "0x3", logIndex: 1, block: 3, t: 3 };
  expect(activityCursor(r)).toBe("3:3:1");
});

test("MCP pools_state tool shares the store", async () => {
  const f = (async () => new Response(JSON.stringify(body()))) as unknown as typeof fetch;
  const out = (await call("pools_state", { chain: 143 }, { fetch: f, base: "http://m" })) as {
    pools: unknown[];
  };
  expect(out.pools).toHaveLength(1);
  const again = await fetchPoolState(143, undefined, {
    fetch: (async () => new Response(null, { status: 304 })) as unknown as typeof fetch,
    base: "http://m",
  });
  expect(again).toBe(out as never);
});
