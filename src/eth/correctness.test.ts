import { describe, expect, test } from 'bun:test';
import { MC3_ADDR, multicall } from './multicall';
import { rlpEncode } from './rlp';
import { checksumAddress, keccak256Input } from './index';
import { encodeEventTopics, getEventSignature } from './abi';

describe('rlpEncode (hex string handling)', () => {
  test('odd-nibble hex does not throw', () => {
    expect(() => rlpEncode('0x0')).not.toThrow();
    expect(() => rlpEncode('0x5')).not.toThrow();
    expect(() => rlpEncode('0x1a4')).not.toThrow();
  });
});

describe('encodeEventTopics (indexed dynamic types)', () => {
  test('indexed string topic = keccak256(utf8)', () => {
    const ev = { type: 'event', name: 'E', inputs: [{ name: 's', type: 'string', indexed: true }] };
    const [t] = encodeEventTopics(ev as any, { s: 'hello' });
    expect(t).toBe(keccak256Input('hello'));
  });

  test('indexed address topic = padded value (not hashed)', () => {
    const ev = { type: 'event', name: 'E', inputs: [{ name: 'a', type: 'address', indexed: true }] };
    const [t] = encodeEventTopics(ev as any, { a: '0x0b9cca59cefde03ad8e41da272d946861fa7717f' });
    expect(t).toBe('0x0000000000000000000000000b9cca59cefde03ad8e41da272d946861fa7717f');
  });

  test('event signature helper stays stable', () => {
    const ev = { type: 'event', name: 'E', inputs: [{ name: 's', type: 'string', indexed: true }] };
    expect(getEventSignature(ev as any)).toBe('E(string)');
  });
});

describe('checksumAddress (EIP-55)', () => {
  test('checksums canonical vector', () => {
    expect(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
  });
});


const PROBE_ABI = [
  { type: 'function', name: 'getBlockNumber', inputs: [], outputs: [{ type: 'uint256' }] }
] as any;

describe('multicall batching', () => {
  const counting = () => {
    const seen: Array<{ method: string; params: any }> = [];
    return {
      seen,
      provider: {
        request: async ({ method, params }: { method: string; params?: any }) => {
          seen.push({ method, params });
          if (method === 'eth_blockNumber') return '0x64';
          // aggregate3 returning an empty Result[] — the request COUNT and the
          // block each chunk pins are what these cases assert.
          return '0x' + '20'.padStart(64, '0') + '0'.repeat(64);
        }
      } as any
    };
  };

  test('an empty call list costs no request', async () => {
    const { seen, provider } = counting();
    expect(await multicall(provider, [])).toEqual([]);
    expect(seen.length).toBe(0);
  });

  test('chunkSize 0 does not hang', async () => {
    const { provider } = counting();
    const calls = Array.from({ length: 3 }, () => ({
      address: MC3_ADDR as any,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber'
    }));
    // Clamped to 1 — an unclamped 0 never advances the slice cursor.
    await Promise.race([
      multicall(provider, calls, { chunkSize: 0 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 2000))
    ]);
  });

  test('chunks pin one block so a split batch cannot tear', async () => {
    const { seen, provider } = counting();
    const calls = Array.from({ length: 5 }, () => ({
      address: MC3_ADDR as any,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber'
    }));
    await multicall(provider, calls, { chunkSize: 2 });
    expect(seen.filter(s => s.method === 'eth_blockNumber').length).toBe(1);
    const blocks = seen.filter(s => s.method === 'eth_call').map(s => s.params[1]);
    expect(blocks.length).toBe(3);
    expect(new Set(blocks).size).toBe(1);
    expect(blocks[0]).toBe('0x64');
  });
});
