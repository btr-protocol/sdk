/** Venues lazy: hot + cold cache, version-aware */
import { btrFetch, getApiRoot } from '../api.js';
import { coldGet, coldSet } from '../cache.js';
import type { ChainVenue } from './deployments.generated.js';

let hot: Record<number, ChainVenue> | null = null;
export async function fetchVenues(): Promise<Record<number, ChainVenue>> {
  if (hot) return hot;
  const cold = coldGet<Record<number, ChainVenue>>('venues');
  if (cold) {
    hot = cold;
    return cold;
  }
  const res = await btrFetch<Record<number, ChainVenue>>('/v1/venues');
  hot = res;
  coldSet('venues', res);
  return res;
}
export async function fetchVenue(chainId: number): Promise<ChainVenue | undefined> {
  const all = await fetchVenues();
  return all[chainId];
}
export function getVenuesUrl() {
  return `${getApiRoot()}/v1/venues`;
}
