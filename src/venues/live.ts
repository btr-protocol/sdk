// Live registry client: reads deployments from the API, falls back to the baked record.
// Live wins on disagreement (warning returned). Read-only; no signing.

import { getApiRoot } from '../api.js';
import { type Address, isAddress } from '../eth/types.js';
import { type ChainVenue, DEPLOYED_VENUES } from './deployments.generated.js';
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
  /** Baked keys the server does not serve (not an error). */
  info: string[];
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
export function parseLive(j: any): Omit<LiveRegistry, 'source' | 'warnings' | 'info'> {
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
    info: [],
  };
}

/** The contracts the SDK pins: each one the built-in copy has must be served live, same address. */
export const CONTRACT_ALLOWLIST = [
  'accessControl',
  'admin',
  'coopArb',
  'flash',
  'markStoreP8',
  'poolFactory',
  'poolLens',
  'router',
] as const;

/** Both directions. `hard` = live disagrees with a baked address or serves one baked lacks
 *  (changed, new or renamed key); `soft` = baked-only keys (impls/adapters the live shape omits). */
function diff(live: Record<string, string>, baked: Record<string, string>, what: string) {
  const hard: string[] = [];
  const soft: string[] = [];
  for (const [k, a] of Object.entries(live)) {
    const b = baked[k];
    if (!b) hard.push(`${what}.${k}: live ${a}, absent from baked`);
    else if (!eqAddr(a, b)) hard.push(`${what}.${k}: live ${a} != baked ${b}`);
  }
  for (const k of Object.keys(baked)) if (!(k in live)) soft.push(`${what}.${k}: baked only`);
  return { hard, soft };
}

export interface RegistryOpts extends LiveOpts {
  /** Accept live data that disagrees with the baked record (warnings still returned). */
  trustLive?: boolean;
  /** Only way to get baked data: return it, with a warning, when the live fetch fails. */
  fallback?: 'baked';
}

/**
 * Live registry for `chainId` (default: baked default chain). Throws when the fetch fails
 * (unless `fallback: 'baked'`), when live disagrees with baked, or when the chain has no baked
 * record to check against (unless `trustLive`). Callers never get baked data silently.
 */
export async function fetchRegistry(chainId?: number, o: RegistryOpts = {}): Promise<LiveRegistry> {
  const id = chainId ?? defaultChainId();
  let live: ReturnType<typeof parseLive>;
  try {
    live = parseLive(await getJson(`${REGISTRY_PATH}?chainId=${id}`, o));
    if (live.chainId !== id) throw new Error(`asked chain ${id}, got ${live.chainId}`);
  } catch (e) {
    if (o.fallback !== 'baked')
      throw new Error(`live registry fetch failed: ${(e as Error).message}`);
    const b = bakedRegistry(id); // throws if chain not baked either
    b.warnings.push(`live fetch failed (${(e as Error).message}); using baked deployments`);
    return b;
  }
  const hard: string[] = [];
  const soft: string[] = [];
  const v = DEPLOYED_VENUES[id];
  if (!v) hard.push(`chain ${id}: no baked record to verify live against`);
  else {
    for (const k of CONTRACT_ALLOWLIST) {
      const b = v.contracts[k];
      const l = live.contracts[k];
      if (!b) continue;
      if (!l) hard.push(`contracts.${k}: baked ${b}, not served live`);
      else if (!eqAddr(l, b)) hard.push(`contracts.${k}: live ${l} != baked ${b}`);
    }
    for (const k of Object.keys(v.contracts))
      if (!(k in live.contracts)) soft.push(`contracts.${k}: baked only`);
    for (const [what, l, b] of [
      ['tokens', live.tokens, v.tokens],
      [
        'pools',
        Object.fromEntries(live.pools.map((p) => [p.tag, p.address])),
        Object.fromEntries(v.pools.map((p) => [p.tag, p.address])),
      ],
    ] as const) {
      const d = diff(l, b, what);
      hard.push(...d.hard);
      // a baked-only pool is a pool the live API no longer serves: that is a real mismatch
      (what === 'pools' ? hard : soft).push(...d.soft);
    }
  }
  if (hard.length && !o.trustLive)
    throw new Error(
      `live registry disagrees with baked deployments (pass trustLive to accept): ${hard.join('; ')}`,
    );
  return { ...live, source: 'live', warnings: hard, info: soft };
}

export const fetchRoster = (chainId: number, o: LiveOpts = {}): Promise<unknown> =>
  getJson(`/v1/roster?chainId=${chainId}`, o);

export const fetchAbi = (name: string, o: LiveOpts = {}): Promise<unknown> => {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`bad ABI name: ${name}`);
  return getJson(`/v1/abis/${name}`, o);
};
