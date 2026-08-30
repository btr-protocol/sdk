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
const toInt = (h: string) => Number.parseInt(h, 16);
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

/** Deployed bytecode at `addr`, `0x` for an EOA. The ONE `eth_getCode` in the SDK: the
 *  contract test and the EIP-7702 delegation test both read the same reply. */
export const getCode = (p: Eip1193Provider, addr: Address, block = 'latest') =>
  cmd<Hex>(p, 'eth_getCode', [addr, block]);

export const getNonce = (p: Eip1193Provider, addr: Address) => getTransactionCount(p, addr);

// ─────────────────────────────────────────────────────────────
// Contracts & Tx
// ─────────────────────────────────────────────────────────────

export const ethCall = (p: Eip1193Provider, to: Address, data: Hex, block = 'latest') =>
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
 * Walk MetaMask-style wrapper nests (`data.originalError` / `cause` / `error`) up to 4 levels
 * deep, yielding each node. Shared by `rpcErrorCode` and `rpcErrorData`.
 */
function* rpcErrorNodes(e: unknown): Generator<Record<string, unknown>> {
  let n: unknown = e;
  for (let i = 0; n && typeof n === 'object' && i < 4; i++) {
    const node = n as Record<string, unknown>;
    yield node;
    const data = node.data as { originalError?: unknown } | string | null | undefined;
    // -32603-style wrappers bury the real payload; keep digging for what they wrap.
    n =
      (typeof data === 'object' && data ? data.originalError : undefined) ??
      node.data ??
      node.cause ??
      node.error;
  }
}

/**
 * EIP-1193 error code, dug out of the wrappers wallets bury it under.
 *
 * MetaMask does not always surface `wallet_switchEthereumChain`'s 4902 at the top level: it
 * reports `-32603 Internal JSON-RPC error` and hides the real code in `data.originalError.code`.
 * Reading only `err.code` therefore misses "chain not added" entirely, so the caller never falls
 * back to `wallet_addEthereumChain` and the wallet silently stays where it was.
 */
export const rpcErrorCode = (e: unknown): number | undefined => {
  for (const node of rpcErrorNodes(e)) {
    const raw = node.code;
    const c = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof c === 'number' && Number.isFinite(c) && c !== -32603) return c;
  }
  return typeof (e as { code?: number })?.code === 'number'
    ? (e as { code: number }).code
    : undefined;
};

/**
 * Raw revert calldata dug out of the same wrapper nest as `rpcErrorCode`, e.g. MetaMask's
 * `err.data.originalError.data`. This is the ABI-encoded custom error (`selector‖args`), still
 * undecoded; decode it against the reverting contract's ABI to get a real reason.
 */
export const rpcErrorData = (e: unknown): string | undefined => {
  for (const node of rpcErrorNodes(e)) {
    const d = node.data;
    if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) return d;
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
