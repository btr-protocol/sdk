// Live registry client: reads deployments from the API, falls back to the baked record.
// Live wins on disagreement (warning returned). Read-only; no signing.

import { getApiRoot } from '../api.js';
import { type Address, isAddress } from '../eth/types.js';
import type { ChainVenue } from './deployments.generated.js';
import { chainVenue, defaultChainId, eqAddr } from './registry.js';

/** One constant: switch to '/v1/registry' when the API ships it. */
export const REGISTRY_PATH = '/v1/assets/pools';

export interface LivePool {
  address: Address;
  tag: string;
  symbols: string[];
}

export interface LiveRegistry {
  chainId: number;
  name: string;
  contracts: Record<string, Address>;
  tokens: Record<string, Address>;
  pools: LivePool[];
  /** `live` = API answered; `baked` = fetch failed, generated file used. */
  source: 'live' | 'baked';
  warnings: string[];
}

type Fetch = typeof fetch;
export interface LiveOpts {
  fetch?: Fetch;
  base?: string;
  timeoutMs?: number;
}

async function getJson(path: string, o: LiveOpts): Promise<unknown> {
  const f = o.fetch ?? fetch;
  const res = await f(`${o.base ?? getApiRoot()}${path}`, {
    signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function addrMap(label: string, m: unknown): Record<string, Address> {
  if (!m || typeof m !== 'object') throw new Error(`${label}: not an object`);
  const out: Record<string, Address> = {};
  for (const [k, v] of Object.entries(m)) {
    if (typeof v !== 'string' || !isAddress(v)) throw new Error(`${label}.${k}: bad address`);
    out[k] = v;
  }
  return out;
}

/** Validate the live wire; throws on any malformed address. */
// biome-ignore lint/suspicious/noExplicitAny: untyped JSON wire
export function parseLive(j: any): Omit<LiveRegistry, 'source' | 'warnings'> {
  if (!j || typeof j.chainId !== 'number') throw new Error('registry: no chainId');
  // biome-ignore lint/suspicious/noExplicitAny: untyped JSON wire
  const pools: LivePool[] = (j.pools ?? []).map((p: any) => {
    if (typeof p?.address !== 'string' || !isAddress(p.address))
      throw new Error(`pool ${p?.tag}: bad address`);
    return { address: p.address, tag: String(p.tag), symbols: p.symbols ?? [] };
  });
  return {
    chainId: j.chainId,
    name: String(j.name ?? ''),
    contracts: addrMap('contracts', j.contracts),
    tokens: addrMap('tokens', j.tokens),
    pools,
  };
}

function bakedRegistry(chainId: number): LiveRegistry {
  const v: ChainVenue = chainVenue(chainId);
  return {
    chainId,
    name: '',
    contracts: v.contracts,
    tokens: v.tokens,
    pools: v.pools,
    source: 'baked',
    warnings: [],
  };
}

function diff(live: Record<string, string>, baked: Record<string, string>, what: string) {
  const w: string[] = [];
  for (const [k, a] of Object.entries(live)) {
    const b = baked[k];
    if (b && !eqAddr(a, b)) w.push(`${what}.${k}: live ${a} != baked ${b}`);
  }
  return w;
}

/** Live registry for `chainId` (default: baked default chain). Never throws on network failure. */
export async function fetchRegistry(chainId?: number, o: LiveOpts = {}): Promise<LiveRegistry> {
  const id = chainId ?? defaultChainId();
  try {
    const live = parseLive(await getJson(`${REGISTRY_PATH}?chainId=${id}`, o));
    if (live.chainId !== id) throw new Error(`asked chain ${id}, got ${live.chainId}`);
    const warnings: string[] = [];
    try {
      const b = chainVenue(id);
      warnings.push(...diff(live.contracts, b.contracts, 'contracts'));
      warnings.push(...diff(live.tokens, b.tokens, 'tokens'));
    } catch {
      warnings.push(`chain ${id} has no baked record to compare`);
    }
    return { ...live, source: 'live', warnings };
  } catch (e) {
    const b = bakedRegistry(id); // throws if chain not baked either
    b.warnings.push(`live fetch failed (${(e as Error).message}); using baked deployments`);
    return b;
  }
}

export const fetchRoster = (chainId: number, o: LiveOpts = {}): Promise<unknown> =>
  getJson(`/v1/roster?chainId=${chainId}`, o);

export const fetchAbi = (name: string, o: LiveOpts = {}): Promise<unknown> => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`bad ABI name: ${name}`);
  return getJson(`/v1/abis/${name}`, o);
};
