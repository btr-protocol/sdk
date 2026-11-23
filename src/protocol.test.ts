import { expect, test } from "bun:test";
import { btrApi } from "./api.js";
import { fetchPoolParams, lpRows } from "./protocol.js";

const seen: Array<{ url: string; init: RequestInit }> = [];
const f = (async (url: string, init: RequestInit) => {
  seen.push({ url, init });
  return new Response('{"ok":1}');
}) as unknown as typeof fetch;

test("btrApi: query, chainId, POST body", async () => {
  await btrApi("/v1/activity", 143, {
    fetch: f,
    base: "http://x",
    query: { limit: 5, before: null },
  });
  expect(seen[0].url).toBe("http://x/v1/activity?limit=5&chainId=143");
  expect(seen[0].init.method).toBe("GET");
  await fetchPoolParams(143, "btr core", { fetch: f, base: "http://x" });
  expect(seen[1].url).toBe("http://x/v1/pools/btr%20core/params?chainId=143");
  await lpRows(143, { addr: "0x1", legs: [] }, { fetch: f, base: "http://x" });
  expect(seen[2].init.method).toBe("POST");
  expect(JSON.parse(String(seen[2].init.body))).toEqual({ addr: "0x1", legs: [] });
});

test("btrApi throws on non-2xx", async () => {
  const bad = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  await expect(btrApi("/v1/summary", 1, { fetch: bad, base: "http://x" })).rejects.toThrow("503");
});

test("fetchHalts: scope path + filters", async () => {
  const { fetchHalts } = await import("./protocol.js");
  await fetchHalts(143, "pool", { pool: "core", limit: 10 }, { fetch: f, base: "http://x" });
  expect(seen.at(-1)?.url).toBe("http://x/v1/halts/pool?pool=core&limit=10&chainId=143");
});

test("guard429: 429 arms the family, next call refused locally", async () => {
  const { HttpError, resetHttp429 } = await import("./api.js");
  resetHttp429();
  let n = 0;
  const hot = (async () => {
    n++;
    return new Response("{}", { status: 429, headers: { "Retry-After": "5" } });
  }) as unknown as typeof fetch;
  const o = { fetch: hot, base: "http://x", guard429: true };
  await expect(btrApi("/v1/summary", 1, o)).rejects.toBeInstanceOf(HttpError);
  await expect(btrApi("/v1/timeseries", 1, o)).rejects.toThrow("cooling down");
  expect(n).toBe(1);
  resetHttp429();
});
