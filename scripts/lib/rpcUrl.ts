/** URL policy shared by `refresh-rpcs.ts` (what may enter the list) and `gen-rpcs.ts` (what may
 *  leave it for a wallet prompt, a CSP header and a public file). */

export type Tracking = 'none' | 'limited' | 'yes' | undefined;

/** Hosts a chain's own foundation or operator runs, per chain id. With `publicnode.com` they are
 *  the trusted tier: ranked first among NEW candidates and preferred for the sdk's top rows, since
 *  those reach a user's wallet prompt. A listing here is a trust decision: add a host only when
 *  you know who runs it. */
const OFFICIAL: Record<number, string[]> = {
  56: ['binance.org', 'bnbchain.org'],
  137: ['polygon-rpc.com', 'polygon.technology'],
  143: ['monad.xyz', 'monadinfra.com'],
  196: ['xlayer.tech', 'okx.com'],
  999: ['hyperliquid.xyz'],
  4663: ['robinhood.com'],
  5042: ['arc.network'],
  5042002: ['arc.network'],
  8453: ['base.org'],
  42161: ['arbitrum.io'],
  43114: ['avax.network'],
};
const REPUTABLE = ['publicnode.com'];

const PRIVATE_VARIANT =
  /fullprivacy|maxbackrun|noreverts|\/boost|\/fast$|flashbots|mevblocker|blxrbdn|bloxroute|private|mev-x/i;

/** Canonical form: lower-case host, no default port, no trailing slash. Equal endpoints compare equal. */
export function norm(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/+$/, '')}${x.search}`; // the query stays: unusable() must see a key
  } catch {
    return u.replace(/\/+$/, '');
  }
}

export const trusted = (chainId: number, url: string): boolean => {
  const host = new URL(url).hostname;
  return [...REPUTABLE, ...(OFFICIAL[chainId] ?? [])].some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
};

/** Why a URL can never be listed, or null. A key in the URL is a secret in a public file; a
 *  placeholder is a template; a long path segment is a key by shape; an IP literal, a bare label
 *  or a port is an internal address a probe could be pointed at; and the URL lands in a committed
 *  TS file, a CSP header and a wallet prompt, so only plain characters pass. */
export function unusable(url: string, tracking: Tracking): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'not a url';
  }
  if (u.protocol !== 'https:') return 'not https';
  if (/[${}]/.test(url)) return 'template';
  if (tracking === 'yes') return 'tracking';
  if (u.search || u.username || u.password) return 'key in url';
  if (u.pathname.split('/').some((s) => s.length >= 20 || s === 'demo')) return 'key in url';
  if (PRIVATE_VARIANT.test(url)) return 'private/mev variant';
  if (u.port) return 'port';
  if (u.hostname.endsWith('.')) return 'not a public hostname'; // `localhost.` is localhost
  if (!u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':'))
    return 'not a public hostname';
  if (
    /\.(local|internal|localhost|lan|home|corp|svc|cluster|intranet|private|test)$/i.test(
      u.hostname,
    )
  )
    return 'not a public hostname';
  if (!/^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._~/-]*)?$/i.test(url)) return 'odd characters';
  return null;
}
