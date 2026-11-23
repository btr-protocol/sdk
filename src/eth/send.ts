/**
 * The one SDK writer: every state-changing call goes out through {@link send}.
 *
 * Per call, in order: `eth_estimateGas` from the connected account, gas LIMIT = estimate x buffer
 * (`gasWithBuffer`), `eth_sendTransaction`, then (unless `wait: false`) its receipt. Fails closed:
 * an estimate that errors throws (revert decoded against `abis`) and nothing further is sent; a
 * mined revert throws {@link TxRevertedError} before the next call. Builders return {@link TxCall}s,
 * so the CLI/MCP hand out the same bytes unsigned.
 */

import type { Abi } from './abi';
import { decodeRevert } from './contract';
import { estimateCallGas } from './gas';
import { getAccounts, getChainId, waitForTransaction } from './rpc';
import type { Address, Eip1193Provider, Hex, TransactionReceipt } from './types';
import { formatUnits } from '../utils/format';

/** One unsigned call: what every builder returns and {@link send} signs. */
export interface TxCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface SendOpts<C extends TxCall = TxCall> {
  /** Refuse (nothing sent) when the wallet is on another chain. Checked on both paths. */
  expectedChainId?: number;
  /** ABIs whose custom errors an estimate revert is decoded against. Plain path only. */
  abis?: readonly Abi[];
  /** Prefix of a decoded revert's message: `${label} reverted: Name(args)`. Plain path only. */
  label?: string;
  /** false: return after each send, no receipt wait. Plain path only. */
  wait?: boolean;
  /** Receipt wait, ms. Plain path only. */
  timeout?: number;
  /** A wallet's send stack (EIP-5792 bundle, simulation, prompts). Omitted: one plain
   *  estimate + `eth_sendTransaction` + receipt per call, never a bundle. */
  stack?: SendStack<C>;
  /** Stack only. Partial execution strands funds: an atomic bundle when the stack allows it, else sequential. */
  requireAtomic?: boolean;
  /** Stack only. Ignore `stack.eip5792` (a swap UX preference, not a policy for a treasury claim). */
  ignoreSetting?: boolean;
  /** Stack only. The calls go one at a time: awaited before any prompt (throw to abort, nothing sent). */
  onSequential?: () => void | Promise<void>;
  /** Stack only. Each sequential leg's hash as soon as it is known (a later leg may still fail). */
  onHash?: (h: Hex) => void;
}

/** The one raw broadcast: `eth_sendTransaction` of the final request, nothing added. */
export type Broadcast = (tx: Record<string, unknown>) => Promise<Hex>;
export const broadcast =
  (provider: Eip1193Provider): Broadcast =>
  (tx) =>
    provider.request({ method: 'eth_sendTransaction', params: [tx] }) as Promise<Hex>;

/** What a wallet UI plugs into {@link send}: every hook it needs, no default policy hidden. */
export interface SendStack<C extends TxCall = TxCall> {
  /** The "Batch approve + tx" setting: only an explicit false disables bundling. */
  eip5792: boolean | undefined;
  resolveMode: () => Promise<BatchMode>;
  /** WalletConnect wallets rarely answer capabilities: an unanswered probe is tried for a bundle
   *  that MUST be atomic. */
  isWalletConnect: boolean;
  /** One `wallet_sendCalls`, atomicRequired. */
  sendBundle: (calls: C[]) => Promise<Hex[]>;
  /** Head-pinned simulation of the full plan, before the first prompt. */
  preflight: () => Promise<void>;
  sendOne: (c: C, i: number, n: number) => Promise<Hex>;
  notify: (msg: string) => void;
  /** Undo the overlay's prompt count after a bundle was refused. */
  rewind: () => void;
  log: (msg: string, e?: unknown) => void;
  wrapped?: { symbol: string; decimals: number };
}

export type CapEntry = { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } };
/** atomic = executes all-or-nothing; batch = accepts sendCalls but may run calls one by one (a
 *  later call is then simulated before the earlier approval mines); unknown = caps RPC failed. */
export type BatchMode = 'atomic' | 'batch' | 'unknown' | null;

/** `wallet_getCapabilities` entry -> mode. Per-chain entry, then global "0x0", then first entry
 *  (some wallets ignore the chain filter). */
export function batchModeOf(caps: Record<string, CapEntry> | undefined, hex?: string): BatchMode {
  const entry = hex
    ? (caps?.[hex] ?? caps?.[hex.toLowerCase()] ?? caps?.['0x0'])
    : (caps?.['0x0'] ?? Object.values(caps ?? {})[0]);
  if (!entry) return null;
  const status = entry.atomic?.status;
  if (status === 'supported' || status === 'ready') return 'atomic';
  if (entry.atomicBatch?.supported === true) return 'atomic'; // legacy = atomic batch
  if (status === 'unsupported') return 'batch';
  if (entry.atomicBatch?.supported === false) return null;
  return entry.atomic || entry.atomicBatch ? 'batch' : null;
}

/** Approve + action is order-dependent state: only an ATOMIC bundle may carry it. A non-atomic
 *  wallet (Rabby) runs the calls separately and fails the action against the unmined approval.
 *  The setting is authoritative: only an explicit `false` disables. Unanswered capabilities are
 *  sequential, except where the caller opts into the probe (`probeUnknown`: a wallet-connect
 *  wallet that must be atomic and refuses with 5760 before anything is sent). */
export const canBundle = (
  eip5792: boolean | undefined,
  mode: BatchMode,
  probeUnknown = false,
): boolean => eip5792 !== false && (mode === 'atomic' || (probeUnknown && mode === 'unknown'));

/** The one `wallet_sendCalls` request body. */
export const sendCallsParams = (
  from: Address,
  chainId: string,
  atomicRequired: boolean,
  calls: readonly TxCall[],
) => [
  {
    version: '2.0.0',
    from,
    chainId,
    atomicRequired,
    calls: calls.map((c) => ({ to: c.to, data: c.data, value: hex(c.value ?? 0n) })),
  },
];

/** The wallet refused `wallet_sendCalls` BEFORE executing anything: EIP-1193 4200, JSON-RPC
 *  -32601, EIP-5792 5760. Message text is deliberately not consulted: a refusal or a chain
 *  mismatch can read "unsupported" and must surface as itself. */
export function isBatchRefused(e: unknown): boolean {
  const code = Number((e as { code?: number | string })?.code);
  return code === 4200 || code === -32601 || code === 5760;
}

const WRAP_SELECTOR = '0xd0e30db0'; // WNATIVE.deposit()
const UNWRAP_SELECTOR = '0x2e1a7d4d'; // WNATIVE.withdraw(uint256)
const sel = (c: TxCall) => c.data?.slice(0, 10).toLowerCase();

/** What a failure at `failed` left behind, for the one native wrap/unwrap case, else undefined. */
export function strandingNotice(
  calls: readonly TxCall[],
  failed: number,
  known?: { symbol: string; decimals: number },
): string | undefined {
  // Without the wrapped token's read decimals no amount is printed: never one scaled by a guess.
  const wrapped = known ?? { symbol: 'wrapped token', decimals: undefined };
  const fmt = (v: bigint) =>
    wrapped.decimals === undefined ? 'your' : `${formatUnits(v, wrapped.decimals)}`;
  const first = calls[0];
  if (failed > 0 && first && sel(first) === WRAP_SELECTOR) {
    return `Wrapped ${fmt(first.value ?? 0n)}${wrapped.decimals === undefined ? ' amount' : ''} into ${wrapped.symbol}, but step ${failed + 1} of ${calls.length} did not go through. The ${wrapped.symbol} is in your wallet: swap from it, or unwrap it.`;
  }
  const c = calls[failed];
  if (failed > 0 && c && sel(c) === UNWRAP_SELECTOR) {
    // Runs inside the send's catch: a short word must not throw over the real error.
    const word = c.data.slice(10, 74);
    const held =
      wrapped.decimals !== undefined && /^[0-9a-f]{64}$/i.test(word)
        ? `${fmt(BigInt(`0x${word}`))} `
        : '';
    return `The swap went through but unwrapping failed. You hold ${held}${wrapped.symbol}: unwrap it in your wallet.`;
  }
  return undefined;
}

export interface SendResult {
  hash: Hex;
  receipt?: TransactionReceipt;
}

export class TxRevertedError extends Error {
  constructor(
    readonly hash: Hex,
    readonly receipt: TransactionReceipt,
  ) {
    super(`Transaction reverted: ${hash}`);
  }
}

const hex = (v: bigint): Hex => `0x${v.toString(16)}`;

/**
 * The one writer. With a `stack`: `requireAtomic` uses an atomic bundle when the setting and the
 * wallet allow it, else the same calls one at a time; otherwise a bundle only when the wallet
 * ADVERTISES atomic batching. A refusal at request time (nothing sent) falls back to sequential;
 * any other bundle error surfaces as itself, never as a second, plain attempt. A failure that
 * leaves a native wrap/unwrap stranded is reported through `stack.notify` before it rethrows.
 */
export async function send<C extends TxCall>(
  provider: Eip1193Provider,
  calls: readonly C[],
  opts: SendOpts<C> = {},
): Promise<SendResult[]> {
  if (opts.expectedChainId !== undefined) {
    const chainId = await getChainId(provider);
    if (chainId !== opts.expectedChainId)
      throw new Error(
        `chain mismatch: endpoint reports ${chainId}, expected ${opts.expectedChainId}`,
      );
  }
  const d = opts.stack;
  if (!d) return sendPlain(provider, calls, opts);
  const setting = opts.ignoreSetting ? undefined : d.eip5792;
  const mode = setting === false ? null : await d.resolveMode();
  const probe = !!opts.requireAtomic && d.isWalletConnect;
  if ((calls.length > 1 || opts.requireAtomic) && canBundle(setting, mode, probe)) {
    try {
      return (await d.sendBundle([...calls])).map((hash) => ({ hash }));
    } catch (e) {
      if (!isBatchRefused(e)) throw e;
      d.rewind();
      d.log('wallet_sendCalls refused - falling back to sequential txs', e);
    }
  } else {
    d.log('sequential eth_sendTransaction (no wallet_sendCalls)');
  }
  await opts.onSequential?.();
  await d.preflight();
  const out: SendResult[] = [];
  for (let i = 0; i < calls.length; i++) {
    try {
      const hash = await d.sendOne(calls[i], i, calls.length);
      out.push({ hash });
      opts.onHash?.(hash);
    } catch (e) {
      const notice = strandingNotice(calls, i, d.wrapped);
      if (notice) d.notify(notice);
      throw e;
    }
  }
  return out;
}

/** No stack (bots, CLI): estimate x buffer, `eth_sendTransaction`, receipt, per call. */
async function sendPlain(
  provider: Eip1193Provider,
  calls: readonly TxCall[],
  opts: Omit<SendOpts, 'stack'>,
): Promise<SendResult[]> {
  const [from] = await getAccounts(provider);
  if (!from) throw new Error('No account connected');
  const out: SendResult[] = [];
  for (const c of calls) {
    const tx = { from, to: c.to, data: c.data, value: hex(c.value ?? 0n) };
    let gas: bigint;
    try {
      gas = await estimateCallGas(provider, tx);
    } catch (e) {
      throw decodeRevert(opts.abis ?? [], e, opts.label ?? 'call');
    }
    const hash = await broadcast(provider)({ ...tx, gas: hex(gas) });
    if (opts.wait === false) {
      out.push({ hash });
      continue;
    }
    const receipt = (await waitForTransaction(
      provider,
      hash,
      1,
      opts.timeout,
    )) as TransactionReceipt;
    if (receipt.status !== '0x1') throw new TxRevertedError(hash, receipt);
    out.push({ hash, receipt });
  }
  return out;
}
