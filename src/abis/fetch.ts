import lock from '../../abis.lock.json';
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
 *  cached for the session only, and is exactly as trusted as the backend is.
 *
 *  PoolFactory and AccessControl are pinned the same way: the guardian/safety
 *  surfaces read through them, and a backend-served ABI there could suppress a pending upgrade
 *  from view. Every bundled copy is hash-checked against `abis.lock.json` at module load, so a
 *  tampered bundle fails loudly instead of encoding money a different way. */
import { btrFetch, getApiRoot } from '../api.js';
import type { Abi } from '../eth/abi.js';
import { ACCESS_CONTROL_ABI } from './AccessControl.js';
import { ADMIN_ABI } from './Admin.js';
import { POOL_ABI } from './Pool.js';
import { POOL_FACTORY_ABI } from './PoolFactory.js';
import { abiHash } from './hash.js';

/** Names answered from the bundle, hash-verified; keyed lowercase, as `fetchAbi` keys its cache. */
const PINNED: Record<string, Abi> = {
  pool: POOL_ABI,
  admin: ADMIN_ABI,
  poolfactory: POOL_FACTORY_ABI,
  accesscontrol: ACCESS_CONTROL_ABI,
};

/** The `abis.lock.json` pin each bundled name must hash to. A name without a pin is a build
 *  error, not a fallback to the wire: silently serving an unpinned guardian ABI is the hole. */
const PINS: Record<string, string> = {
  pool: (lock as Record<string, string>).Pool,
  admin: (lock as Record<string, string>).Admin,
  poolfactory: (lock as Record<string, string>).PoolFactory,
  accesscontrol: (lock as Record<string, string>).AccessControl,
};

for (const [name, abi] of Object.entries(PINNED)) {
  const want = PINS[name];
  if (!want) throw new Error(`fetchAbi: bundled ${name} ABI has no pin in abis.lock.json`);
  if (abiHash(abi as unknown[]) !== want)
    throw new Error(`fetchAbi: bundled ${name} ABI misses its abis.lock.json pin`);
}

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
