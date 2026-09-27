/**
 * On-chain seed marks: `getFeed(bytes32)` on the chain's PoolFactory, i.e. the P-tier store word
 * every pool prices from. Once the oracle is live this is the only source a pool seed may use:
 * an NXR REST ticker can be dead (EUR-USDC on a weekend) while the signed on-chain mark, built from
 * a different row (USDC-EUR inverted), is fresh, and the reverse. Seed and pricing must agree.
 */

/** `getFeed(bytes32)` selector. */
export const GET_FEED = '0x280aebcf';
/** Headroom under ttl a seed mark must keep: a mark closer to expiry can lapse mid-ceremony. */
export const TTL_HEADROOM_SECS = 300;

/** Decode an `IOracle.FeedData` return and gate it: mark > 0, not halted, `now - updatedAt < ttl - 300`.
 *  Field order (8 static words): mark1e18, sigmaPbps, updatedAtSecs, ttlSecs, confidenceBps,
 *  flags, maxDevBps, sourceTsMs. */
export function gateFeed(
  ret: string,
  nowSecs: number,
): { mark1e18: bigint; ageSecs: number; ttlSecs: number } | { err: string } {
  const hex = ret.startsWith('0x') ? ret.slice(2) : ret;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== 8 * 64)
    return { err: `getFeed returned ${hex.length / 2} bytes, want 256` };
  const w = (i: number) => BigInt(`0x${hex.slice(i * 64, (i + 1) * 64)}`);
  const mark1e18 = w(0);
  const at = Number(w(2));
  const ttlSecs = Number(w(3));
  const halted = (w(5) & 1n) === 1n;
  if (mark1e18 === 0n) return { err: 'mark is 0 (lane dark or halted)' };
  if (halted) return { err: 'feed halted' };
  if (at > nowSecs + 60) return { err: `updatedAt ${at} is ahead of local clock ${nowSecs}` };
  const ageSecs = Math.max(0, nowSecs - at);
  if (!(ageSecs < ttlSecs - TTL_HEADROOM_SECS))
    return {
      err: `mark ${ageSecs}s old, bound ttl-${TTL_HEADROOM_SECS} = ${ttlSecs - TTL_HEADROOM_SECS}s`,
    };
  return { mark1e18, ageSecs, ttlSecs };
}

/** One `eth_call getFeed(feedId)`; retried because Arc RPC drops reads. A read that never answers is
 *  an error, never an empty mark. */
export async function readFeed(rpc: string, factory: string, feedId: string): Promise<string> {
  const id = feedId.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(id)) throw new Error(`bad feed id ${feedId}`);
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: factory, data: GET_FEED + id }, 'latest'],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const j = (await r.json()) as { result?: string; error?: { message?: string } };
      if (typeof j.result === 'string') return j.result;
      last = j.error?.message ?? `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`getFeed ${feedId}: ${last}`);
}
