import { describe, expect, test } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { recoverDigestSigner } from '../oracle/verify';
import {
  type AbiEvent,
  type AbiFunction,
  encodeEventTopics,
  getEventSignature,
  getSelector,
} from './abi';
import { privateKeyToAddress, signDigest } from './client';
import { Contract, ContractRevertError } from './contract';
import { checksumAddress, keccak256Input } from './index';
import { type Call, MC3_ADDR, multicall, multicallStrict } from './multicall';
import { rlpEncode } from './rlp';
import { getChainId, signTypedData } from './rpc';
import { RpcRevertError } from './transport';
import type { Address, Eip1193Provider } from './types';

describe('rlpEncode (hex string handling)', () => {
  test('odd-nibble hex does not throw', () => {
    expect(() => rlpEncode('0x0')).not.toThrow();
    expect(() => rlpEncode('0x5')).not.toThrow();
    expect(() => rlpEncode('0x1a4')).not.toThrow();
  });
});

describe('encodeEventTopics (indexed dynamic types)', () => {
  test('indexed string topic = keccak256(utf8)', () => {
    const ev: AbiEvent = {
      type: 'event',
      name: 'E',
      inputs: [{ name: 's', type: 'string', indexed: true }],
    };
    const [t] = encodeEventTopics(ev, { s: 'hello' });
    expect(t).toBe(keccak256Input('hello'));
  });

  test('indexed address topic = padded value (not hashed)', () => {
    const ev: AbiEvent = {
      type: 'event',
      name: 'E',
      inputs: [{ name: 'a', type: 'address', indexed: true }],
    };
    const [t] = encodeEventTopics(ev, { a: '0x0b9cca59cefde03ad8e41da272d946861fa7717f' });
    expect(t).toBe('0x0000000000000000000000000b9cca59cefde03ad8e41da272d946861fa7717f');
  });

  test('event signature helper stays stable', () => {
    const ev: AbiEvent = {
      type: 'event',
      name: 'E',
      inputs: [{ name: 's', type: 'string', indexed: true }],
    };
    expect(getEventSignature(ev)).toBe('E(string)');
  });
});

describe('checksumAddress (EIP-55)', () => {
  test('checksums canonical vector', () => {
    expect(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
  });
});

const PROBE_ABI: AbiFunction[] = [
  { type: 'function', name: 'getBlockNumber', inputs: [], outputs: [{ type: 'uint256' }] },
];

describe('multicall batching', () => {
  const counting = (): {
    seen: Array<{ method: string; params?: unknown[] }>;
    provider: Eip1193Provider;
  } => {
    const seen: Array<{ method: string; params?: unknown[] }> = [];
    return {
      seen,
      provider: {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          seen.push({ method, params });
          if (method === 'eth_blockNumber') return '0x64';
          // aggregate3 returning an empty Result[]: the request COUNT and the
          // block each chunk pins are what these cases assert.
          return `0x${'20'.padStart(64, '0')}${'0'.repeat(64)}`;
        },
      },
    };
  };

  test('an empty call list costs no request', async () => {
    const { seen, provider } = counting();
    expect(await multicall(provider, [])).toEqual([]);
    expect(seen.length).toBe(0);
  });

  test('chunkSize 0 does not hang', async () => {
    const { provider } = counting();
    const calls: Call[] = Array.from({ length: 3 }, () => ({
      address: MC3_ADDR,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber',
    }));
    // Clamped to 1: an unclamped 0 never advances the slice cursor.
    await Promise.race([
      multicall(provider, calls, { chunkSize: 0 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 2000)),
    ]);
  });

  test('chunks pin one block so a split batch cannot tear', async () => {
    const { seen, provider } = counting();
    const calls: Call[] = Array.from({ length: 5 }, () => ({
      address: MC3_ADDR,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber',
    }));
    await multicall(provider, calls, { chunkSize: 2 });
    expect(seen.filter((s) => s.method === 'eth_blockNumber').length).toBe(1);
    const blocks = seen.filter((s) => s.method === 'eth_call').map((s) => s.params?.[1]);
    expect(blocks.length).toBe(3);
    expect(new Set(blocks).size).toBe(1);
    expect(blocks[0]).toBe('0x64');
  });

  // Encode an aggregate3 return for `n` legs (leg `failIndex` marked reverted): top-level
  // dynamic return: [offset 0x20][array len][elem offsets][elems], each elem {bool,bytes}.
  const encResults = (n: number, failIndex = -1): string => {
    const w = (v: bigint) => v.toString(16).padStart(64, '0');
    const ES = 0x80n;
    const base = BigInt(n) * 32n;
    let out = w(0x20n) + w(BigInt(n));
    for (let i = 0; i < n; i++) out += w(base + BigInt(i) * ES);
    for (let i = 0; i < n; i++)
      out +=
        w(i === failIndex ? 0n : 1n) +
        w(0x40n) +
        w(1n) +
        (i === failIndex ? '08' : '01').padEnd(64, '0');
    return `0x${out}`;
  };
  /** Provider answering one Result per aggregate3 leg, counting wire requests. */
  const mc3Provider = (): { seen: string[]; provider: Eip1193Provider } => {
    const seen: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        seen.push(method);
        if (method === 'eth_blockNumber') return '0x64';
        const cd = (params as [{ data: string }, string])[0].data;
        const legs = Number.parseInt(cd.slice(10 + 64, 10 + 128), 16);
        return encResults(legs);
      },
    } as unknown as Eip1193Provider;
    return { seen, provider };
  };

  /** A real 20-byte address: the encoder refuses a short one, because `pad()` keeps the LAST 32
   *  bytes and an over-long value would encode as a DIFFERENT address with no way to tell. */
  const addr = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address;

  test('two concurrent multicall() calls share ONE aggregate3', async () => {
    const { seen, provider } = mc3Provider();
    const mk = (to: string): Call => ({
      address: to as Address,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber',
    });
    const [a, b] = await Promise.all([
      multicall(provider, [mk(addr(1)), mk(addr(2))]), // component A batches its two reads
      multicall(provider, [mk(addr(3)), mk(addr(4)), mk(addr(5))]), // component B, same tick
    ]);
    expect(seen.filter((m) => m === 'eth_call').length).toBe(1);
    // Positional fan-out: each caller gets exactly its own legs back, decoded normally.
    expect(a.length).toBe(2);
    expect(b.length).toBe(3);
    expect(a.every((r) => r.success && r.result === 1n)).toBe(true);
    expect(b.every((r) => r.success && r.result === 1n)).toBe(true);
  });

  test("a strict caller's failing leg does not abort a lenient one sharing the batch", async () => {
    // Merged batch = [lenient leg @0, strict leg @1]; the mock reverts exactly index 1.
    const provider: Eip1193Provider = {
      request: async ({ params }: { method?: string; params?: unknown[] }) => {
        const cd = (params as [{ data: string }, string])[0].data;
        return encResults(Number.parseInt(cd.slice(10 + 64, 10 + 128), 16), 1);
      },
    } as unknown as Eip1193Provider;
    const mk = (to: string): Call => ({
      address: to as Address,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber',
    });
    // Same tick -> one merged aggregate3; the lenient caller keeps its result even though the
    // strict caller's leg reverted (allowFailure=false would have nuked the whole batch).
    const lenientP = multicall(provider, [mk(addr(0xdd))]);
    const strictP = multicallStrict(provider, [mk(addr(0xbad))]);
    const lenient = await lenientP;
    await expect(strictP).rejects.toThrow(/Multicall error/);
    expect(lenient[0].success).toBe(true);
  });
});

describe('signDigest (noble-curves v2 prehash trap)', () => {
  // Fixture derived independently with foundry:
  //   cast keccak "btr signDigest prehash regression"
  //   cast wallet address --private-key $KEY
  //   cast wallet sign --no-hash --private-key $KEY $DIGEST
  const KEY = '0x0000000000000000000000000000000000000000000000000000000000000a11';
  const DIGEST = '0x964b7f3903c6b7863dd87656d1717b4e384571a73e552990d33870275e715941';
  const ADDR = '0x563Bd9e11d18b6eA60c2f159F8D3062d30E8039e';
  const SIG =
    '0xe517d8d10419ebf3b430e58de50c1b68768494247de4a753e658d60c21e7acf77f11430b63162ee4a1698100eb5a2e87705b33924d4065fa6e6cf796c1aea5801c';

  /** r||s||v(27|28), the 65-byte Ethereum layout. Noble's 'recovered' is recovery||r||s. */
  const rsv = (sig: { toBytes: (f: string) => Uint8Array; recovery?: number }): Uint8Array => {
    const out = new Uint8Array(65);
    out.set(sig.toBytes('compact'), 0);
    out[64] = 27 + (sig.recovery as number);
    return out;
  };

  test('matches the foundry signature byte-for-byte', () => {
    expect(`0x${bytesToHex(rsv(signDigest(DIGEST, KEY)))}`).toBe(SIG);
  });

  test('signature recovers to the signing address', () => {
    expect(recoverDigestSigner(DIGEST, rsv(signDigest(DIGEST, KEY)))).toBe(ADDR);
    expect(checksumAddress(privateKeyToAddress(KEY))).toBe(ADDR);
  });

  // Guard rail: without `prehash: false` noble v2 signs sha256(digest). The result is still a
  // well-formed 65-byte signature, but it recovers to a DIFFERENT address, so every tx is invalid.
  test('default (prehashing) signing recovers to the wrong address', () => {
    const wrong = secp256k1.Signature.fromBytes(
      secp256k1.sign(hexToBytes(DIGEST.slice(2)), hexToBytes(KEY.slice(2)), {
        format: 'recovered',
      }),
      'recovered',
    );
    expect(recoverDigestSigner(DIGEST, rsv(wrong))).not.toBe(ADDR);
  });
});

describe('multicall names a missing Multicall3', () => {
  test('empty code at the multicall address rejects with the chain problem, not an ABI error', async () => {
    // `getMulticall3` hands back the canonical address for any chain it does not know, so on a
    // chain where nobody deployed it `eth_call` returns `0x` and the aggregate3 decode used to
    // throw an ABI error naming neither the chain nor the contract.
    const provider: Eip1193Provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_call') return '0x';
        throw new Error(`unexpected ${method}`);
      },
    } as unknown as Eip1193Provider;
    const call: Call = {
      address: `0x${'11'.repeat(20)}` as Address,
      abi: PROBE_ABI,
      functionName: 'getBlockNumber',
    };
    await expect(multicall(provider, [call])).rejects.toThrow(/No Multicall3 deployed at/);
  });
});

describe('Contract surfaces the protocol reason for a revert', () => {
  // `decodeErrorResult` shipped with the coder and nothing on the Contract path called it, so a
  // deliberate refusal ("this leg is halted") reached the caller as "execution reverted".
  const ABI = [
    {
      type: 'function',
      name: 'swap',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
    { type: 'error', name: 'FeatureDisabled', inputs: [{ name: 'resource', type: 'uint8' }] },
  ] as never;

  /** `FeatureDisabled(uint8)` with resource = 0 (ASSET), as the pool returns it. */
  const revertData = `${getSelector('FeatureDisabled(uint8)')}${'0'.repeat(64)}`;
  const reverting: Eip1193Provider = {
    request: async () => {
      throw new RpcRevertError('execution reverted', 3, revertData);
    },
  } as unknown as Eip1193Provider;

  test('read() names the custom error and carries its args', async () => {
    const c = new Contract({
      address: `0x${'11'.repeat(20)}` as Address,
      abi: ABI,
      provider: reverting,
    });
    const err = (await c
      .read('swap', [`0x${'22'.repeat(20)}`])
      .catch((e) => e)) as ContractRevertError;
    expect(err).toBeInstanceOf(ContractRevertError);
    expect(err.errorName).toBe('FeatureDisabled');
    expect(err.errorArgs[0]).toBe(0n);
    expect(err.message).toBe('swap reverted: FeatureDisabled(0)');
  });

  test('an undecodable revert passes through untouched', async () => {
    const opaque: Eip1193Provider = {
      request: async () => {
        throw new RpcRevertError('execution reverted', 3, '0xdeadbeef');
      },
    } as unknown as Eip1193Provider;
    const c = new Contract({
      address: `0x${'11'.repeat(20)}` as Address,
      abi: ABI,
      provider: opaque,
    });
    const err = await c.read('swap', [`0x${'22'.repeat(20)}`]).catch((e) => e);
    expect(err).toBeInstanceOf(RpcRevertError);
    expect(err).not.toBeInstanceOf(ContractRevertError);
  });
});

describe('chain id and typed data survive values JSON cannot hold', () => {
  const answer = (result: unknown): Eip1193Provider =>
    ({ request: async () => result }) as unknown as Eip1193Provider;

  test('a chainId past 2^53 is refused, not silently capped', async () => {
    // `parseInt` clamps at MAX_SAFE_INTEGER, which makes two DIFFERENT chains compare equal to
    // every guard that reads this number.
    await expect(getChainId(answer('0x20000000000000'))).rejects.toThrow(/exceeds 2\^53-1/);
    expect(await getChainId(answer('0x4cef52'))).toBe(5_042_002);
  });

  test('signTypedData serialises a bigint chainId instead of throwing on it', async () => {
    // `TypedDataDomain.chainId` is typed `number | bigint`, and `JSON.stringify` THROWS on a
    // bigint — so the documented shape crashed before it ever reached the wallet.
    let sent: string | undefined;
    const p = {
      request: async ({ params }: { params?: unknown[] }) => {
        sent = (params as [string, string])[1];
        return '0x00';
      },
    } as unknown as Eip1193Provider;
    await signTypedData(
      p,
      `0x${'11'.repeat(20)}` as Address,
      {
        domain: { name: 'BTR', chainId: 5_042_002n },
        types: { M: [{ name: 'x', type: 'uint256' }] },
        primaryType: 'M',
        message: { x: 2n ** 90n },
      } as never,
    );
    const parsed = JSON.parse(sent as string);
    // Decimal strings: exact at any width, which a JSON number is not.
    expect(parsed.domain.chainId).toBe('5042002');
    expect(parsed.message.x).toBe((2n ** 90n).toString());
  });
});
