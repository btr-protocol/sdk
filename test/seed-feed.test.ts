import { describe, expect, test } from 'bun:test';
import { AGE_SATURATES_SECS, TTL_HEADROOM_SECS, gateFeed, readFeed } from '../scripts/seed-feed';

// Encode FeedData as the 8 static words getFeed returns.
const enc = (mark: bigint, at: number, ttl: number, flags = 0) =>
  `0x${[mark, 7n, BigInt(at), BigInt(ttl), 3n, BigInt(flags), 50n, BigInt(at) * 1000n]
    .map((v) => v.toString(16).padStart(64, '0'))
    .join('')}`;

const NOW = 1_790_528_612;

describe('on-chain seed mark gate', () => {
  test('fresh mark passes with the exact 1e18 word', () => {
    const g = gateFeed(enc(1_138_000_000_000_000_000n, NOW - 12, 3600), NOW);
    expect(g).toEqual({ mark1e18: 1_138_000_000_000_000_000n, ageSecs: 12, ttlSecs: 3600 });
  });
  test('age at ttl-300 fails closed; one second under passes', () => {
    const b = 600 - TTL_HEADROOM_SECS;
    expect('err' in gateFeed(enc(1n, NOW - b, 600), NOW)).toBe(true);
    expect('err' in gateFeed(enc(1n, NOW - b + 1, 600), NOW)).toBe(false);
  });
  test('ttl under the headroom can never pass', () => {
    expect('err' in gateFeed(enc(1n, NOW, 300), NOW)).toBe(true);
  });
  test('zero mark, halt bit, future stamp, short return all fail', () => {
    expect('err' in gateFeed(enc(0n, NOW, 3600), NOW)).toBe(true);
    expect('err' in gateFeed(enc(1n, NOW, 3600, 1), NOW)).toBe(true);
    expect('err' in gateFeed(enc(1n, NOW + 120, 3600), NOW)).toBe(true);
    expect('err' in gateFeed('0x', NOW)).toBe(true);
    expect('err' in gateFeed(enc(1n, NOW, 3600).slice(0, -2), NOW)).toBe(true);
  });
  test('saturated lane age fails even under a long ttl', () => {
    expect('err' in gateFeed(enc(1n, NOW - AGE_SATURATES_SECS, 65535), NOW)).toBe(true);
    expect('err' in gateFeed(enc(1n, NOW - AGE_SATURATES_SECS + 1, 65535), NOW)).toBe(false);
  });
  test('readFeed rejects a malformed id and throws when the RPC never answers', async () => {
    await expect(readFeed('http://127.0.0.1:9', '0x0', '0x12')).rejects.toThrow('bad feed id');
    await expect(readFeed('http://127.0.0.1:9', '0x0', `0x${'0'.repeat(64)}`)).rejects.toThrow(
      'eth_call',
    );
  });
});
