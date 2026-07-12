/**
 * Chapel testnet USD targets + live mark fetch (data.btr.markets → NXR OHLC).
 * SSoT for pool seed, bot floors, and hourly top-up sizing.
 */
import { parseUnits } from '../utils/format.js';

export const CHAPEL_STABLE_SYMS = ['USDC', 'USDT', 'USD1', 'USDE', 'FDUSD'] as const;
export const CHAPEL_VOL_POOL_SYMS = ['USDC', 'USDT', 'BTCB', 'ETH', 'WBNB', 'CAKE', 'XAUT'] as const;
export const CHAPEL_BOT_SYMS = [
  ...CHAPEL_STABLE_SYMS,
  'BTCB',
  'ETH',
  'WBNB',
  'CAKE',
  'XAUT',
] as const;

export type ChapelStableSym = (typeof CHAPEL_STABLE_SYMS)[number];
export type ChapelBotSym = (typeof CHAPEL_BOT_SYMS)[number];

/** USD notion targets (human). Stables: same $/asset everywhere. */
export const CHAPEL_USD_TARGETS = {
  /** Per-asset pool reserve target ($). */
  poolPerAssetUsd: 50_000,
  /** Bot operating floor per asset ($) — identical for every stable. */
  botFloorUsd: 25_000,
  /** One-shot bot seed per asset ($). */
  botSeedUsd: 50_000,
  /** Mock Venus yield APR (keeper setRate). */
  yieldApr: 0.05,
  gasTbnb: {
    flow: 0.05,
    arb: 0.05,
    oracle: 0.1,
  },
} as const;

/** NXR symbols aligned with keepers/oracle.chapel.toml. */
export const CHAPEL_NXR_FEED: Record<
  string,
  string | { primary: string; via?: string }
> = {
  USDC: { primary: 'USDC-USDT', via: 'USDT-USDC' },
  USDT: 'USDT-USDC',
  USD1: 'USD1-USDC',
  USDE: 'USDE-USDC',
  FDUSD: 'FDUSD-USDC',
  BTCB: 'BTC-USDC',
  ETH: 'ETH-USDC',
  WBNB: 'BNB-USDC',
  CAKE: { primary: 'CAKE-USDT', via: 'USDT-USDC' },
  XAUT: 'XAUT-USDC',
};

/** Offline marks (USDC per token) when data edge unreachable. */
export const CHAPEL_REF_MARKS_USD: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  USD1: 1,
  USDE: 1,
  FDUSD: 1,
  BTCB: 64_000,
  ETH: 1_800,
  WBNB: 580,
  CAKE: 1.4,
  XAUT: 4_100,
};

const DECIMALS = 18;
const YEAR_SEC = 365.25 * 24 * 3600;

export function isChapelStable(sym: string): boolean {
  return (CHAPEL_STABLE_SYMS as readonly string[]).includes(sym.toUpperCase());
}

export function refMarksUsd(): Record<string, number> {
  return { ...CHAPEL_REF_MARKS_USD };
}

/** Convert USD notional → token wei (18 dec mocks). Stables use $1. */
export function tokenWeiFromUsd(usd: number, sym: string, marks?: Record<string, number>): bigint {
  if (!(usd > 0)) return 0n;
  const key = sym.toUpperCase();
  const m = marks ?? CHAPEL_REF_MARKS_USD;
  const mark = isChapelStable(key) ? 1 : (m[key] ?? CHAPEL_REF_MARKS_USD[key] ?? 1);
  if (!(mark > 0)) return 0n;
  const tokens = usd / mark;
  return parseUnits(tokens.toFixed(8), DECIMALS);
}

export function targetWeiForPool(sym: string, marks: Record<string, number>): bigint {
  return tokenWeiFromUsd(CHAPEL_USD_TARGETS.poolPerAssetUsd, sym, marks);
}

export function targetWeiForBotFloor(sym: string, marks: Record<string, number>): bigint {
  return tokenWeiFromUsd(CHAPEL_USD_TARGETS.botFloorUsd, sym, marks);
}

export function targetWeiForBotSeed(sym: string, marks: Record<string, number>): bigint {
  return tokenWeiFromUsd(CHAPEL_USD_TARGETS.botSeedUsd, sym, marks);
}

interface OhlcBar {
  ts: number;
  close: number;
  tick_count?: number;
}

async function fetchOhlcClose(
  mdBase: string,
  nxrSym: string,
  tfSec = 30,
): Promise<number | null> {
  const now = Date.now();
  const from = now - 3_600_000;
  const url = `${mdBase.replace(/\/$/, '')}/ohlc/${nxrSym}?tf=${tfSec}&from=${from}&to=${now}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const bars = (await res.json()) as OhlcBar[];
  if (!Array.isArray(bars) || !bars.length) return null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if ((b.tick_count ?? 1) > 0 && Number.isFinite(b.close) && b.close > 0) return b.close;
  }
  const last = bars[bars.length - 1]!;
  return Number.isFinite(last.close) && last.close > 0 ? last.close : null;
}

async function resolveNxrMark(mdBase: string, spec: string | { primary: string; via?: string }): Promise<number | null> {
  if (typeof spec === 'string') return fetchOhlcClose(mdBase, spec);
  const primary = await fetchOhlcClose(mdBase, spec.primary);
  if (!spec.via) return primary;
  const via = await fetchOhlcClose(mdBase, spec.via);
  if (primary == null || via == null) return null;
  return primary * via;
}

/**
 * Live USDC-denominated marks from data.btr.markets (fallback → CHAPEL_REF_MARKS_USD).
 */
export async function fetchChapelMarksUsd(
  mdBase = process.env.CHAPEL_MD_BASE ?? process.env.VITE_NXR_API ?? 'https://data.btr.markets/md',
): Promise<Record<string, number>> {
  const out = refMarksUsd();
  const syms = [...new Set([...CHAPEL_BOT_SYMS, ...CHAPEL_VOL_POOL_SYMS])];
  await Promise.all(
    syms.map(async (sym) => {
      const spec = CHAPEL_NXR_FEED[sym];
      if (!spec) return;
      try {
        const px = await resolveNxrMark(mdBase, spec);
        if (px != null && Number.isFinite(px) && px > 0) {
          out[sym] = isChapelStable(sym) ? 1 : px;
        }
      } catch {
        /* keep ref */
      }
    }),
  );
  return out;
}

/** MockVenus compound rate tick (~APR) for elapsed seconds. */
export function tickMockVenusRate(prev: bigint, dtSec: number, apr = CHAPEL_USD_TARGETS.yieldApr): bigint {
  const mul = BigInt(Math.floor(1e18 * (1 + (apr * dtSec) / YEAR_SEC)));
  return (prev * mul) / 10n ** 18n;
}
