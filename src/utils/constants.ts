/**
 * Common constants used across the SDK
 */

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const BPS_PRECISION = 10_000n;
export const PRECISION_1E18 = 10n ** 18n;
export const MS_PER_DAY = 86_400_000;
/** How far a device clock may sit from chain time before a send is refused (the chain-clock check in
 *  `pool/index.ts`), and how far a head's timestamp may run ahead of the device clock before it is not
 *  trusted (the front's pinned quorum reads). One bound, here, so the two cannot drift apart. */
export const MAX_CLOCK_SKEW_S = 120;

// Time helpers: single source for "now" timestamps.
export const nowMs = (): number => Date.now();
export const nowSec = (): number => Math.floor(Date.now() / 1000); // 5%

/**
 * Canonical BTR brand identity. Single source of truth across front/back/docs.
 * GitHub org is `btr-protocol` (was `btr-supply`, before that `btr-markets`); keep all links in sync.
 */
export const BRAND = Object.freeze({
  name: 'BTR',
  /** Public display name for social accounts (X, Telegram, etc.). */
  socialName: 'BTR Protocol',
  github: 'https://github.com/btr-protocol',
  githubOrg: 'btr-protocol',
  domain: 'btr.markets',
  /** X/Twitter handle: PascalCase, no underscore (`@BTRProtocol`). */
  twitter: 'BTRProtocol',
  /** Telegram handle: same branding as X (`t.me/BTRProtocol`). */
  telegram: 'BTRProtocol',
  supportEmail: 'tech@btr.markets',
});
