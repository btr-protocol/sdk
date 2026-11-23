/**
 * Minimal Contract class
 * Zero dependencies
 */

import type { Abi, AbiFunction } from './abi';
import { decodeErrorResult, decodeFn, encodeFn } from './abi';
import { ethCall, rpcErrorData } from './rpc';
import { RpcRevertError } from './transport';
import type { Address, Eip1193Provider, Hex } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ContractConfig {
  address: Address;
  abi: Abi;
  provider: Eip1193Provider;
}

interface ReadOptions {
  blockTag?: 'latest' | 'pending' | 'earliest' | Hex;
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

/** The one revert decoder: `e`'s revert data (any wrapper nest) decoded against the first of `abis`
 *  that knows the selector, as a {@link ContractRevertError} labelled `${label} reverted: ...`.
 *  Anything else (no data, unknown selector, clipped data) comes back as `e` itself. */
export function decodeRevert(abis: readonly Abi[], e: unknown, label: string): unknown {
  const data = rpcErrorData(e);
  if (!data) return e;
  for (const abi of abis) {
    let d: ReturnType<typeof decodeErrorResult>;
    try {
      d = decodeErrorResult(abi, data);
    } catch {
      return e; // clipped revert data: the revert is still the answer, keep the transport's error
    }
    if (!d) continue;
    const args = d.args.length ? `(${d.args.map(String).join(', ')})` : '';
    const code = (e as { code?: number }).code;
    return new ContractRevertError(
      d.name,
      d.args,
      `${label} reverted: ${d.name}${args}`,
      code,
      data,
    );
  }
  return e;
}

const withDecodedRevert = (abi: Abi, fn: string, e: unknown): never => {
  throw decodeRevert([abi], e, fn);
};

export class Contract {
  readonly address: Address;
  readonly abi: Abi;
  readonly provider: Eip1193Provider;

  constructor(config: ContractConfig) {
    this.address = config.address;
    this.abi = config.abi;
    this.provider = config.provider;
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

export async function readContract<T = unknown>(
  provider: Eip1193Provider,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<T> {
  return new Contract({ address, abi, provider }).read<T>(functionName, args);
}
