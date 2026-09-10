/**
 * Multicall3 helper with cross-caller coalescing.
 *
 * Components don't know about each other, so N subcomponents mounting in the same tick each
 * used to fire their own aggregate3: N identical-shaped eth_calls racing each other. Calls
 * here are instead QUEUED per (provider, multicall address, block) and flushed once on a
 * microtask: every multicall() made in the same tick shares ONE aggregate3, and results are
 * fanned back out positionally. The transport's JSON-RPC batcher still coalesces whatever
 * separate eth_calls remain (different providers / pinned blocks).
 *
 * SNAPSHOT GUARANTEE. One aggregate3 is one eth_call, so a batch that fits in a single chunk is
 * atomic against a block by construction. A batch that does NOT fit is split into concurrent
 * eth_calls, and those would otherwise straddle a block boundary and return a torn snapshot —
 * reserves from block N, marks from N+1 — so the split path resolves a block number first and
 * pins every chunk to it (`runBatch`). Callers that need several SEPARATE multicall() calls to
 * agree with each other must pass the same `opt.block`; coalescing keys on it, so batches with
 * different pins never merge. What is not pinned, and cannot be from here, is the endpoint
 * itself: a load-balanced RPC may answer a pinned read from a lagging replica.
 *
 * Zero dependencies, works with optimized ABI coder.
 */

import { type Abi, decodeFn, encodeFn } from './abi';
import { getMulticall3 } from './chains';
import { ethCall, getBlockNumber } from './rpc';
import type { Address, Eip1193Provider, Hex } from './types';

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

/** One aggregate3 leg outcome: `result` when success, `error` otherwise. `returnData` is the
 *  raw revert payload of a failed leg (empty string when the leg reverted with no data), so a
 *  caller can still classify WHY a leg refused - e.g. a decoded Pool halt vs a transport blip. */
export interface MulticallResult {
  success: boolean;
  result?: unknown;
  error?: unknown;
  returnData?: Hex;
}

/** Max calls per aggregate3. Keeps calldata + node response under typical eth_call limits. */
export const MC3_CHUNK = 200;

export interface MulticallOpt {
  addr?: Address;
  chainId?: number;
  block?: string;
  chunkSize?: number;
}

// ── coalescing scheduler ─────────────────────────────────────────────────────────────────────

/** A caller's slice of the merged batch: its calls sit at [start, start+count) positionally. */
interface Waiter {
  start: number;
  count: number;
  resolve: (r: MulticallResult[]) => void;
  reject: (e: unknown) => void;
}

interface Batch {
  addr: Address;
  /** Pinned block for the whole batch; undefined = latest (chunk splits pin one lazily). */
  block?: string;
  chunkSize?: number;
  calls: Call[];
  waiters: Waiter[];
  scheduled: boolean;
}

const schedulers = new WeakMap<Eip1193Provider, Map<string, Batch>>();

export async function multicall(
  p: Eip1193Provider,
  calls: Call[],
  opt: MulticallOpt = {},
): Promise<MulticallResult[]> {
  // 0. Nothing to ask: the old per-item callers made zero requests for an empty
  // list, and an aggregate3([]) round-trip would be a regression, not a batch.
  if (!calls.length) return [];

  // Use explicit addr > chainId override > default.
  const addr = opt.addr || (opt.chainId !== undefined ? getMulticall3(opt.chainId) : MC3_ADDR);
  const key = `${addr.toLowerCase()}@${opt.block ?? 'latest'}`;

  let byKey = schedulers.get(p);
  if (!byKey) schedulers.set(p, (byKey = new Map()));
  let entry = byKey.get(key);
  if (!entry)
    byKey.set(
      key,
      (entry = {
        addr,
        block: opt.block,
        chunkSize: opt.chunkSize,
        calls: [],
        waiters: [],
        scheduled: false,
      }),
    );
  entry.chunkSize ??= opt.chunkSize;

  const waiter: Waiter = {
    start: entry.calls.length,
    count: calls.length,
    resolve: () => {},
    reject: () => {},
  };
  // Copy every leg: the queue outlives the caller's array, and legs are normalized to
  // failure-tolerant on the wire (see multicallStrict) without mutating caller objects.
  entry.calls.push(...calls.map((c) => ({ ...c, allowFailure: true })));
  entry.waiters.push(waiter);

  if (!entry.scheduled) {
    entry.scheduled = true;
    queueMicrotask(() => {
      byKey!.delete(key); // reads enqueued after this tick form the NEXT batch
      void runBatch(p, entry!);
    });
  }

  return new Promise<MulticallResult[]>((resolve, reject) => {
    waiter.resolve = resolve;
    waiter.reject = reject;
  });
}

/** Is Multicall3 actually deployed at `addr`? Probed once per (provider, address) and cached.
 *
 *  `getMulticall3` answers with the canonical address for any chain it does not know, and the
 *  canonical address is only canonical where someone deployed it. On a chain where nobody did,
 *  `eth_call` returns `0x`, the aggregate3 decode throws on empty data, and EVERY waiter in the
 *  merged batch rejects with an ABI error that names neither the chain nor the missing contract.
 *  One probe turns that into the sentence the caller needs. There is deliberately no serial
 *  fallback: silently issuing N separate eth_calls hides a misconfigured chain behind an
 *  N-times-more-expensive read path. */
const MC3_CODE = new WeakMap<Eip1193Provider, Map<string, Promise<boolean>>>();

function hasMulticall3(p: Eip1193Provider, addr: Address): Promise<boolean> {
  let byAddr = MC3_CODE.get(p);
  if (!byAddr) MC3_CODE.set(p, (byAddr = new Map()));
  const key = addr.toLowerCase();
  let probe = byAddr.get(key);
  if (!probe) {
    probe = (async () => {
      const code = await (p as { request: (a: unknown) => Promise<unknown> }).request({
        method: 'eth_getCode',
        params: [addr, 'latest'],
      });
      return typeof code === 'string' && code.length > 2;
    })().catch(() => {
      // A failed probe is a transport problem, not a verdict: do not cache it, and do not let it
      // decide. The batch proceeds and fails (or succeeds) on its own terms.
      byAddr.delete(key);
      return true;
    });
    byAddr.set(key, probe);
  }
  return probe;
}

/** Execute one merged prepared batch and fan the results back out positionally. */
async function runBatch(p: Eip1193Provider, entry: Batch): Promise<void> {
  try {
    if (!(await hasMulticall3(p, entry.addr))) {
      throw new Error(`No Multicall3 deployed at ${entry.addr} on this chain`);
    }
    // Split oversized batches; chunks run concurrently and are re-joined in order.
    // Clamped at 1: chunkSize 0 would satisfy `length > chunk` and never advance.
    const chunk = Math.max(1, entry.chunkSize ?? MC3_CHUNK);
    let results: MulticallResult[];
    if (entry.calls.length > chunk) {
      // Chunks are separate eth_calls, so without a pinned block they can straddle
      // one and return a torn snapshot: reserves from block N, marks from N+1.
      // Resolved once here, and only on the path that actually splits.
      const block = entry.block ?? `0x${(await getBlockNumber(p)).toString(16)}`;
      const parts: Call[][] = [];
      for (let i = 0; i < entry.calls.length; i += chunk)
        parts.push(entry.calls.slice(i, i + chunk));
      results = (
        await Promise.all(parts.map((c) => execAggregate3(p, c, entry.addr, block)))
      ).flat();
    } else {
      results = await execAggregate3(p, entry.calls, entry.addr, entry.block);
    }
    for (const w of entry.waiters) w.resolve(results.slice(w.start, w.start + w.count));
  } catch (e) {
    // Batch-level failure (RPC down, revert of the aggregate itself): every waiter rejects,
    // exactly as its own standalone multicall would have.
    for (const w of entry.waiters) w.reject(e);
  }
}

/** Encode all legs, execute ONE aggregate3, decode the results (old steps 1–3). */
async function execAggregate3(
  p: Eip1193Provider,
  calls: Call[],
  addr: Address,
  block?: string,
): Promise<MulticallResult[]> {
  const inputs = calls.map((c) => ({
    t: c.address,
    f: c.allowFailure ?? true,
    d: encodeFn(c), // Re-uses Call interface directly for encodeFn
  }));

  const data = encodeFn({ abi: MC3_ABI, functionName: 'aggregate3', args: [inputs] });
  const raw = await ethCall(p, addr, data, block);

  // decodeFn returns the single output value directly: an array of
  // component-named objects [{s: bool, r: bytes}, ...]
  const results = decodeFn<{ s: unknown; r: string }[]>({
    abi: MC3_ABI,
    functionName: 'aggregate3',
    data: raw,
  });

  return results.map((res, i): MulticallResult => {
    if (!res.s)
      return { success: false, error: new Error('Call failed'), returnData: res.r as Hex };
    try {
      return { success: true, result: decodeFn({ ...calls[i], data: res.r }) };
    } catch (e) {
      return { success: false, error: e, returnData: res.r as Hex };
    }
  });
}

export async function multicallStrict<T = unknown>(
  p: Eip1193Provider,
  calls: Call[],
  opt?: MulticallOpt,
): Promise<T[]> {
  // Legs ride the shared batch FAILURE-TOLERANTLY: inside a MERGED aggregate3, one caller's
  // reverting leg must never abort unrelated components' reads (allowFailure=false reverts the
  // whole aggregate3 server-side). Strictness is enforced here instead: same observable
  // contract as before: any failed leg throws, naming the underlying error.
  const res = await multicall(p, calls, opt);
  const err = res.find((r) => !r.success);
  if (err) throw new Error(`Multicall error: ${err.error}`);
  return res.map((r) => r.result as T);
}
