/**
 * Minimal Contract class
 * Zero dependencies
 */

import type { Abi, AbiFunction } from './abi';
import { decodeErrorResult, decodeFn, encodeFn } from './abi';
import { estimateGas, ethCall, sendTransaction } from './rpc';
import { RpcRevertError } from './transport';
import type { Address, Eip1193Provider, Hex, TransactionRequest } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ContractConfig {
  address: Address;
  abi: Abi;
  provider: Eip1193Provider;
  account?: Address;
}

export interface ReadOptions {
  blockTag?: 'latest' | 'pending' | 'earliest' | Hex;
}

export interface WriteOptions {
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

// ─────────────────────────────────────────────────────────────
// Contract Class
// ─────────────────────────────────────────────────────────────

/** A revert carrying decoded custom-error data.
 *
 *  `decodeErrorResult` has existed since the coder was written and nothing on the Contract path
 *  called it, so every revert surfaced as the transport's generic "execution reverted" — the
 *  protocol's own `FeatureDisabled(ASSET)` / `ThresholdViolation(...)` reached the caller as an
 *  opaque hex blob. Reverts are how this protocol says WHY it refused; dropping the reason turns
 *  every deliberate refusal into an unexplained failure. */
export class ContractRevertError extends RpcRevertError {
  constructor(
    /** Custom-error name from the contract's own ABI, e.g. `FeatureDisabled`. */
    readonly errorName: string,
    /** Its decoded arguments, in declaration order. */
    readonly errorArgs: readonly unknown[],
    message: string,
    code?: number,
    data?: unknown,
  ) {
    super(message, code, data);
  }
}

/** Re-throw a revert with its custom error decoded against `abi`; anything else passes through. */
function withDecodedRevert(abi: Abi, fn: string, e: unknown): never {
  if (e instanceof RpcRevertError && typeof e.data === 'string') {
    const d = decodeErrorResult(abi, e.data);
    if (d) {
      const args = d.args.length ? `(${d.args.map(String).join(', ')})` : '';
      throw new ContractRevertError(
        d.name,
        d.args,
        `${fn} reverted: ${d.name}${args}`,
        e.code,
        e.data,
      );
    }
  }
  throw e;
}

export class Contract {
  readonly address: Address;
  readonly abi: Abi;
  readonly provider: Eip1193Provider;
  account?: Address;

  constructor(config: ContractConfig) {
    this.address = config.address;
    this.abi = config.abi;
    this.provider = config.provider;
    this.account = config.account;
  }

  connect(account: Address): Contract {
    return new Contract({
      address: this.address,
      abi: this.abi,
      provider: this.provider,
      account,
    });
  }

  async read<T = unknown>(
    functionName: string,
    args: readonly unknown[] = [],
    options: ReadOptions = {},
  ): Promise<T> {
    const data = encodeFn({ abi: this.abi, functionName, args });
    try {
      const result = await ethCall(this.provider, this.address, data, options.blockTag || 'latest');
      return decodeFn({ abi: this.abi, functionName, data: result }) as T;
    } catch (e) {
      return withDecodedRevert(this.abi, functionName, e);
    }
  }

  async write(
    functionName: string,
    args: readonly unknown[] = [],
    options: WriteOptions = {},
  ): Promise<Hex> {
    if (!this.account) throw new Error('No account connected');

    const data = encodeFn({ abi: this.abi, functionName, args });
    const tx: TransactionRequest = { from: this.account, to: this.address, data };

    if (options.value !== undefined) tx.value = `0x${options.value.toString(16)}`;
    if (options.gas !== undefined) tx.gas = `0x${options.gas.toString(16)}`;
    if (options.gasPrice !== undefined) tx.gasPrice = `0x${options.gasPrice.toString(16)}`;
    if (options.maxFeePerGas !== undefined)
      tx.maxFeePerGas = `0x${options.maxFeePerGas.toString(16)}`;
    if (options.maxPriorityFeePerGas !== undefined)
      tx.maxPriorityFeePerGas = `0x${options.maxPriorityFeePerGas.toString(16)}`;

    try {
      return await sendTransaction(this.provider, tx);
    } catch (e) {
      return withDecodedRevert(this.abi, functionName, e);
    }
  }

  async simulate(
    functionName: string,
    args: readonly unknown[] = [],
    options: WriteOptions = {},
  ): Promise<{ gas: bigint }> {
    if (!this.account) throw new Error('No account connected');

    const data = encodeFn({ abi: this.abi, functionName, args });
    const tx: Partial<TransactionRequest> = { from: this.account, to: this.address, data };
    if (options.value !== undefined) tx.value = `0x${options.value.toString(16)}`;

    try {
      return { gas: await estimateGas(this.provider, tx) };
    } catch (e) {
      return withDecodedRevert(this.abi, functionName, e);
    }
  }

  encodeData(functionName: string, args: readonly unknown[] = []): Hex {
    return encodeFn({ abi: this.abi, functionName, args });
  }

  decodeResult<T = unknown>(functionName: string, data: Hex): T {
    return decodeFn({ abi: this.abi, functionName, data }) as T;
  }

  getFunction(name: string): AbiFunction | undefined {
    return this.abi.find(
      (item): item is AbiFunction =>
        item.type === 'function' && (item as AbiFunction).name === name,
    );
  }

  isReadOnly(functionName: string): boolean {
    const fn = this.getFunction(functionName);
    return fn?.stateMutability === 'view' || fn?.stateMutability === 'pure';
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

export function getContract(config: ContractConfig): Contract {
  return new Contract(config);
}

export async function readContract<T = unknown>(
  provider: Eip1193Provider,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return new Contract({ address, abi, provider }).read<T>(functionName, args);
}

export async function writeContract(
  provider: Eip1193Provider,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  account: Address,
  options: WriteOptions = {},
): Promise<Hex> {
  return new Contract({ address, abi, provider, account }).write(functionName, args, options);
}
