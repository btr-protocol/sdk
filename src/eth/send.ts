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

/** One unsigned call: what every builder returns and {@link send} signs. */
export interface TxCall {
  to: Address;
  data: Hex;
  value?: bigint;
}

export interface SendOpts {
  /** Refuse (nothing sent) when the wallet is on another chain. */
  expectedChainId?: number;
  /** ABIs whose custom errors an estimate revert is decoded against. */
  abis?: readonly Abi[];
  /** Prefix of a decoded revert's message: `${label} reverted: Name(args)`. */
  label?: string;
  /** false: return after each send, no receipt wait. */
  wait?: boolean;
  timeout?: number;
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

export async function send(
  provider: Eip1193Provider,
  calls: readonly TxCall[],
  opts: SendOpts = {},
): Promise<SendResult[]> {
  if (opts.expectedChainId !== undefined) {
    const chainId = await getChainId(provider);
    if (chainId !== opts.expectedChainId)
      throw new Error(
        `chain mismatch: endpoint reports ${chainId}, expected ${opts.expectedChainId}`,
      );
  }
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
    const hash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [{ ...tx, gas: hex(gas) }],
    })) as Hex;
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
