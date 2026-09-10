/** Hot Map + cold localStorage (versioned). Dev = no cold (annoying). Browser caches JS/CSS/WebP. */
const P = 'btr:cache:';
const V = 'btr:cache:version';
const isDev = () => {
  try {
    const e =
      (typeof import.meta !== 'undefined' &&
        (import.meta as unknown as { env: Record<string, unknown> }).env) ||
      {};
    return (
      e.DEV === true ||
      e.MODE === 'development' ||
      (typeof process !== 'undefined' &&
        (process as unknown as { env: Record<string, string> }).env?.NODE_ENV === 'development')
    );
  } catch {
    return false;
  }
};
const ver = () =>
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env: Record<string, string> }).env?.VITE_APP_VERSION) ||
  '0';
let ck = false;
function ensure() {
  if (ck || typeof localStorage === 'undefined' || isDev()) return;
  ck = true;
  const cur = ver();
  const old = localStorage.getItem(V);
  if (cur !== old) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(P)) localStorage.removeItem(k);
    }
    localStorage.setItem(V, cur);
  }
}
/** Hard lifetime for a cold row, independent of the version tag.
 *
 *  `ensure()` purges on a version CHANGE, and the only consumer that has localStorage is the
 *  front, which defines `VITE_APP_VERSION` from `npm_package_version` — pinned at `0.1.0` across
 *  every release so far. So in practice the purge has never fired and a row written once lived
 *  forever. A stamped row expires whether or not anyone remembers to bump a version. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
type Row<T> = { t: number; v: T };

export const coldGet = <T>(k: string): T | null => {
  ensure();
  try {
    const raw = localStorage.getItem(P + k);
    if (!raw) return null;
    const row = JSON.parse(raw) as Row<T>;
    // An unstamped row is one this build did not write; drop it rather than date it to now.
    if (typeof row?.t !== 'number' || Date.now() - row.t > MAX_AGE_MS) {
      localStorage.removeItem(P + k);
      return null;
    }
    return row.v;
  } catch {
    return null;
  }
};
export const coldSet = (k: string, v: unknown) => {
  ensure();
  if (isDev()) return;
  try {
    localStorage.setItem(P + k, JSON.stringify({ t: Date.now(), v } satisfies Row<unknown>));
  } catch {}
};
