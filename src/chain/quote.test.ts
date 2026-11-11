import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ChainError } from './errors.js';
import {
  type ChainQuoteResponse,
  chainQuote,
  chainRoute,
  resetChainClientState,
  slippageTolPbps,
} from './quote.js';

const realFetch = globalThis.fetch;

function hex(n: number | bigint): string {
  return `0x${n.toString(16)}`;
}

/** `tol` defaults to 229: `pct=50` of the 459 pbps spread the helper serves (truncated by the
 *  service), so the default body is one a real `slippage::floor` can author. */
function quoted(amountOut: bigint, tolPbps: number, spreadPbps = 459) {
  const minOut = (amountOut * BigInt(1_000_000 - tolPbps)) / 1_000_000n;
  return {
    amount_out: hex(amountOut),
    spread_pbps: spreadPbps,
    proto_fee: '0x0',
    lp_fee: '0x0',
    cov_toll: '0x0',
    mark_price: '0x0',
    mid_price: '0x0',
    route_hops: [],
    hop_amounts: [],
    tol_pbps: tolPbps,
    min_out: hex(minOut),
  };
}

function quoteBody(
  block: number,
  amountOut = 1_000_000n,
  tol = 229,
  spread = 459,
): ChainQuoteResponse {
  return {
    chain_id: 1,
    block: { number: block, timestamp: 1_700_000_000 },
    source: 'chain',
    amounts: [quoted(amountOut, tol, spread)],
    flags: { in: 2, out: 2, swap_enabled: true, halted: false },
  };
}

function stub(body: unknown, status = 200, headers: Record<string, string> = {}): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as unknown as typeof fetch;
}

const REQ = {
  chain_id: 1,
  token_in: '0x0000000000000000000000000000000000000001',
  token_out: '0x0000000000000000000000000000000000000002',
  amounts_in: ['0xde0b6b3a7640000'],
  slippage: { mode: 'spread', pct: 50 } as const,
};

describe('chain quote client', () => {
  beforeEach(() => {
    resetChainClientState();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetChainClientState();
  });

  test('sends the request chain as ?chainId=', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ ...quoteBody(100), chain_id: 56 }), { status: 200 });
    }) as unknown as typeof fetch;
    await chainQuote({ ...REQ, chain_id: 56 });
    expect(urls[0]).toEndWith('/v1/chain/quote?chainId=56');
  });

  test('accepts a floor the server derived from the same quote', async () => {
    stub(quoteBody(100));
    const res = await chainQuote(REQ);
    expect(res.block.number).toBe(100);
    const a = res.amounts[0];
    expect('amount_out' in a).toBe(true);
  });

  // `maxTolPbps` is the CALLER's ceiling. The service's SlippageWire has no such field, so sending
  // it would be an unknown-key 400 risk on a strict deserializer.
  test('does not send the caller-side ceiling to the server', async () => {
    let body: { slippage?: Record<string, unknown> } = {};
    globalThis.fetch = (async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(JSON.stringify(quoteBody(100)), { status: 200 });
    }) as unknown as typeof fetch;
    await chainQuote({ ...REQ, slippage: { mode: 'spread', pct: 50, maxTolPbps: 5_000 } });
    expect(body.slippage).toEqual({ mode: 'spread', pct: 50 });
  });

  // A-1119 cross-repo pin: the back `slippage::floor` must derive `min_out` from the RETURNED
  // `tol_pbps`, so for the pinned `pct=50, spread=459` case (`tol=229`) the served pair is
  // `out·999771/1e6`. The old spread formula (`out·(1e8−50·459)/1e8`) differs and is rejected.
  test('pins the server pct=50/spread=459 floor to the single formula', async () => {
    const out = 1_000_126_823_145_566_548_528n;
    const tol = Math.trunc((50 * 459) / 100);
    expect(tol).toBe(229);
    const minOut = (out * BigInt(1_000_000 - tol)) / 1_000_000n;
    expect(minOut).toBe(999_897_794_103_066_213_788n);
    const body = quoteBody(100, out, tol);
    (body.amounts[0] as { min_out: string }).min_out = hex(minOut);
    stub(body);
    await expect(chainQuote(REQ)).resolves.toBeDefined();

    // The pre-fix spread floor (`out·(1e8 − 50·459)/1e8`) differs and must now fail.
    const oldOut = (out * (100_000_000n - 50n * 459n)) / 100_000_000n;
    const bad = quoteBody(101, out, tol);
    (bad.amounts[0] as { min_out: string }).min_out = hex(oldOut);
    stub(bad);
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('rejects a floor that does not match amount_out*(1e6-tol)/1e6', async () => {
    const bad = quoteBody(100);
    (bad.amounts[0] as { min_out: string }).min_out = hex(1n); // far below the promised floor
    stub(bad);
    await expect(chainQuote(REQ)).rejects.toBeInstanceOf(ChainError);
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  // The formula is SELF-consistency: the server writes both of its sides. A 99.9% tolerance — the
  // widest `slippage::floor` will author — satisfies it exactly while leaving no floor to speak of,
  // and the swap is sandwiched for almost the whole amount.
  test('refuses a tolerance the request could not have produced', async () => {
    stub(quoteBody(100, 1_000_000n, 999_000));
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('a relative request is bounded by its own pbps, not the service ceiling', async () => {
    const req = { ...REQ, slippage: { mode: 'relative', pbps: 50 } as const };
    stub(quoteBody(100, 1_000_000n, 5_000));
    await expect(chainQuote(req)).rejects.toMatchObject({ kind: 'floor_violation' });
    // 100 pbps is where `slippage::floor` clamps a 50 pbps request, so it is the legal ceiling.
    stub(quoteBody(101, 1_000_000n, 100));
    await expect(chainQuote(req)).resolves.toBeDefined();
  });

  // The reported case: pct=50 of a 459 pbps spread authorizes 229 pbps, but `policyTolPbps` used
  // 50% of the uint16 field maximum (32 767), so a server floor at 2.00% (20 000 pbps) — ~87x
  // looser than the user's intent — passed. It must now throw floor_violation.
  test('rejects a 20 000 pbps floor on a pct=50 / 459 pbps spread', async () => {
    stub(quoteBody(100, 1_000_000n, 20_000));
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('accepts the 229 pbps floor the served 459 pbps spread authorizes', async () => {
    stub(quoteBody(100, 1_000_000n, 229));
    await expect(chainQuote(REQ)).resolves.toBeDefined();
  });

  // The absolute ceiling is independent of the spread: even a quote that claims the field maximum
  // spread (65 535 pbps) cannot authorize a 2% tolerance under the 1% default.
  test('defaults the absolute ceiling to 1% of the quote', async () => {
    stub(quoteBody(100, 1_000_000n, 20_000, 65_535));
    await expect(chainQuote(REQ)).rejects.toMatchObject({
      kind: 'ceiling_exceeded',
      message: expect.stringContaining('raise maxTolPbps'),
    });
    stub(quoteBody(101, 1_000_000n, 10_000, 65_535));
    await expect(chainQuote(REQ)).resolves.toBeDefined();
  });

  // Both bounds hold: 5 000 pbps is under the 1% ceiling but ~21x the served spread's 229 pbps.
  test('rejects a floor wider than pct% of the served spread', async () => {
    stub(quoteBody(100, 1_000_000n, 5_000));
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('honours a caller maxTolPbps tighter than the 1% default', async () => {
    const req = { ...REQ, slippage: { mode: 'spread', pct: 50, maxTolPbps: 200 } as const };
    stub(quoteBody(100, 1_000_000n, 200));
    await expect(chainQuote(req)).resolves.toBeDefined();
    stub(quoteBody(101, 1_000_000n, 201));
    await expect(chainQuote(req)).rejects.toMatchObject({ kind: 'ceiling_exceeded' });
  });

  test('ceiling_exceeded carries the bound values as fields, message unchanged', async () => {
    const req = { ...REQ, slippage: { mode: 'spread', pct: 50, maxTolPbps: 200 } as const };
    stub(quoteBody(102, 1_000_000n, 201));
    const err = (await chainQuote(req).catch((e: unknown) => e)) as ChainError;
    expect(err).toBeInstanceOf(ChainError);
    expect(err.kind).toBe('ceiling_exceeded');
    expect(err.message).toBe(
      'server tol_pbps 201 exceeds the caller ceiling 200; raise maxTolPbps to accept this quote',
    );
    expect(err.fields).toEqual({ servedSpreadPbps: 459, tolPbps: 201, maxTolPbps: 200 });
  });

  test('floor_violation past pct% of the served spread carries the spread and tolerance', async () => {
    stub(quoteBody(100, 1_000_000n, 5_000));
    const err = (await chainQuote(REQ).catch((e: unknown) => e)) as ChainError;
    expect(err.kind).toBe('floor_violation');
    expect(err.fields).toEqual({ servedSpreadPbps: 459, tolPbps: 5_000 });
  });

  test('a string tol_pbps from the wire is never carried into fields', async () => {
    const req = { ...REQ, slippage: { mode: 'spread', pct: 50, maxTolPbps: 200 } as const };
    stub({ ...quoteBody(103), amounts: [{ ...quoted(1_000_000n, 201), tol_pbps: '201' }] });
    const ceil = (await chainQuote(req).catch((e: unknown) => e)) as ChainError;
    expect(ceil).toBeInstanceOf(ChainError);
    expect(ceil.fields?.tolPbps).toBeUndefined();
    for (const v of Object.values(ceil.fields ?? {})) expect(typeof v).toBe('number');

    stub({ ...quoteBody(104), amounts: [{ ...quoted(1_000_000n, 5_000), tol_pbps: '5000' }] });
    const band = (await chainQuote(REQ).catch((e: unknown) => e)) as ChainError;
    expect(band.kind).toBe('floor_violation');
    expect(band.fields).toEqual({ servedSpreadPbps: 459 });
  });

  test('exports the tolerance ceiling constant from the package entry', async () => {
    const entry = await import('../index');
    expect(entry.MAX_TOL_PBPS).toBe(999_000);
  });

  test('refuses a maxTolPbps outside the legal range before the request', async () => {
    for (const maxTolPbps of [99, 999_001, 100.5]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      const req = { ...REQ, slippage: { mode: 'spread', pct: 50, maxTolPbps } as const };
      await expect(chainQuote(req)).rejects.toMatchObject({ kind: 'bad_request' });
      expect(calls).toBe(0);
    }
  });

  test('refuses a non-finite spread pct before the request', async () => {
    for (const pct of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      const req = { ...REQ, slippage: { mode: 'spread', pct } as const };
      await expect(chainQuote(req)).rejects.toMatchObject({ kind: 'bad_request' });
      expect(calls).toBe(0);
    }
  });

  test.each([undefined, '459', Number.NaN, Number.POSITIVE_INFINITY, -1, 65_536])(
    'rejects invalid spread_pbps %s',
    async (spread) => {
      const b = quoteBody(100);
      const amount = b.amounts[0] as unknown as Record<string, unknown>;
      if (spread === undefined) Reflect.deleteProperty(amount, 'spread_pbps');
      else amount.spread_pbps = spread;
      stub(b); // JSON encodes NaN/Infinity as null, which must also fail closed.
      await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
    },
  );

  test('rejects a spread parsed as non-finite from JSON', async () => {
    const json = JSON.stringify(quoteBody(100)).replace('"spread_pbps":459', '"spread_pbps":1e400');
    globalThis.fetch = (async () => new Response(json)) as unknown as typeof fetch;
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test.each([5, 400])('clamps spread pct %s to the service range', async (pct) => {
    const req = { ...REQ, slippage: { mode: 'spread', pct, maxTolPbps: 999_000 } as const };
    const clamped = pct === 5 ? 10 : 300;
    expect(slippageTolPbps(req.slippage)).toBe(Math.floor((clamped * 65_535) / 100));
    const boundary = Math.ceil((clamped * 459) / 100) + 1;
    stub(quoteBody(100, 1_000_000n, boundary));
    await expect(chainQuote(req)).resolves.toBeDefined();
    stub(quoteBody(101, 1_000_000n, boundary + 1));
    await expect(chainQuote(req)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('permits ceil(pct% spread)+1 and rejects +2', async () => {
    stub(quoteBody(100, 1_000_000n, 231));
    await expect(chainQuote(REQ)).resolves.toBeDefined();
    stub(quoteBody(101, 1_000_000n, 232));
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test.each([100, 999_000])('accepts maxTolPbps endpoint %s', async (maxTolPbps) => {
    const slippage = { mode: 'spread', pct: 50, maxTolPbps } as const;
    expect(slippageTolPbps(slippage)).toBe(Math.min(32_767, maxTolPbps));
    stub(quoteBody(100, 1_000_000n, 100));
    await expect(chainQuote({ ...REQ, slippage })).resolves.toBeDefined();
  });

  test.each([
    ['zero amount', '0', '0'],
    ['negative amount', '-1', '0'],
    ['zero minimum', '1', '0'],
    ['negative minimum', '1', '-1'],
  ])('rejects %s on a non-refused quote', async (_, amountOut, minOut) => {
    const b = quoteBody(100);
    Object.assign(b.amounts[0], { amount_out: amountOut, min_out: minOut });
    stub(b);
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('leaves refused amounts alone', async () => {
    const b = quoteBody(100);
    b.amounts = [{ refused: { name: 'NoLiquidity', selector: '0x12345678', args: [] } }];
    stub(b);
    await expect(chainQuote(REQ)).resolves.toBeDefined();
  });

  test('relative mode ignores spread and keeps its existing clamps', async () => {
    for (const pbps of [5, 5_000, 999_001]) {
      const slippage = { mode: 'relative', pbps } as const;
      const tol = Math.min(999_000, Math.max(100, pbps));
      expect(slippageTolPbps(slippage)).toBe(tol);
      const b = quoteBody(100, 1_000_000n, tol);
      Reflect.deleteProperty(b.amounts[0] as unknown as Record<string, unknown>, 'spread_pbps');
      stub(b);
      await expect(chainQuote({ ...REQ, slippage })).resolves.toBeDefined();
    }
  });

  test('invalid server floors take priority over a caller ceiling', async () => {
    const b = quoteBody(100, 1_000_000n, 20_000, 65_535);
    Object.assign(b.amounts[0], { min_out: '1' });
    stub(b);
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'floor_violation' });
  });

  test('drops a response from an older block than the last accepted', async () => {
    stub(quoteBody(100));
    await chainQuote(REQ);
    stub(quoteBody(99));
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'stale_block' });
  });

  test('429 opens one cooldown and refuses the next call without an RPC', async () => {
    stub({ error: 'rate_limited' }, 429, { 'retry-after': '7' });
    await expect(chainQuote(REQ)).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSecs: 7,
    });
    // The second call is refused locally: fetch would still answer 429, so count invocations.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('{}', { status: 429 });
    }) as unknown as typeof fetch;
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(calls).toBe(0);
  });

  test('503 maps to rpc_unavailable and is not a verdict on liquidity', async () => {
    stub({ error: 'rpc_unavailable', detail: 'rpc: transport down' }, 503, { 'retry-after': '2' });
    let err: ChainError | undefined;
    try {
      await chainQuote(REQ);
    } catch (e) {
      err = e as ChainError;
    }
    expect(err?.kind).toBe('rpc_unavailable');
    expect(err?.status).toBe(503);
  });

  // A-1135: a 501 is a permanent "endpoint not supported" verdict. Mapping it to `transport`
  // made callers retry a request the server will never serve.
  test('501 maps to not_implemented, not a retryable transport', async () => {
    stub({ error: 'max_hops > 2 is not supported' }, 501);
    let err: ChainError | undefined;
    try {
      await chainQuote(REQ);
    } catch (e) {
      err = e as ChainError;
    }
    expect(err?.kind).toBe('not_implemented');
    expect(err?.status).toBe(501);
  });

  // An unserved chainId (or a removed path) 404s on every retry: a verdict, not a transport fault.
  test('404 maps to not_found, not a retryable transport', async () => {
    stub({ error: 'chain 1 not served' }, 404);
    let err: ChainError | undefined;
    try {
      await chainQuote(REQ);
    } catch (e) {
      err = e as ChainError;
    }
    expect(err?.kind).toBe('not_found');
    expect(err?.status).toBe(404);
  });

  test('checks route floors the same way', async () => {
    const body = {
      chain_id: 1,
      block: { number: 5, timestamp: 1 },
      source: 'chain',
      best: {
        parts: [
          {
            hops: [
              {
                pool: 'btr-stable',
                token_in: 'a',
                token_out: 'b',
                amount_in: '0xde0b6b3a7640000',
                amount_out: '0x2',
              },
            ],
          },
        ],
        floors: [
          {
            token: '0x0000000000000000000000000000000000000002',
            amount_out: hex(1_000_000n),
            tol_pbps: 5_000,
            min_out: hex(995_000n),
          },
        ],
      },
      singles: [],
      refused: [],
    };
    stub(body);
    const res = await chainRoute({
      chain_id: 1,
      token_in: '0x0000000000000000000000000000000000000001',
      token_out: '0x0000000000000000000000000000000000000002',
      amount_in: '0xde0b6b3a7640000',
      slippage: { mode: 'relative', pbps: 5_000 },
    });
    expect(res.best?.floors[0].tol_pbps).toBe(5_000);
  });

  // A response for another chain prices (and floors) the wrong assets: rejected as
  // transport, never priced.
  test('rejects a quote answered for another chain', async () => {
    stub({ ...quoteBody(100), chain_id: 56 });
    await expect(chainQuote(REQ)).rejects.toMatchObject({ kind: 'transport' });
  });

  test('rejects a route answered for another chain', async () => {
    stub({
      chain_id: 56,
      block: { number: 5, timestamp: 1 },
      source: 'chain',
      best: null,
      singles: [],
      refused: [],
    });
    await expect(
      chainRoute({
        chain_id: 1,
        token_in: '0x0000000000000000000000000000000000000001',
        token_out: '0x0000000000000000000000000000000000000002',
        amount_in: '0xde0b6b3a7640000',
        slippage: { mode: 'relative', pbps: 5_000 },
      }),
    ).rejects.toMatchObject({ kind: 'transport' });
  });
});

// The route wire names its own hops. A part entering on a token the user did not pick,
// or spending another size, would carry the typed raw amount into a pair nobody asked for.
describe('chain route shape', () => {
  const TIN = '0x0000000000000000000000000000000000000001';
  const TOUT = '0x0000000000000000000000000000000000000002';
  const IN = 10n ** 18n;
  const hop = (pool: string, tin: string, tout: string, amountIn = IN) => ({
    pool,
    token_in: tin,
    token_out: tout,
    amount_in: hex(amountIn),
    amount_out: hex(1_000_000n),
  });
  const body = (
    parts: ReturnType<typeof hop>[][],
    singles: ReturnType<typeof hop>[][] = parts,
    floorToken = TOUT,
  ) => ({
    chain_id: 1,
    block: { number: 9, timestamp: 1 },
    source: 'chain',
    best: {
      parts: parts.map((hops) => ({ hops })),
      floors: [
        { token: floorToken, amount_out: hex(1_000_000n), tol_pbps: 5_000, min_out: hex(995_000n) },
      ],
    },
    singles: singles.map((hops) => ({ hops })),
    refused: [],
  });
  const route = () =>
    chainRoute({
      chain_id: 1,
      token_in: TIN,
      token_out: TOUT,
      amount_in: hex(IN),
      slippage: { mode: 'relative', pbps: 5_000 },
    });
  const kindOf = async (): Promise<string | undefined> => {
    try {
      await route();
    } catch (e) {
      return e instanceof ChainError ? e.kind : 'untyped';
    }
    return undefined;
  };
  const AB = [hop('btr-stable', 'A', 'H'), hop('btr-crypto', 'H', 'B')];

  test('a joined A->H->B part spending exactly amount_in passes', async () => {
    stub(body([AB]));
    expect((await route()).best?.parts[0].hops).toHaveLength(2);
  });

  // Route floors carry no `spread_pbps`, so only the request's absolute ceiling bounds them; a
  // 20 000 pbps floor exceeds the default 1% ceiling.
  test('a spread request bounds route floors by its absolute ceiling', async () => {
    const b = body([AB]);
    b.best.floors[0] = {
      token: TOUT,
      amount_out: hex(1_000_000n),
      tol_pbps: 20_000,
      min_out: hex(980_000n),
    };
    stub(b);
    await expect(
      chainRoute({
        chain_id: 1,
        token_in: TIN,
        token_out: TOUT,
        amount_in: hex(IN),
        slippage: { mode: 'spread', pct: 50 },
      }),
    ).rejects.toMatchObject({ kind: 'ceiling_exceeded' });
  });

  test.each([
    ['0', '0'],
    ['1', '0'],
    ['-1', '0'],
    ['1', '-1'],
  ])('rejects non-positive route floor %s / %s', async (amountOut, minOut) => {
    const b = body([AB]);
    Object.assign(b.best.floors[0], { amount_out: amountOut, min_out: minOut });
    stub(b);
    expect(await kindOf()).toBe('floor_violation');
  });

  test.each([
    ['a single entering on another token', body([AB], [AB, [hop('btr-crypto', 'C', 'B')]])],
    ['a single exiting on another token', body([AB], [AB, [hop('btr-stable', 'A', 'C')]])],
    ['a disjoint part', body([[hop('btr-stable', 'A', 'H'), hop('btr-crypto', 'C', 'B')]], [])],
    ['an empty part', body([[]], [])],
    ['a best spending less than amount_in', body([[hop('btr-stable', 'A', 'B', IN - 1n)]], [])],
    ['a single at another size', body([AB], [[hop('btr-stable', 'A', 'B', IN * 2n)]])],
    ['a floor on another token', body([AB], [AB], TIN)],
    [
      'a non-integer amount',
      body(
        [[hop('btr-stable', 'A', 'B')]].map((p) => p.map((h) => ({ ...h, amount_in: 'x' }))),
        [],
      ),
    ],
  ] as const)('refuses %s', async (_, b) => {
    stub(b);
    expect(await kindOf()).toBe('transport');
  });
});
