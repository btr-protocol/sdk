/** ABIs lazy — hot + cold (localStorage) cache, version-aware. Docs: https://btr.markets/docs/contracts#abis */
import { btrFetch, getApiRoot } from '../api.js';
import { coldGet, coldSet } from '../cache.js';
import type { Abi } from '../eth/abi.js';

const hot = new Map<string, Abi>();
export async function fetchAbi(name: string): Promise<Abi> {
  const k = name.toLowerCase();
  const hk = hot.get(k);
  if (hk) return hk;
  const ck = coldGet<Abi>(`abi:${k}`);
  if (ck) {
    hot.set(k, ck);
    return ck;
  }
  const abi = await btrFetch<Abi>(`/abis/${name}`);
  hot.set(k, abi);
  coldSet(`abi:${k}`, abi);
  return abi;
}
export function getAbiUrl(name: string) {
  return `${getApiRoot()}/abis/${name}`;
}
// GitHub mirror for docs: https://github.com/btr-protocol/abis/blob/main/${name}.json
export function getAbiGithubUrl(name: string) {
  return `https://github.com/btr-protocol/abis/blob/main/${name}.json`;
}
