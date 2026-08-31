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
export const coldGet = <T>(k: string): T | null => {
  ensure();
  try {
    const v = localStorage.getItem(P + k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
export const coldSet = (k: string, v: unknown) => {
  ensure();
  if (isDev()) return;
  try {
    localStorage.setItem(P + k, JSON.stringify(v));
  } catch {}
};
