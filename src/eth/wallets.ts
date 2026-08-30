/**
 * Wallet Detection & Configuration
 * EIP-6963 + comprehensive legacy fallbacks
 */

import { getCode } from './rpc';
import type { Address, Eip1193Provider } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** An EIP-1193 provider plus whatever capability flags the wallet injected on it
 *  (isMetaMask, isRabby, providers, ...): accessed dynamically, so kept as unknowns. */
type InjectedProvider = Eip1193Provider & Partial<Record<string, unknown>>;

/** The slice of `window` legacy detection probes directly. Everything else goes through
 *  getPath's dynamic walk, so only the named globals are typed here. */
interface WalletWindow {
  ethereum?: InjectedProvider;
  rabby?: InjectedProvider;
  phantom?: { ethereum?: InjectedProvider };
  coinbaseWalletExtension?: InjectedProvider;
}

export interface WalletInfo {
  id: string;
  name: string;
  /**
   * The icon the wallet ANNOUNCED over EIP-6963, verbatim, or `undefined`.
   *
   * NOT a path into our assets: that is derived from [`WalletInfo.id`] by the glyph component,
   * which is the only thing that knows where icons live. This field exists so a wallet the
   * catalog has never seen still draws something, and it is attacker-controlled data (wallets
   * announce `data:image/svg+xml,…`): render it through an `<img src>` and nothing else.
   */
  announcedIcon?: string;
  provider: Eip1193Provider;
  rdns?: string;
  detected: boolean;
}

export interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// ─────────────────────────────────────────────────────────────
// Wallet Database (single source of truth)
// ─────────────────────────────────────────────────────────────

interface WalletDef {
  id: string;
  name: string;
  url: string; // download URL
  rdns?: string; // EIP-6963 reverse domain
  path?: string; // window.* path for legacy detection
  flag?: string; // ethereum.isX flag
  mobile?: boolean; // available on mobile
  wc?: boolean; // show in WalletConnect grid
  discoverMobile?: boolean; // show in mobile discover section
  discoverDesktop?: boolean; // show in desktop discover section
}

export const WALLETS: WalletDef[] = [
  // Major wallets
  {
    id: 'metamask',
    name: 'MetaMask',
    url: 'https://metamask.io',
    rdns: 'io.metamask',
    flag: 'isMetaMask',
    mobile: true,
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  {
    id: 'rabby',
    name: 'Rabby',
    url: 'https://rabby.io',
    rdns: 'io.rabby',
    path: 'rabby',
    flag: 'isRabby',
    discoverDesktop: true,
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    url: 'https://rainbow.me',
    rdns: 'me.rainbow',
    path: 'rainbow',
    flag: 'isRainbow',
    mobile: true,
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  {
    id: 'phantom',
    name: 'Phantom',
    url: 'https://phantom.com',
    rdns: 'app.phantom',
    path: 'phantom.ethereum',
    flag: 'isPhantom',
    mobile: true,
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  {
    id: 'trust',
    name: 'Trust',
    url: 'https://trustwallet.com',
    rdns: 'com.trustwallet.app',
    path: 'trustwallet',
    flag: 'isTrust',
    mobile: true,
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  {
    id: 'base',
    name: 'Base',
    url: 'https://wallet.coinbase.com',
    rdns: 'com.coinbase.wallet',
    path: 'coinbaseWalletExtension',
    flag: 'isCoinbaseWallet',
    mobile: true,
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  { id: 'safe', name: 'Safe', url: 'https://safe.global', rdns: 'global.safe.wallet', wc: true },
  {
    id: 'backpack',
    name: 'Backpack',
    url: 'https://backpack.app',
    rdns: 'app.backpack',
    path: 'backpack.ethereum',
    flag: 'isBackpack',
  },

  // Hardware wallets
  { id: 'ledger', name: 'Ledger', url: 'https://ledger.com', wc: true },
  { id: 'trezor', name: 'Trezor', url: 'https://trezor.io', wc: true },
  { id: 'tangem', name: 'Tangem', url: 'https://tangem.com', wc: true },

  // Institutional
  { id: 'copper', name: 'Copper', url: 'https://copper.co', wc: true },
  { id: 'bitgo', name: 'BitGo', url: 'https://bitgo.com', wc: true },
  { id: 'fireblocks', name: 'Fireblocks', url: 'https://fireblocks.com', wc: true },

  // Exchange wallets
  {
    id: 'binance',
    name: 'Binance',
    url: 'https://www.binance.com',
    path: 'BinanceChain',
    flag: 'isBinance',
    wc: true,
  },
  {
    id: 'okx',
    name: 'OKX',
    url: 'https://web3.okx.com',
    rdns: 'com.okex.wallet',
    path: 'okxwallet',
    flag: 'isOkxWallet',
    wc: true,
    discoverMobile: true,
    discoverDesktop: true,
  },
  {
    id: 'bitget',
    name: 'Bitget',
    url: 'https://web3.bitget.com',
    rdns: 'com.bitget.wallet',
    path: 'bitkeep.ethereum',
    flag: 'isBitKeep',
    wc: true,
  },
  {
    id: 'gate',
    name: 'Gate',
    url: 'https://web3.gate.io',
    rdns: 'io.gate.wallet',
    path: 'gatewallet',
    flag: 'isGateWallet',
    wc: true,
  },
  { id: 'bybit', name: 'Bybit', url: 'https://www.bybit.com/en/web3', wc: true },
  { id: 'kucoin', name: 'KuCoin', url: 'https://kucoin.com', wc: true },

  // DeFi wallets
  {
    id: 'zerion',
    name: 'Zerion',
    url: 'https://zerion.io',
    rdns: 'io.zerion.wallet',
    path: 'zerionWallet',
    flag: 'isZerion',
  },
  {
    id: 'tokenpocket',
    name: 'TokenPocket',
    url: 'https://tokenpocket.pro',
    rdns: 'pro.tokenpocket',
    path: 'tokenpocket.ethereum',
    flag: 'isTokenPocket',
  },
  {
    id: 'coin98',
    name: 'Coin98',
    url: 'https://coin98.com',
    rdns: 'com.coin98',
    path: 'coin98.provider',
    flag: 'isCoin98',
  },
  {
    id: 'onekey',
    name: 'OneKey',
    url: 'https://onekey.so',
    rdns: 'so.onekey.wallet',
    path: '$onekey.ethereum',
    flag: 'isOneKey',
  },
  {
    id: 'family',
    name: 'Family',
    url: 'https://family.co',
    rdns: 'co.family.wallet',
    wc: true,
    discoverMobile: true,
  },
  {
    id: '1inch',
    name: '1inch',
    url: 'https://1inch.io/wallet',
    rdns: 'io.1inch.wallet',
    wc: true,
    discoverMobile: true,
  },
  {
    id: 'uniswap',
    name: 'Uniswap',
    url: 'https://wallet.uniswap.org',
    rdns: 'org.uniswap',
    wc: true,
    discoverMobile: true,
  },
  { id: 'imtoken', name: 'imToken', url: 'https://token.im', rdns: 'im.token', wc: true },
  {
    id: 'safepal',
    name: 'SafePal',
    url: 'https://safepal.com',
    rdns: 'com.safepal',
    path: 'safepalProvider',
    flag: 'isSafePal',
    wc: true,
  },
  { id: 'argent', name: 'Argent', url: 'https://argent.xyz', rdns: 'xyz.argent', wc: true },

  // Browser & other
  {
    id: 'brave',
    name: 'Brave',
    url: 'https://brave.com/wallet',
    rdns: 'com.brave.wallet',
    flag: 'isBraveWallet',
  },
  {
    id: 'frame',
    name: 'Frame',
    url: 'https://frame.sh',
    rdns: 'sh.frame',
    path: 'frame',
    flag: 'isFrame',
  },
  {
    id: 'ctrl',
    name: 'Ctrl',
    url: 'https://ctrl.xyz',
    rdns: 'xyz.ctrl',
    path: 'xfi.ethereum',
    flag: 'isXDEFI',
  },
  {
    id: 'exodus',
    name: 'Exodus',
    url: 'https://exodus.com',
    rdns: 'com.exodus',
    path: 'exodus.ethereum',
    flag: 'isExodus',
  },
  {
    id: 'tally',
    name: 'Taho',
    url: 'https://taho.xyz',
    rdns: 'xyz.taho',
    path: 'tally',
    flag: 'isTally',
  },
  {
    id: 'core',
    name: 'Core',
    url: 'https://core.app',
    rdns: 'app.core.extension',
    path: 'avalanche',
    flag: 'isAvalanche',
  },
  { id: 'zeal', name: 'Zeal', url: 'https://zeal.app', rdns: 'app.zeal' },
  { id: 'nightly', name: 'Nightly', url: 'https://nightly.app', rdns: 'app.nightly' },
  { id: 'guarda', name: 'Guarda', url: 'https://guarda.com' },
];

// Build lookup maps from WALLETS array
const byId = new Map(WALLETS.map((w) => [w.id, w]));

/** A display name reduced to its identifying core: lowercase alphanumerics, minus a trailing
 *  "wallet". `Safe{Wallet}`, `Trust Wallet` and `OKX Wallet` are the same wallets as `Safe`,
 *  `Trust` and `OKX`: the suffix is branding, not identity. */
const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/wallet$/, '');

/**
 * THE alias map: every EIP-6963 `rdns` and every display name the catalog knows, pointing at the
 * one entry that owns that id.
 *
 * ONE map, so a wallet is a single row in [`WALLETS`] rather than three lists that drift: the id
 * telemetry reports, the icon the grid renders and the name the tooltip shows all come out of it.
 * rdns keys always contain a dot and name keys never do, so the two key spaces cannot collide.
 */
const ALIASES = new Map<string, WalletDef>();
for (const w of WALLETS) {
  if (w.rdns) ALIASES.set(w.rdns.toLowerCase(), w);
  ALIASES.set(nameKey(w.name), w);
}
// Names wallets announce over EIP-6963/WalletConnect that the catalog spells differently. Kept
// short on purpose: `nameKey` already absorbs case, spacing and the "Wallet" suffix.
for (const [alias, id] of [
  ['coinbase', 'base'],
  ['coinbasesmart', 'base'],
  ['bitkeep', 'bitget'],
  ['xdefi', 'ctrl'],
  ['okex', 'okx'],
  ['safemultisig', 'safe'],
] as const) {
  const def = byId.get(id);
  if (def) ALIASES.set(alias, def);
}

// Curated lists derived from WALLETS
export const WC_ICONS = WALLETS.filter((w) => w.wc).map((w) => w.id);
export const DISCOVER_MOBILE = WALLETS.filter((w) => w.discoverMobile).map((w) => w.id);
export const DISCOVER_DESKTOP = WALLETS.filter((w) => w.discoverDesktop).map((w) => w.id);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const win = (): WalletWindow | null =>
  typeof window !== 'undefined' ? (window as WalletWindow) : null;

function getPath(path: string): Eip1193Provider | null {
  try {
    let obj: unknown = win();
    for (const p of path.split('.')) {
      obj =
        obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[p] : undefined;
    }
    const request =
      obj !== null && typeof obj === 'object' ? (obj as { request?: unknown }).request : undefined;
    return request ? (obj as Eip1193Provider) : null;
  } catch {
    return null;
  }
}

function hasFlag(p: unknown, f: string): boolean {
  try {
    return Boolean((p as Partial<Record<string, unknown>> | undefined)?.[f]);
  } catch {
    return false;
  }
}

function multiProviders(): Eip1193Provider[] {
  try {
    const p = win()?.ethereum?.providers;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export const isMobile = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
/** Is this id a row in [`WALLETS`], i.e. do we ship a rasterised icon and a name for it? */
export const isKnownWallet = (id: string): boolean => byId.has(id);
export const getDownloadUrl = (id: string) => byId.get(id)?.url || null;
export const getName = (id: string) => byId.get(id)?.name || id;
export const getTooltip = (id: string) => {
  const w = byId.get(id);
  return w ? `${w.name}${w.mobile ? ' Mobile' : ''}` : id;
};

// ─────────────────────────────────────────────────────────────
// Legacy Detection
// ─────────────────────────────────────────────────────────────

export function detectLegacy(): WalletInfo[] {
  const w = win();
  if (!w) return [];

  const multi = multiProviders();
  const detected: WalletInfo[] = [];
  const seen = new Set<string>();

  for (const def of WALLETS) {
    const { path, flag } = def;
    if (!path && !flag) continue; // No legacy detection possible

    let provider: Eip1193Provider | null = null;

    // 1. Check dedicated global
    if (path) provider = getPath(path);

    // 2. Check multi-provider array
    if (!provider && flag) provider = multi.find((p) => hasFlag(p, flag)) ?? null;

    // 3. Check window.ethereum
    if (!provider && flag && hasFlag(w.ethereum, flag)) provider = w.ethereum ?? null;

    // Special: MetaMask shouldn't be Rabby
    if (def.id === 'metamask' && hasFlag(provider, 'isRabby')) continue;

    if (provider && !seen.has(def.id)) {
      seen.add(def.id);
      detected.push({ id: def.id, name: def.name, provider, detected: true });
    }
  }

  // Fallback: generic injected
  if (!detected.length && w.ethereum?.request) {
    detected.push({
      id: 'injected',
      name: 'Browser Wallet',
      provider: w.ethereum,
      detected: true,
    });
  }

  return detected;
}

// ─────────────────────────────────────────────────────────────
// EIP-6963 Store
// ─────────────────────────────────────────────────────────────

export const eip6963Providers: Eip6963Detail[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e: Event) => {
    const detail: Eip6963Detail = (e as CustomEvent<Eip6963Detail>).detail;
    if (!eip6963Providers.some((p) => p.info.uuid === detail.info.uuid)) {
      eip6963Providers.push(detail);
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

// ─────────────────────────────────────────────────────────────
// Convert EIP-6963 to WalletInfo
// ─────────────────────────────────────────────────────────────

export function toWalletInfo(detail: Eip6963Detail): WalletInfo {
  const id = ALIASES.get(detail.info.rdns.toLowerCase())?.id || detail.info.rdns;
  const def = byId.get(id);
  return {
    id,
    name: def?.name || detail.info.name,
    // Always carried, even for a known wallet: it is the fallback if our raster 404s.
    announcedIcon: detail.info.icon,
    rdns: detail.info.rdns,
    provider: detail.provider,
    detected: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Merge EIP-6963 + Legacy (deduped)
// ─────────────────────────────────────────────────────────────

export function mergeWallets(eip6963: Eip6963Detail[], legacy: WalletInfo[]): WalletInfo[] {
  const wallets = eip6963.map(toWalletInfo);
  const seen = new Set(wallets.map((w) => w.id));
  return [...wallets, ...legacy.filter((w) => !seen.has(w.id))].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

// ─────────────────────────────────────────────────────────────
// Specific Wallet Getters
// ─────────────────────────────────────────────────────────────

export function getMetaMask(): Eip1193Provider | null {
  const w = win();
  if (!w) return null;
  const eth = w.ethereum;
  const multi = multiProviders().find(
    (p) => hasFlag(p, 'isMetaMask') && !hasFlag(p, 'isBraveWallet'),
  );
  if (multi) return multi;
  return eth?.isMetaMask && !eth.isBraveWallet ? eth : null;
}

export function getBaseWallet(): Eip1193Provider | null {
  const w = win();
  if (!w) return null;
  const cb = w.coinbaseWalletExtension;
  if (cb?.request) return cb;
  const multi = multiProviders().find((p) => hasFlag(p, 'isCoinbaseWallet'));
  return multi || (w.ethereum?.isCoinbaseWallet ? w.ethereum : null);
}

export function getRabby(): Eip1193Provider | null {
  const w = win();
  if (!w) return null;
  return w.rabby?.request ? w.rabby : w.ethereum?.isRabby ? w.ethereum : null;
}

export function getPhantom(): Eip1193Provider | null {
  const w = win();
  if (!w) return null;
  const ph = w.phantom?.ethereum;
  return ph?.request ? ph : w.ethereum?.isPhantom ? w.ethereum : null;
}

export function getInjected(): Eip1193Provider | null {
  const eth = win()?.ethereum;
  return eth?.request ? eth : null;
}

// ─────────────────────────────────────────────────────────────
// Identity of the CONNECTED wallet
// ─────────────────────────────────────────────────────────────

/**
 * What kind of account the connected address is, from ONE `eth_getCode`.
 *
 * `contract` covers Safe and every other smart account; `7702` is an EOA that has delegated to
 * code under EIP-7702 (its bytecode is the 23-byte `0xef0100 || address` designator). Three
 * values, and never the code itself: the bytecode of a smart account is close to an identifier.
 */
export type AccountClass = 'eoa' | 'contract' | '7702';

/**
 * The chain family the connected wallet speaks.
 *
 * `evm` is the only value because EVM is the only chain this app supports. The field exists so
 * the model does not have to change when that stops being true: an SVM wallet would widen this
 * to `'evm' | 'svm'` and add ONE branch in [`resolveWallet`] (marked below) that reads the
 * Wallet Standard registry the way step 2 reads [`eip6963Providers`]. Everything else here,
 * the alias map, the slug fallback, the wire field, is already chain-agnostic. No Wallet
 * Standard dependency is pulled in until there is a Solana surface to use it.
 */
export type WalletChain = 'evm';

/** The connected wallet, as the low-entropy values telemetry is allowed to carry. */
export interface WalletIdentity {
  /** Stable lowercase slug: `metamask`, `rabby`, `safe`, … Empty when nothing is connected. */
  id: string;
  chain: WalletChain;
}

/**
 * `raw` → a stable, short, lowercase slug. Never longer than 32 chars.
 *
 * The fallback for an rdns the catalog has never heard of: `xyz.newwallet` becomes
 * `xyz-newwallet`, which is a usable id today and the row someone adds to [`WALLETS`] tomorrow.
 * `unknown` would throw away the one fact we actually have.
 */
export function slug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '');
}

/**
 * Canonical id for a raw EIP-6963 `rdns` or a wallet's display name.
 *
 * Everything goes through the ONE alias map first; anything unrecognised still yields a slug, so
 * a wallet that ships EIP-6963 next week appears in telemetry under a stable id with no code
 * change here. That property is the whole reason rdns outranks the legacy flags.
 */
export function walletId(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return (ALIASES.get(s.toLowerCase()) ?? ALIASES.get(nameKey(s)))?.id ?? slug(s);
}

/**
 * Legacy injected flags, in the order they are believed.
 *
 * ORDER IS THE POINT. Rabby, Brave and most Coinbase builds also set `isMetaMask` so that dapps
 * which only ever probed that flag keep working: reading it first labels half the fleet
 * MetaMask. It is checked LAST, as the residual case, and only ever reached when EIP-6963 (which
 * these wallets all implement, and which cannot be spoofed the same way) gave us nothing.
 */
const LEGACY_FLAGS: readonly (readonly [string, string])[] = [
  ['isRabby', 'rabby'],
  ['isBraveWallet', 'brave'],
  ['isCoinbaseWallet', 'base'],
  ['isOkxWallet', 'okx'],
  ['isTrust', 'trust'],
  ['isTrustWallet', 'trust'],
  ['isPhantom', 'phantom'],
  ['isRainbow', 'rainbow'],
  ['isZerion', 'zerion'],
  ['isBitget', 'bitget'],
  ['isBitKeep', 'bitget'],
  ['isMetaMask', 'metamask'],
];

/** Hosts that embed a dapp as a Safe App. */
const SAFE_HOSTS = ['app.safe.global', 'safe.global'];

/**
 * Are we running as a Safe App, i.e. inside a Safe interface iframe?
 *
 * Host-based, because it is the only test that costs nothing: `@safe-global/safe-apps-sdk` would
 * be a dependency (and a postMessage handshake) to learn something the embedding origin already
 * says. Deliberately narrow: being in SOME iframe proves nothing, so an unknown embedder falls
 * through to the normal resolution rather than being guessed at.
 */
export function isSafeApp(): boolean {
  try {
    if (typeof window === 'undefined' || window.self === window.top) return false;
    const origins = window.location.ancestorOrigins;
    const embedder = (origins?.length ? origins[origins.length - 1] : document.referrer) || '';
    const host = new URL(embedder).hostname.toLowerCase();
    return SAFE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Where a wallet id may be read from, richest source first. */
export interface WalletIdSources {
  /** The LIVE provider the app is connected through, never a scan of what is installed. */
  provider?: Eip1193Provider | null;
  /** WalletConnect `session.peer.metadata.name`, when the connection came over WC. */
  peerName?: string | null;
  /** Whatever the connect button called it. Last resort, and the weakest claim of the five. */
  connectorName?: string | null;
}

/**
 * The connected wallet's id, resolved in a FIXED order of decreasing trustworthiness.
 *
 * 1. Safe App iframe: the embedder is a fact about the page, not a claim by the provider.
 * 2. EIP-6963 `rdns` of the live provider. Announced by the wallet under a reverse-domain name
 *    it controls, and read back out of the discovery store this SDK already keeps.
 * 3. WalletConnect peer metadata.
 * 4. Legacy injected flags, `isMetaMask` last; see [`LEGACY_FLAGS`].
 * 5. The connector's own name.
 *
 * The id is `''` when nothing is connected: an id is only ever reported for a live connection,
 * and never for a pre-connect scan of what happens to be installed (that list is a fingerprint).
 */
export function resolveWallet(src: WalletIdSources): WalletIdentity {
  return { id: resolveId(src), chain: 'evm' };
}

function resolveId(src: WalletIdSources): string {
  if (isSafeApp()) return 'safe';

  const p = src.provider;
  if (!p && !src.peerName && !src.connectorName) return '';

  // EIP-6963: match the live provider against the announcements already collected in
  // `eip6963Providers`, by identity, so a wallet that announced several providers cannot be
  // confused for a sibling. An SVM wallet would be looked up here, in the Wallet Standard
  // registry, and the rest of this function would be unchanged.
  if (p) {
    const rdns = eip6963Providers.find((d) => d.provider === p)?.info.rdns;
    if (rdns) return walletId(rdns);
  }

  if (src.peerName) return walletId(src.peerName);

  for (const [flag, id] of LEGACY_FLAGS) {
    if (hasFlag(p, flag)) return id;
  }

  return src.connectorName ? walletId(src.connectorName) : '';
}

/**
 * The connected address's account class, or `undefined` when the node would not say.
 *
 * A FAILED read is not an empty read: an RPC error must not be reported as `eoa`, so it reports
 * nothing at all and the column stays null.
 */
export async function accountClass(
  provider: Eip1193Provider,
  address: Address,
): Promise<AccountClass | undefined> {
  try {
    const code = (await getCode(provider, address))?.toLowerCase();
    if (!code || code === '0x') return 'eoa';
    // EIP-7702 delegation designator: `0xef0100 || address`. Prefix-tested, because the byte
    // after `0xef01` is a version and a future one must not read as a plain smart account.
    return code.startsWith('0xef01') ? '7702' : 'contract';
  } catch {
    return undefined;
  }
}
