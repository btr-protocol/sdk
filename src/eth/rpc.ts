/**
 * JSON-RPC helpers for Ethereum providers
 * Zero dependencies
 */

import type {
  Address,
  Eip1193Provider,
  Hex,
  TransactionReceipt,
  TransactionRequest,
  TypedData,
} from './types';

// ─────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────

const cmd = <T>(p: Eip1193Provider, method: string, params: unknown[] = []): Promise<T> =>
  p.request({ method, params }) as Promise<T>;

const toHex = (n: number | bigint): Hex => `0x${n.toString(16)}`;
const toInt = (h: string) => parseInt(h, 16);
const toBig = BigInt;

// ─────────────────────────────────────────────────────────────
// Core Methods
// ─────────────────────────────────────────────────────────────

export const requestAccounts = (p: Eip1193Provider) => cmd<Address[]>(p, 'eth_requestAccounts');
export const getAccounts = (p: Eip1193Provider) => cmd<Address[]>(p, 'eth_accounts');
export const getChainId = (p: Eip1193Provider) => cmd<string>(p, 'eth_chainId').then(toInt);
export const getGasPrice = (p: Eip1193Provider) => cmd<string>(p, 'eth_gasPrice').then(toBig);
export const getBlockNumber = (p: Eip1193Provider) => cmd<string>(p, 'eth_blockNumber').then(toBig);

export const getNativeBalance = (p: Eip1193Provider, addr: Address) =>
  cmd<string>(p, 'eth_getBalance', [addr, 'latest']).then(toBig);

export const getTransactionCount = (p: Eip1193Provider, addr: Address) =>
  cmd<string>(p, 'eth_getTransactionCount', [addr, 'latest']).then(toInt);

export const getTransactionReceipt = (p: Eip1193Provider, hash: Hex) =>
  cmd<TransactionReceipt | null>(p, 'eth_getTransactionReceipt', [hash]);

export const getNonce = (p: Eip1193Provider, addr: Address) => getTransactionCount(p, addr);

// ─────────────────────────────────────────────────────────────
// Contracts & Tx
// ─────────────────────────────────────────────────────────────

export const ethCall = (p: Eip1193Provider, to: Address, data: Hex, block: string = 'latest') =>
  cmd<Hex>(p, 'eth_call', [{ to, data }, block]);

export const estimateGas = (p: Eip1193Provider, tx: Partial<TransactionRequest>) =>
  cmd<string>(p, 'eth_estimateGas', [tx]).then(toBig);

export const sendTransaction = (p: Eip1193Provider, tx: TransactionRequest) =>
  cmd<Hex>(p, 'eth_sendTransaction', [tx]);

// ─────────────────────────────────────────────────────────────
// Signatures
// ─────────────────────────────────────────────────────────────

export const signMessage = (p: Eip1193Provider, address: Address, msg: string) => {
  const hexMsg = msg.startsWith('0x')
    ? msg
    : `0x${Array.from(new TextEncoder().encode(msg))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`;
  return cmd<Hex>(p, 'personal_sign', [hexMsg, address]);
};

export const signTypedData = (p: Eip1193Provider, address: Address, data: TypedData) =>
  cmd<Hex>(p, 'eth_signTypedData_v4', [
    address,
    JSON.stringify({
      domain: data.domain,
      types: data.types,
      primaryType: data.primaryType,
      message: data.message,
    }),
  ]);

// ─────────────────────────────────────────────────────────────
// Chain Switching
// ─────────────────────────────────────────────────────────────

/**
 * EIP-1193 error code, dug out of the wrappers wallets bury it under.
 *
 * MetaMask does not always surface `wallet_switchEthereumChain`'s 4902 at the top level: it
 * reports `-32603 Internal JSON-RPC error` and hides the real code in `data.originalError.code`.
 * Reading only `err.code` therefore misses "chain not added" entirely, so the caller never falls
 * back to `wallet_addEthereumChain` and the wallet silently stays where it was.
 */
export const rpcErrorCode = (e: unknown): number | undefined => {
  for (let n: any = e, i = 0; n && typeof n === 'object' && i < 4; i++) {
    const c = typeof n.code === 'string' ? Number(n.code) : n.code;
    // -32603 is the wrapper itself; keep digging for the code it wraps.
    if (typeof c === 'number' && Number.isFinite(c) && c !== -32603) return c;
    n = n.data?.originalError ?? n.data ?? n.cause ?? n.error;
  }
  return typeof (e as { code?: number })?.code === 'number'
    ? (e as { code: number }).code
    : undefined;
};

/**
 * Raw revert calldata dug out of the same wrapper nest as `rpcErrorCode`, e.g. MetaMask's
 * `err.data.originalError.data`. This is the ABI-encoded custom error (`selector‖args`), still
 * undecoded — decode it against the reverting contract's ABI to get a real reason.
 */
export const rpcErrorData = (e: unknown): string | undefined => {
  for (let n: any = e, i = 0; n && typeof n === 'object' && i < 4; i++) {
    if (typeof n.data === 'string' && n.data.startsWith('0x') && n.data.length >= 10) return n.data;
    n = n.data?.originalError ?? n.data ?? n.cause ?? n.error;
  }
  return undefined;
};

/** True when the injected provider's port is dead (extension updated/reloaded under the page).
 *  Nothing the dapp sends can succeed until the page reloads and re-grabs `window.ethereum`. */
export const isProviderDisconnected = (e: unknown): boolean =>
  /extension context invalidated|provider is disconnected|disconnected from all chains|receiving end does not exist/i.test(
    e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? ''),
  );

/** Ask the wallet to switch. Throws the wallet's own error, with `rpcErrorCode` readable off it. */
export const switchChain = (p: Eip1193Provider, id: number) =>
  cmd(p, 'wallet_switchEthereumChain', [{ chainId: toHex(id) }]);

export const addChain = (p: Eip1193Provider, chain: { chainId: number; [key: string]: unknown }) =>
  cmd(p, 'wallet_addEthereumChain', [{ ...chain, chainId: toHex(chain.chainId) }]);

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

export const waitForTransaction = async (
  p: Eip1193Provider,
  hash: Hex,
  confirms = 1,
  timeout = 60000,
): Promise<unknown> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await cmd<unknown>(p, 'eth_getTransactionReceipt', [hash]);
    if (r) {
      if (confirms > 1) {
        const current = await getBlockNumber(p);
        if (current - toBig((r as { blockNumber: string }).blockNumber) + 1n < BigInt(confirms)) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
      return r;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Tx ${hash} timed out`);
};

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

const sub = (p: Eip1193Provider, event: string, fn: (...args: unknown[]) => void) => {
  p.on?.(event, fn);
  return () => p.removeListener?.(event, fn);
};

export const onAccountsChanged = (p: Eip1193Provider, cb: (accs: Address[]) => void) =>
  sub(p, 'accountsChanged', (accs: unknown) => cb(accs as Address[]));

export const onChainChanged = (p: Eip1193Provider, cb: (id: number) => void) =>
  sub(p, 'chainChanged', (id: unknown) => cb(typeof id === 'string' ? toInt(id) : (id as number)));

export const onDisconnect = (p: Eip1193Provider, cb: (err: unknown) => void) =>
  sub(p, 'disconnect', cb);
