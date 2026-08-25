/**
 * Multicall3 helper
 * Zero dependencies, works with optimized ABI coder
 */

import { type Abi, decodeFn, encodeFn } from './abi';
import { getMulticall3 } from './chains';
import { ethCall, getBlockNumber } from './rpc';
import type { Address, Eip1193Provider } from './types';

export const MC3_ADDR = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Minimal ABI definition with short keys to save space
const MC3_ABI = [
  {
    name: 'aggregate3',
    inputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 't', type: 'address' }, // target
          { name: 'f', type: 'bool' }, // failureAllowed
          { name: 'd', type: 'bytes' }, // callData
        ],
      },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 's', type: 'bool' }, // success
          { name: 'r', type: 'bytes' }, // returnData
        ],
      },
    ],
  },
];

export interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: unknown[];
  allowFailure?: boolean;
}

/** One aggregate3 leg outcome: `result` when success, `error` otherwise. */
export interface MulticallResult {
  success: boolean;
  result?: unknown;
  error?: unknown;
}

/** Max calls per aggregate3. Keeps calldata + node response under typical eth_call limits. */
export const MC3_CHUNK = 200;

export async function multicall(
  p: Eip1193Provider,
  calls: Call[],
  opt: { addr?: Address; chainId?: number; block?: string; chunkSize?: number } = {},
): Promise<MulticallResult[]> {
  // 0. Nothing to ask: the old per-item callers made zero requests for an empty
  // list, and an aggregate3([]) round-trip would be a regression, not a batch.
  if (!calls.length) return [];

  // Split oversized batches; chunks run concurrently and are re-joined in order.
  // Clamped at 1: chunkSize 0 would satisfy `length > chunk` and never advance.
  const chunk = Math.max(1, opt.chunkSize ?? MC3_CHUNK);
  if (calls.length > chunk) {
    // Chunks are separate eth_calls, so without a pinned block they can straddle
    // one and return a torn snapshot — reserves from block N, marks from N+1.
    // Resolved once here, and only on the path that actually splits.
    const block = opt.block ?? `0x${(await getBlockNumber(p)).toString(16)}`;
    const parts: Call[][] = [];
    for (let i = 0; i < calls.length; i += chunk) parts.push(calls.slice(i, i + chunk));
    const out = await Promise.all(
      parts.map((c) => multicall(p, c, { ...opt, block, chunkSize: Number.POSITIVE_INFINITY })),
    );
    return out.flat();
  }

  // 1. Encode all calls
  const inputs = calls.map((c) => ({
    t: c.address,
    f: c.allowFailure ?? true,
    d: encodeFn(c), // Re-uses Call interface directly for encodeFn
  }));

  // 2. Execute aggregate3
  const data = encodeFn({ abi: MC3_ABI, functionName: 'aggregate3', args: [inputs] });
  // Use explicit addr > chainId override > default
  const multicallAddr =
    opt.addr || (opt.chainId !== undefined ? getMulticall3(opt.chainId) : MC3_ADDR);
  const raw = await ethCall(p, multicallAddr, data, opt.block);

  // 3. Decode results
  // decodeFn returns the single output value directly: an array of
  // component-named objects [{s: bool, r: bytes}, ...]
  const results = decodeFn<{ s: unknown; r: string }[]>({
    abi: MC3_ABI,
    functionName: 'aggregate3',
    data: raw,
  });

  return results.map((res, i): MulticallResult => {
    if (!res.s) return { success: false, error: new Error('Call failed') };
    try {
      return { success: true, result: decodeFn({ ...calls[i], data: res.r }) };
    } catch (e) {
      return { success: false, error: e };
    }
  });
}

export async function multicallStrict<T = unknown>(
  p: Eip1193Provider,
  calls: Call[],
  opt?: { addr?: Address; chainId?: number; block?: string; chunkSize?: number },
): Promise<T[]> {
  const res = await multicall(
    p,
    calls.map((c) => ({ ...c, allowFailure: false })),
    opt,
  );
  const err = res.find((r) => !r.success);
  if (err) throw new Error(`Multicall error: ${err.error}`);
  return res.map((r) => r.result as T);
}
