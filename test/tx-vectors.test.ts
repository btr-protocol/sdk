/** RLP + transaction-signing vectors.
 *
 *  `test/` carried ZERO of these, which is how the EIP-1559 encoder shipped signing the wrong
 *  preimage: `accessList` went out as `'0x'` (the empty STRING, 0x80) where the spec requires the
 *  empty LIST (0xc0). Nothing ever decoded a signed transaction, so nothing noticed.
 *
 *  Ground truth is the EIP-155 example transaction (private key 0x4646…4646), which pins the
 *  legacy path byte-for-byte, plus recovery of the signer from the typed-transaction preimage,
 *  which pins the 1559 path against the exact bytes a node re-derives.
 */
import { describe, expect, test } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { privateKeyToAddress, releaseNonce, signTransaction } from '../src/eth/client';
import { keccak256 } from '../src/eth/index';
import { rlpEncode, rlpEncodeHex } from '../src/eth/rlp';
import type { Eip1193Provider, Hex, TransactionRequest } from '../src/eth/types';

// ── RLP primitives ───────────────────────────────────────────────────────────

describe('rlpEncode distinguishes the empty list from the empty string', () => {
  test('empty list is 0xc0, empty string is 0x80', () => {
    expect(rlpEncodeHex([])).toBe('0xc0');
    expect(rlpEncodeHex('0x')).toBe('0x80');
  });

  test('a nested empty list inside a list stays a list', () => {
    // [ 'dog', [] ] → c5 83 64 6f 67 c0
    expect(rlpEncodeHex(['dog', []])).toBe('0xc583646f67c0');
  });

  test('yellow-paper scalar and list vectors', () => {
    expect(rlpEncodeHex('dog')).toBe('0x83646f67');
    expect(rlpEncodeHex(['cat', 'dog'])).toBe('0xc88363617483646f67');
    expect(rlpEncodeHex(0)).toBe('0x80');
    expect(rlpEncodeHex(15)).toBe('0x0f');
    expect(rlpEncodeHex(1024)).toBe('0x820400');
    expect(rlpEncodeHex([[], [[]], [[], [[]]]])).toBe('0xc7c0c1c0c3c0c1c0');
  });
});

// ── Signing ──────────────────────────────────────────────────────────────────

/** Answers exactly the reads `signTransaction` makes; no network, no transport. */
const stub = (chainId: number, nonce: number): Eip1193Provider =>
  ({
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method === 'eth_getTransactionCount') return `0x${nonce.toString(16)}`;
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x4a817c800';
      throw new Error(`unexpected ${method}`);
    },
  }) as unknown as Eip1193Provider;

const EIP155_KEY = '0x4646464646464646464646464646464646464646464646464646464646464646' as Hex;
const KEY_01 = '0x0101010101010101010101010101010101010101010101010101010101010101' as Hex;

describe('legacy EIP-155 signing matches the spec vector byte-for-byte', () => {
  test('nonce 9, 20 gwei, 21000 gas, 1 ETH to 0x3535…35, chainId 1', async () => {
    const signed = await signTransaction(
      stub(1, 9),
      {
        from: privateKeyToAddress(EIP155_KEY),
        to: '0x3535353535353535353535353535353535353535',
        value: 1000000000000000000n,
        gas: 21000n,
        gasPrice: 20000000000n,
        nonce: 9n,
      } as unknown as TransactionRequest,
      EIP155_KEY,
    );
    expect(signed).toBe(
      '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
    );
  });
});

/** Re-derive the signing digest from the tx fields exactly as a node does, then recover. */
function recoverType2(
  fields: readonly unknown[],
  yParity: number,
  r: bigint,
  s: bigint,
): `0x${string}` {
  const digest = keccak256(new Uint8Array([0x02, ...rlpEncode(fields as never)])) as `0x${string}`;
  const sig = new secp256k1.Signature(r, s, yParity);
  const pub = sig.recoverPublicKey(hexToBytes(digest.slice(2))).toBytes(false);
  return `0x${(keccak256(`0x${bytesToHex(pub.slice(1))}`) as string).slice(-40)}` as `0x${string}`;
}

describe('EIP-1559 signing produces the preimage a node re-derives', () => {
  const tx = {
    from: privateKeyToAddress(KEY_01),
    to: '0x3535353535353535353535353535353535353535',
    value: 7n,
    gas: 21000n,
    maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000n,
    nonce: 3n,
    data: '0x',
  } as unknown as TransactionRequest;

  test('the accessList slot is 0xc0, not 0x80', async () => {
    const signed = await signTransaction(stub(8453, 3), tx, KEY_01);
    expect(signed.startsWith('0x02')).toBe(true);
    // `data` is `0x` (0x80) and `accessList` is `[]` (0xc0): the pair is `80c0`. The old encoder
    // emitted `8080` here, a different RLP over which the signature was worthless.
    expect(signed).toContain('80c0');
  });

  test('the signature recovers to the signing address', async () => {
    const signed = await signTransaction(stub(8453, 3), tx, KEY_01);
    // Tail of the signed list: yParity (1 byte), r (0xa0 + 32), s (0xa0 + 32).
    const body = signed.slice(4);
    const tail = body.slice(-((1 + 33 + 33) * 2));
    const yByte = tail.slice(0, 2);
    const yParity = yByte === '80' ? 0 : Number.parseInt(yByte, 16);
    expect(tail.slice(2, 4)).toBe('a0');
    expect(tail.slice(68, 70)).toBe('a0');
    const r = BigInt(`0x${tail.slice(4, 68)}`);
    const s = BigInt(`0x${tail.slice(70, 134)}`);

    const unsigned = [
      8453,
      3n,
      1000000n,
      1000000000n,
      21000n,
      '0x3535353535353535353535353535353535353535',
      7n,
      '0x',
      [],
    ];
    expect(recoverType2(unsigned, yParity, r, s).toLowerCase()).toBe(
      privateKeyToAddress(KEY_01).toLowerCase(),
    );
  });

  test('the OLD encoding (accessList as 0x80) recovers to a DIFFERENT address', async () => {
    const signed = await signTransaction(stub(8453, 3), tx, KEY_01);
    const body = signed.slice(4);
    const tail = body.slice(-((1 + 33 + 33) * 2));
    const yParity = tail.slice(0, 2) === '80' ? 0 : Number.parseInt(tail.slice(0, 2), 16);
    const r = BigInt(`0x${tail.slice(4, 68)}`);
    const s = BigInt(`0x${tail.slice(70, 134)}`);
    const wrong = [
      8453,
      3n,
      1000000n,
      1000000000n,
      21000n,
      '0x3535353535353535353535353535353535353535',
      7n,
      '0x',
      '0x', // the bug: empty STRING where the spec wants an empty LIST
    ];
    expect(recoverType2(wrong, yParity, r, s).toLowerCase()).not.toBe(
      privateKeyToAddress(KEY_01).toLowerCase(),
    );
  });
});

describe('signing refuses a chain the caller did not mean', () => {
  const base = {
    from: privateKeyToAddress(KEY_01),
    to: '0x3535353535353535353535353535353535353535',
    value: 0n,
    gas: 21000n,
    maxFeePerGas: 1000000000n,
    maxPriorityFeePerGas: 1000000n,
    nonce: 0n,
    data: '0x',
  } as unknown as TransactionRequest;

  test('a mismatch throws before any preimage is built', async () => {
    await expect(signTransaction(stub(8453, 0), base, KEY_01, 1)).rejects.toThrow(/chain mismatch/);
  });

  test('the expected chain still signs', async () => {
    const signed = await signTransaction(stub(8453, 0), base, KEY_01, 8453);
    expect(signed.startsWith('0x02')).toBe(true);
  });

  test('an explicit tx.chainId the endpoint disagrees with throws', async () => {
    const tx = { ...base, chainId: '0x1' } as unknown as TransactionRequest;
    await expect(signTransaction(stub(8453, 0), tx, KEY_01)).rejects.toThrow(/chain mismatch/);
  });

  test('a tx.chainId matching the endpoint signs', async () => {
    const tx = { ...base, chainId: '0x2105' } as unknown as TransactionRequest;
    const signed = await signTransaction(stub(8453, 0), tx, KEY_01);
    expect(signed.startsWith('0x02')).toBe(true);
  });
});

describe('concurrent signing does not reuse a nonce', () => {
  test('two same-tick signs get n and n+1', async () => {
    const p = stub(8453, 12);
    const base = {
      from: privateKeyToAddress(KEY_01),
      to: '0x3535353535353535353535353535353535353535',
      value: 0n,
      gas: 21000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000n,
      data: '0x',
    } as unknown as TransactionRequest;
    const [a, b] = await Promise.all([
      signTransaction(p, base, KEY_01),
      signTransaction(p, base, KEY_01),
    ]);
    expect(a).not.toBe(b);
    // The list opens with chainId 8453 (`822105`) then the nonce byte. Chain count is 12, so the
    // two must be 12 and 13; before the lock both signed 12 and the second replaced the first.
    const seen = [a, b].map((raw) =>
      raw.includes('8221050c') ? 12 : raw.includes('8221050d') ? 13 : -1,
    );
    expect(seen.slice().sort()).toEqual([12, 13]);
  });
});

describe('a released nonce heals the lane instead of stranding it (A-925)', () => {
  test('the tip did not advance while the nonce was allocated: release reissues it', async () => {
    const p = stub(8453, 12);
    const from = privateKeyToAddress(KEY_01);
    const tx = {
      from,
      to: '0x3535353535353535353535353535353535353535',
      value: 0n,
      gas: 21000n,
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 1000000n,
      data: '0x',
    } as unknown as TransactionRequest;
    const first = await signTransaction(p, tx, KEY_01); // chain count 12, tip 12
    releaseNonce(p, from, 12n);
    const reissued = await signTransaction(p, tx, KEY_01);
    // Same allocated nonce ⇒ same preimage ⇒ byte-identical signed tx. Without the release this
    // second sign jumped to 13 and nonce 12 never mined.
    expect(reissued).toBe(first);
    expect(reissued.includes('8221050c')).toBe(true);
    // The release is consumed once: now the tip advances to 13, never back to the hole.
    const next = await signTransaction(p, tx, KEY_01);
    expect(next.includes('8221050d')).toBe(true);
  });
});
