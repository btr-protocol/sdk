/** Chain-scoped deployment ABIs. Build-head exports are separate decode/build surfaces. */
import lock from '../../abis.lock.json';
import accessControl from '../../abis/generations/pool-v1-s7/AccessControl.json';
import admin from '../../abis/generations/pool-v1-s7/Admin.json';
import pool from '../../abis/generations/pool-v1-s7/Pool.json';
import poolFactory from '../../abis/generations/pool-v1-s7/PoolFactory.json';
import { getApiRoot } from '../api.js';
import type { Abi } from '../eth/abi.js';
import { abiHash } from './hash.js';

type Deployment = { generation: string; pins: Record<string, string> };
const chains: Record<string, Deployment> = lock.chains;
const bundled: Record<string, Abi> = {
  Pool: pool as Abi,
  Admin: admin as Abi,
  PoolFactory: poolFactory as Abi,
  AccessControl: accessControl as Abi,
};
for (const [name, abi] of Object.entries(bundled)) {
  if (abiHash(abi) !== chains['143'].pins[name])
    throw new Error(`fetchAbi: deployed ${name} misses its chain/generation pin`);
}
const hot = new Map<string, Abi>();

function context(chainId: number, generation?: string): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('invalid ABI chain id');
  const pinned = chains[String(chainId)];
  const selected = generation ?? pinned?.generation;
  if (!selected) throw new Error('ABI generation required for an unpinned chain');
  if (pinned && selected !== pinned.generation)
    throw new Error('ABI generation differs from chain pin');
  return selected;
}

/** Omitting chainId preserves the legacy mainnet call; new callers should always pass it.
 * No localStorage cache. Cache identity includes API origin, chain, generation and name.
 * A pinned chain refuses an unexpected generation or changed ABI content. */
export async function fetchAbi(name: string, chainId = 143, generation?: string): Promise<Abi> {
  const selected = context(chainId, generation);
  const canonical =
    Object.keys(chains[String(chainId)]?.pins ?? {}).find(
      (n) => n.toLowerCase() === name.toLowerCase(),
    ) ?? name;
  if (!/^[a-zA-Z0-9]{1,64}$/.test(canonical)) throw new Error('invalid ABI name');
  if (chainId === 143 && selected === 'pool-v1-s7' && bundled[canonical]) return bundled[canonical];
  const key = `${getApiRoot()}:${chainId}:${selected}:${canonical.toLowerCase()}`;
  const cached = hot.get(key);
  if (cached) return cached;
  const res = await fetch(getAbiUrl(canonical, chainId), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`BTR ABI ${res.status} ${canonical} on chain ${chainId}`);
  if (res.headers.get('x-btr-abi-generation') !== selected)
    throw new Error('ABI response generation differs from requested generation');
  const abi = await res.json();
  if (!Array.isArray(abi)) throw new Error('invalid ABI response');
  const pin = chains[String(chainId)]?.pins[canonical];
  if (pin && abiHash(abi) !== pin) throw new Error('ABI response misses chain/generation pin');
  hot.set(key, abi as Abi);
  return abi as Abi;
}

export function resetFetchAbiCacheForTest(): void {
  hot.clear();
}
export function getAbiUrl(name: string, chainId = 143) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('invalid ABI chain id');
  return `${getApiRoot()}/v1/abis/${encodeURIComponent(name)}?chain_id=${chainId}`;
}
// Source mirror only; this URL does not establish a deployment generation.
export function getAbiGithubUrl(name: string) {
  return `https://github.com/btr-protocol/abis/blob/main/${name}.json`;
}
