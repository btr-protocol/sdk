import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ChainError } from './errors.js';
import { type ChainQuoteResponse, chainQuote, chainRoute, resetChainClientState } from './quote.js';

const realFetch = globalThis.fetch;

function hex(n: number | bigint): string {
  return `0x${n.toString(16)}`;
}

function quoted(amountOut: bigint, tolPbps: number) {
  const minOut = (amountOut * BigInt(1_000_000 - tolPbps)) / 1_000_000n;
  return {
    amount_out: hex(amountOut),
    spread_pbps: 459,
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

function quoteBody(block: number, amountOut = 1_000_000n, tol = 5_000): ChainQuoteResponse {
  return {
    chain_id: 1,
    block: { number: block, timestamp: 1_700_000_000 },
    source: 'chain',
    amounts: [quoted(amountOut, tol)],
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
      return new Response(JSON.stringify(quoteBody(100)), { status: 200 });
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
                amount_in: '0x1',
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
});
