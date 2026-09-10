/** ABIs lazy: hot cache only. Docs: https://btr.markets/docs/contracts#abis
 *
 *  ! NO COLD (localStorage) CACHE FOR ABIs, and nothing over the wire for a name this SDK already
 *  pins. An ABI decides how calldata is built, so a row that survives in a browser's storage is a
 *  standing instruction to encode the user's money a particular way — and the cold row had zero
 *  integrity in either direction: nothing authenticated the payload that filled it, and the
 *  version purge that was supposed to bound its lifetime keys on `VITE_APP_VERSION`, which the
 *  front pins to `npm_package_version` and has read `0.1.0` across every release. A poisoned
 *  `btr:cache:abi:pool` therefore outlived every deploy.
 *
 *  What replaces it is the build-time pin: `bun run fetch-abis` verifies Pool and Admin against
 *  the normalised content hashes in `abis.lock.json` before writing them, so the copies imported
 *  here ARE the backend's reviewed ABI. Serving those directly is both faster and the only
 *  integrity available at runtime; a name outside the pinned set still goes to the backend, is
 *  cached for the session only, and is exactly as trusted as the backend is. */
import { btrFetch, getApiRoot } from '../api.js';
import type { Abi } from '../eth/abi.js';
import { ADMIN_ABI } from './Admin.js';
import { POOL_ABI } from './Pool.js';

/** Names carried by `abis.lock.json`; keyed lowercase, as `fetchAbi` keys its cache. */
const PINNED: Record<string, Abi> = { pool: POOL_ABI, admin: ADMIN_ABI };

const hot = new Map<string, Abi>();
export async function fetchAbi(name: string): Promise<Abi> {
  const k = name.toLowerCase();
  const pinned = PINNED[k];
  if (pinned) return pinned;
  const hk = hot.get(k);
  if (hk) return hk;
  const abi = await btrFetch<Abi>(`/v1/abis/${name}`);
  hot.set(k, abi);
  return abi;
}
/** Test-only: drop the session cache so a test re-fetches the live ABI (never a stale shape). */
export function resetFetchAbiCacheForTest(): void {
  hot.clear();
}
export function getAbiUrl(name: string) {
  return `${getApiRoot()}/v1/abis/${name}`;
}
// GitHub mirror for docs: https://github.com/btr-protocol/abis/blob/main/${name}.json
export function getAbiGithubUrl(name: string) {
  return `https://github.com/btr-protocol/abis/blob/main/${name}.json`;
}
