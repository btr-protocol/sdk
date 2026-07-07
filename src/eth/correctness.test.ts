import { describe, expect, test } from 'bun:test';
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

