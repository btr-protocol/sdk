/**
 * Input validation utilities
 */

import type { Address, Eip1193Provider } from '../eth/index.js';

// Canonical address validator lives in ../eth/types.ts (`isAddress`).
// Re-export here for backward compatibility within @btr-protocol/sdk/utils.
export { isAddress } from '../eth/types.js';

/**
 * Check if address has code (is contract)
 */
export async function isContract(
  provider: Eip1193Provider,
  address: Address,
): Promise<boolean> {
  const code = await provider.request({
    method: 'eth_getCode',
    params: [address, 'latest'],
  }) as string;
  return code !== undefined && code !== '0x';
}
