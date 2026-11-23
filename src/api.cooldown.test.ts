import { afterAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  HttpError,
  familyOf,
  guard429,
  http429Cooldown,
  http429RemainingMs,
  noteHttp429,
  resetHttp429,
  btrFetch,
} from "./api.js";

// The cooldown is module state shared with other test files: start and leave it clean.
beforeEach(() => resetHttp429());
const T0 = Date.UTC(2000, 0, 1);
const realFetch = globalThis.fetch;
afterAll(() => {
  resetHttp429();
  globalThis.fetch = realFetch;
  setSystemTime();
});
const reply = (status: number, headers: Record<string, string> = {}) => {
  globalThis.fetch = (async () => new Response("{}", { status, headers })) as unknown as typeof fetch;
};

describe("per-family 429 cooldown", () => {
  test("every family is pinned, so a rename cannot silently get its own bucket", () => {
    const urls: Record<string, string> = {
      "/api/v1/summary?window=24h&chainId=143": "metrics",
      "/v1/timeseries?metric=vol.usd": "metrics",
      "https://api.btr.markets/v1/timeseries/bulk?chainId=1": "metrics",
      "/v1/indicators": "quote",
      "/v1/lp-rows": "quote",
      "/v1/quote?chainId=143": "quote",
      "/v1/depth": "depth",
      "/v1/pools/BTC-USDC/density?window=7d": "density",
      "/v1/pools/X-Y/params": "/v1/pools/X-Y/params",
      "/v1/halts/pool?chainId=143": "/v1/halts/pool",
    };
    for (const [u, fam] of Object.entries(urls)) expect([u, familyOf(u)]).toEqual([u, fam]);
    for (const u of [
      "/v1/md/ohlc/BTC-USDC?tf=1h",
      "/v1/md/tickers",
      "https://api.btr.markets/v1/md/tickers/detail",
      "/md/price/BTC",
    ])
      expect(familyOf(u)).toBe("market");
    expect(familyOf("/quote")).toBe("quote");
  });

  test("a host or an unrelated path that merely contains a family word does not join it", () => {
    expect(familyOf("https://quote.example.com/v1/roster")).toBe("/v1/roster");
    expect(familyOf("/v1/roster/quote-x")).toBe("/v1/roster/quote-x");
    expect(familyOf("/v1/summaryx")).toBe("/v1/summaryx");
    expect(familyOf("/v1/pools/BTC-USDC/params?x=/quote")).toBe("/v1/pools/BTC-USDC/params");
    expect(familyOf("/v1/oracle/pushes/quote")).toBe("/v1/oracle/pushes/quote");
  });

  test("a metrics 429 does not delay a quote; the metrics family itself is refused", async () => {
    setSystemTime(new Date(T0));
    reply(429);
    await btrFetch("/v1/summary?window=24h", { guard429: true });
    expect(http429Cooldown("metrics")).toBe(true);
    expect(http429Cooldown("quote")).toBe(false);
    expect(() => guard429("/quote")).not.toThrow(); // a quote goes straight out
    expect(() => guard429("/v1/timeseries/bulk")).toThrow(HttpError);
    setSystemTime(new Date(T0 + 25_000));
    expect(http429Cooldown("metrics")).toBe(false);
  });

  test("a quote 429 behaves as on main: 20 s by default, refuses locally, other families untouched", async () => {
    setSystemTime(new Date(T0 + 100_000));
    reply(429);
    await btrFetch("/v1/quote", { guard429: true });
    expect(http429RemainingMs("quote")).toBe(20_000);
    expect(() => guard429("/quote")).toThrow(HttpError);
    expect(http429Cooldown("metrics")).toBe(false);
    setSystemTime(new Date(T0 + 100_000 + 20_001));
    expect(() => guard429("/quote")).not.toThrow();
  });

  test("Retry-After sets the family cooldown, capped; no family means any family cooling", async () => {
    setSystemTime(new Date(T0 + 200_000));
    reply(429, { "Retry-After": "3600" });
    await btrFetch("/v1/md/tickers", { guard429: true });
    expect(http429RemainingMs("market")).toBe(60_000);
    expect(http429Cooldown()).toBe(true);
    expect(http429Cooldown("quote")).toBe(false);
    noteHttp429("quote", 1);
    expect(http429RemainingMs("quote")).toBe(1);
  });
});

describe("btrFetch signals", () => {
  test("caller abort and timeout both apply", async () => {
    globalThis.fetch = ((_u: string, i: RequestInit) =>
      new Promise((_r, rej) =>
        i.signal?.addEventListener("abort", () => rej(i.signal?.reason)),
      )) as unknown as typeof fetch;
    const c = new AbortController();
    const p = btrFetch("/v1/x", { signal: c.signal, timeoutMs: 60_000 });
    c.abort(new Error("caller"));
    await expect(p).rejects.toThrow("caller");
    await expect(btrFetch("/v1/x", { timeoutMs: 5 })).rejects.toBeDefined();
  });
});
