// The send ORDER of a wallet stack, driven by a mock: which RPC path is taken for every
// combination of the Batch approve + tx setting and the wallet's advertised capability, the refusal
// fallback, the stranding notices, and byte-identical wire requests for the plain and bundle paths.
import { describe, expect, test } from 'bun:test';
import {
  type SendOpts,
  type SendStack,
  batchModeOf,
  broadcast,
  canBundle,
  isBatchRefused,
  send,
  sendCallsParams,
  strandingNotice,
} from './send';
import type { Address, Eip1193Provider, Hex } from './types';

type Deps = SendStack;
type Mode = Awaited<ReturnType<Deps['resolveMode']>>;
const nop: Eip1193Provider = { request: async () => undefined };
const runCalls = async (
  stack: Deps,
  calls: { to: Address; data: Hex; value?: bigint }[],
  opts: Omit<SendOpts, 'stack'> = {},
) => (await send(nop, calls, { ...opts, stack })).map((r) => r.hash);

const T = '0x00000000000000000000000000000000000000b1' as Address;
const approve: { to: Address; data: Hex } = { to: T, data: '0x095ea7b3' };
const swap: { to: Address; data: Hex } = { to: T, data: '0xdeadbeef' };
const wrap = { to: T, data: '0xd0e30db0' as Hex, value: 5_000_000_000_000_000_000n };
const unwrap = {
  to: T,
  data: `0x2e1a7d4d${(3n * 10n ** 18n).toString(16).padStart(64, '0')}` as Hex,
};
const W = { symbol: 'WUSDC', decimals: 18 };

function rig(eip5792: boolean | undefined, mode: Mode, over: Partial<Deps> = {}) {
  const log: string[] = [];
  const notes: string[] = [];
  const d: Deps = {
    eip5792,
    resolveMode: async () => {
      log.push('caps');
      return mode;
    },
    isWalletConnect: false,
    sendBundle: async () => {
      log.push('wallet_sendCalls');
      return ['0xb' as Hex];
    },
    preflight: async () => void log.push('preflight'),
    sendOne: async (_c, i) => {
      log.push(`eth_sendTransaction ${i}`);
      return `0x${i}` as Hex;
    },
    notify: (m) => notes.push(m),
    rewind: () => void log.push('rewind'),
    log: () => {},
    wrapped: W,
    ...over,
  };
  return { d, log, notes };
}

describe('approve + action, settings x capability', () => {
  const cases: [boolean | undefined, Mode, boolean][] = [
    [false, 'atomic', false],
    [false, 'batch', false],
    [false, 'unknown', false],
    [false, null, false],
    [true, 'atomic', true],
    [undefined, 'atomic', true],
    [true, 'batch', false],
    [true, 'unknown', false],
    [true, null, false],
  ];
  for (const [setting, mode, bundles] of cases) {
    test(`setting ${setting} + ${mode}: ${bundles ? 'one bundle' : 'sequential, no wallet_sendCalls'}`, async () => {
      const { d, log } = rig(setting, mode);
      await runCalls(d, [approve, swap]);
      if (bundles) expect(log).toContain('wallet_sendCalls');
      else {
        expect(log).not.toContain('wallet_sendCalls');
        expect(log).toEqual(
          setting === false
            ? ['preflight', 'eth_sendTransaction 0', 'eth_sendTransaction 1']
            : ['caps', 'preflight', 'eth_sendTransaction 0', 'eth_sendTransaction 1'],
        );
      }
    });
  }
  test('setting off does not even ask the wallet for capabilities', async () => {
    const { d, log } = rig(false, 'atomic');
    await runCalls(d, [approve, swap]);
    expect(log).not.toContain('caps');
  });
});

describe('requireAtomic (native wrap/unwrap)', () => {
  test('setting off: sequential, never throws, never wallet_sendCalls', async () => {
    const { d, log } = rig(false, 'atomic');
    const h = await runCalls(d, [wrap, approve, swap], { requireAtomic: true });
    expect(h).toHaveLength(3);
    expect(log).not.toContain('wallet_sendCalls');
  });
  test('atomic wallet: one bundle', async () => {
    const { d, log } = rig(true, 'atomic');
    await runCalls(d, [wrap, approve, swap], { requireAtomic: true });
    expect(log).toContain('wallet_sendCalls');
  });
  test('unanswered capabilities: tried only over WalletConnect', async () => {
    const a = rig(true, 'unknown');
    await runCalls(a.d, [wrap, swap], { requireAtomic: true });
    expect(a.log).not.toContain('wallet_sendCalls');
    const b = rig(true, 'unknown', { isWalletConnect: true });
    await runCalls(b.d, [wrap, swap], { requireAtomic: true });
    expect(b.log).toContain('wallet_sendCalls');
  });
});

describe('refusal vs failure of a bundle', () => {
  test('5760 before anything is sent: rewind, then sequential', async () => {
    const { d, log } = rig(true, 'atomic', {
      sendBundle: async () => {
        log.push('wallet_sendCalls');
        throw Object.assign(new Error('atomicity not supported'), { code: 5760 });
      },
    });
    await runCalls(d, [approve, swap]);
    expect(log).toEqual([
      'caps',
      'wallet_sendCalls',
      'rewind',
      'preflight',
      'eth_sendTransaction 0',
      'eth_sendTransaction 1',
    ]);
  });
  test('any other bundle error surfaces; no plain second attempt', async () => {
    for (const err of [
      Object.assign(new Error('Batch failed'), { code: -32000 }),
      new Error('chain unsupported'),
      Object.assign(new Error('rejected'), { code: 4001 }),
    ]) {
      const { d, log } = rig(true, 'atomic', {
        sendBundle: async () => {
          throw err;
        },
      });
      await expect(runCalls(d, [approve, swap])).rejects.toBe(err);
      expect(log.some((l) => l.startsWith('eth_sendTransaction'))).toBe(false);
    }
  });
});

describe('stranding notices', () => {
  const failAt = (n: number): Partial<Deps> => ({
    sendOne: async (_c, i) => {
      if (i === n) throw new Error('boom');
      return '0x1' as Hex;
    },
  });
  test('native in: wrap landed, swap failed -> names the wrapped token and amount', async () => {
    const { d, notes } = rig(false, null, failAt(2));
    await expect(runCalls(d, [wrap, approve, swap], { requireAtomic: true })).rejects.toThrow(
      'boom',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Wrapped 5 into WUSDC');
    expect(notes[0]).toContain('step 3 of 3');
  });
  test('native out: nothing was wrapped; a failed swap says nothing about wrapped funds', async () => {
    const { d, notes } = rig(false, null, failAt(1));
    await expect(runCalls(d, [approve, swap, unwrap], { requireAtomic: true })).rejects.toThrow();
    expect(notes).toEqual([]);
  });
  test('native out: failed unwrap names WRAPPED symbol and the amount', async () => {
    const { d, notes } = rig(false, null, failAt(2));
    await expect(runCalls(d, [approve, swap, unwrap], { requireAtomic: true })).rejects.toThrow();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('unwrapping failed');
    expect(notes[0]).toContain('3 WUSDC');
    expect(notes[0]).not.toContain('Wrapped');
  });
  test('short unwrap calldata keeps the real send error and a notice without the amount', async () => {
    const short = { ...unwrap, data: unwrap.data.slice(0, 20) as Hex };
    const { d, notes } = rig(false, null, failAt(2));
    await expect(runCalls(d, [approve, swap, short], { requireAtomic: true })).rejects.toThrow(
      'boom',
    );
    expect(notes).toEqual([
      'The swap went through but unwrapping failed. You hold WUSDC: unwrap it in your wallet.',
    ]);
  });
  test('a failing first call, or a plain approve + swap, raises no notice', () => {
    expect(strandingNotice([wrap, swap], 0, W)).toBeUndefined();
    expect(strandingNotice([approve, swap], 1, W)).toBeUndefined();
  });
});

describe('ignoreSetting (treasury claim)', () => {
  test('setting off still bundles when the wallet is atomic', async () => {
    const { d, log } = rig(false, 'atomic');
    await runCalls(d, [approve, swap], { requireAtomic: true, ignoreSetting: true });
    expect(log).toContain('wallet_sendCalls');
  });
  test('setting off + WalletConnect with an unanswered probe still bundles', async () => {
    const { d, log } = rig(false, 'unknown', { isWalletConnect: true });
    await runCalls(d, [approve, swap], { requireAtomic: true, ignoreSetting: true });
    expect(log).toContain('wallet_sendCalls');
  });
  test('no bundle support: sequential, and onSequential fires', async () => {
    const { d, log } = rig(false, null);
    let warned = false;
    await runCalls(d, [approve, swap], {
      requireAtomic: true,
      ignoreSetting: true,
      onSequential: () => {
        warned = true;
      },
    });
    expect(warned).toBe(true);
    expect(log).not.toContain('wallet_sendCalls');
  });
  test('a mid-run failure reports earlier hashes through onHash', async () => {
    const { d } = rig(true, null, {
      sendOne: async (_c, i) => {
        if (i === 2) throw new Error('rejected');
        return `0x${i}` as Hex;
      },
    });
    const seen: Hex[] = [];
    await expect(
      runCalls(d, [approve, swap, swap], { onHash: (h) => seen.push(h) }),
    ).rejects.toThrow('rejected');
    expect(seen).toEqual(['0x0', '0x1']);
  });
});

describe('wire bytes', () => {
  test('wallet_sendCalls body is unchanged', () => {
    expect(JSON.stringify(sendCallsParams(T, '0x8f', true, [wrap, approve]))).toBe(
      JSON.stringify([
        {
          version: '2.0.0',
          from: T,
          chainId: '0x8f',
          atomicRequired: true,
          calls: [
            { to: T, data: '0xd0e30db0', value: '0x4563918244f40000' },
            { to: T, data: '0x095ea7b3', value: '0x0' },
          ],
        },
      ]),
    );
  });
  test('broadcast() sends exactly the request it is given', async () => {
    const wire: unknown[] = [];
    const p: Eip1193Provider = {
      request: async (a) => {
        wire.push(a);
        return '0xabc';
      },
    };
    const tx = { from: T, to: T, data: '0xdeadbeef', gas: '0x5208', chainId: '0x8f' };
    expect(await broadcast(p)(tx)).toBe('0xabc');
    expect(wire).toEqual([{ method: 'eth_sendTransaction', params: [tx] }]);
  });
  test('no stack: estimate, then eth_sendTransaction with the buffered gas', async () => {
    const wire: { method: string; params?: unknown }[] = [];
    const p: Eip1193Provider = {
      request: async (a) => {
        wire.push(a as never);
        if (a.method === 'eth_accounts') return [T];
        if (a.method === 'eth_estimateGas') return '0x5208';
        return '0xabc';
      },
    };
    await send(p, [swap], { wait: false });
    const sent = wire.find((w) => w.method === 'eth_sendTransaction');
    // 21000 x 1.25 = 26250
    expect(sent?.params).toEqual([
      { from: T, to: T, data: '0xdeadbeef', value: '0x0', gas: '0x668a' },
    ]);
    expect(wire.map((w) => w.method)).toEqual(['eth_accounts', 'eth_estimateGas', 'eth_sendTransaction']);
  });
});

const A1 = '0x0000000000000000000000000000000000000001' as Address;

describe('canBundle: the setting gates wallet_sendCalls', () => {
  test('off never bundles, whatever the wallet claims', () => {
    for (const m of ['atomic', 'batch', 'unknown', null] as const)
      for (const probe of [false, true]) expect(canBundle(false, m, probe)).toBe(false);
  });
  test('on bundles only an advertised atomic wallet; unanswered is sequential unless probed', () => {
    expect(canBundle(true, 'atomic')).toBe(true);
    expect(canBundle(undefined, 'atomic')).toBe(true);
    expect(canBundle(true, 'unknown')).toBe(false);
    expect(canBundle(true, 'unknown', true)).toBe(true);
    expect(canBundle(true, 'batch', true)).toBe(false);
    expect(canBundle(true, null, true)).toBe(false);
  });
});

describe('isBatchRefused: codes only, never message text', () => {
  test('4200, -32601, 5760 fall back; text and other codes do not', () => {
    for (const code of [4200, -32601, 5760, '5760']) expect(isBatchRefused({ code })).toBe(true);
    expect(isBatchRefused({ code: 4001, message: 'unsupported' })).toBe(false);
    expect(isBatchRefused(new Error('chain unsupported'))).toBe(false);
    expect(isBatchRefused(new Error('Method wallet_sendCalls not approved'))).toBe(false);
  });
});

describe('batchModeOf: capabilities -> mode', () => {
  test('atomic only when the wallet says so', () => {
    expect(batchModeOf({ '0x38': { atomic: { status: 'supported' } } }, '0x38')).toBe('atomic');
    expect(batchModeOf({ '0x38': { atomic: { status: 'ready' } } }, '0x38')).toBe('atomic');
    expect(batchModeOf({ '0x38': { atomicBatch: { supported: true } } }, '0x38')).toBe('atomic');
  });
  test('unsupported atomic is a non-atomic bundle; no entry is no batching', () => {
    expect(batchModeOf({ '0x38': { atomic: { status: 'unsupported' } } }, '0x38')).toBe('batch');
    expect(batchModeOf({ '0x38': { atomicBatch: { supported: false } } }, '0x38')).toBe(null);
    expect(batchModeOf({}, '0x38')).toBe(null);
    expect(batchModeOf(undefined, '0x38')).toBe(null);
  });
  test('falls back to the global 0x0 entry', () => {
    expect(batchModeOf({ '0x0': { atomic: { status: 'supported' } } }, '0x38')).toBe('atomic');
  });
});

describe('sendCallsParams: payload shape', () => {
  test('v2, hex chain, atomicRequired, every call carries a hex value', () => {
    const calls = [
      { to: A1, data: '0xaa' as Hex },
      { to: A1, data: '0xbb' as Hex, value: 255n },
    ];
    expect(sendCallsParams(A1, '0x38', true, calls)).toEqual([
      {
        version: '2.0.0',
        from: A1,
        chainId: '0x38',
        atomicRequired: true,
        calls: [
          { to: A1, data: '0xaa', value: '0x0' },
          { to: A1, data: '0xbb', value: '0xff' },
        ],
      },
    ]);
  });
});
