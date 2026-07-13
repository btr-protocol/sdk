/**
 * Chapel testnet USD targets + live marks (data.btr.markets → NXR OHLC).
 * SSoT for pool seed, bot floors, hourly top-up sizing.
 */
import { parseUnits } from '../utils/format.js';

export const CHAPEL_STABLE_SYMS = ['USDC', 'USDT', 'USD1', 'USDE', 'FDUSD'] as const;
export const CHAPEL_VOL_POOL_SYMS = ['USDC', 'USDT', 'BTCB', 'ETH', 'WBNB', 'CAKE', 'XAUT'] as const;
/** Stables ∪ volatiles (bot inventory + mark universe). */
export const CHAPEL_BOT_SYMS = [
  ...CHAPEL_STABLE_SYMS,
  'BTCB',
  'ETH',
  'WBNB',
  'CAKE',
  'XAUT',
] as const;

export const CHAPEL_USD_TARGETS = {
  poolPerAssetUsd: 50_000,
  botFloorUsd: 25_000,
  botSeedUsd: 50_000,
  yieldApr: 0.05,
  /** Cap yield dt so a late CronJob cannot jump weeks of APR in one tick. */
  yieldDtCapSec: 6 * 3600,
  gasTbnb: { flow: 0.05, arb: 0.05, oracle: 0.1 },
} as const;

/** NXR symbols (oracle.chapel.toml). Stables omitted: priced as $1. */
export const CHAPEL_NXR_FEED: Record<string, string | { primary: string; via: string }> = {
  BTCB: 'BTC-USDC',
  ETH: 'ETH-USDC',
  WBNB: 'BNB-USDC',
  CAKE: { primary: 'CAKE-USDT', via: 'USDT-USDC' },
  XAUT: 'XAUT-USDC',
};

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

const DEC = 18;
const YEAR = 365.25 * 24 * 3600;
/** Refuse marks outside [ref/20, ref×20] (broken OHLC / unit error). */
const MARK_BAND = 20;

export function isChapelStable(sym: string): boolean {
  return (CHAPEL_STABLE_SYMS as readonly string[]).includes(sym.toUpperCase());
}

export function refMarksUsd(): Record<string, number> {
  return { ...CHAPEL_REF_MARKS_USD };
}

function saneMark(sym: string, raw: number): number {
  const ref = CHAPEL_REF_MARKS_USD[sym] ?? 1;
  if (!(raw > 0) || !Number.isFinite(raw)) return ref;
  if (raw < ref / MARK_BAND || raw > ref * MARK_BAND) return ref;
  return raw;
}

/** USD → token wei (18-dec mocks). Stables always $1. */
export function tokenWeiFromUsd(usd: number, sym: string, marks?: Record<string, number>): bigint {
  if (!(usd > 0)) return 0n;
  const key = sym.toUpperCase();
  if (isChapelStable(key)) return parseUnits(usd.toFixed(8), DEC);
  const mark = saneMark(key, marks?.[key] ?? CHAPEL_REF_MARKS_USD[key] ?? 1);
  if (!(mark > 0)) return 0n;
  return parseUnits((usd / mark).toFixed(8), DEC);
}

export const targetWeiForPool = (s: string, m: Record<string, number>) =>
  tokenWeiFromUsd(CHAPEL_USD_TARGETS.poolPerAssetUsd, s, m);
export const targetWeiForBotFloor = (s: string, m: Record<string, number>) =>
  tokenWeiFromUsd(CHAPEL_USD_TARGETS.botFloorUsd, s, m);
export const targetWeiForBotSeed = (s: string, m: Record<string, number>) =>
  tokenWeiFromUsd(CHAPEL_USD_TARGETS.botSeedUsd, s, m);

interface OhlcBar {
  close: number;
  tick_count?: number;
}

async function ohlcClose(mdBase: string, nxrSym: string): Promise<number | null> {
  const now = Date.now();
  const url = `${mdBase.replace(/\/$/, '')}/ohlc/${nxrSym}?tf=30&from=${now - 3_600_000}&to=${now}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const bars = (await res.json()) as OhlcBar[];
  if (!Array.isArray(bars)) return null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if ((b.tick_count ?? 1) > 0 && Number.isFinite(b.close) && b.close > 0) return b.close;
  }
  return null;
}

async function resolveMark(
  mdBase: string,
  spec: string | { primary: string; via: string },
): Promise<number | null> {
  if (typeof spec === 'string') return ohlcClose(mdBase, spec);
  const [a, b] = await Promise.all([ohlcClose(mdBase, spec.primary), ohlcClose(mdBase, spec.via)]);
  return a != null && b != null ? a * b : null;
}

/** Live USDC marks; stables stay $1; volatiles fall back to ref if OHLC missing/insane. */
export async function fetchChapelMarksUsd(
  mdBase = process.env.CHAPEL_MD_BASE ?? 'https://data.btr.markets/md',
): Promise<Record<string, number>> {
  const out = refMarksUsd();
  await Promise.all(
    Object.entries(CHAPEL_NXR_FEED).map(async ([sym, spec]) => {
      try {
        const px = await resolveMark(mdBase, spec);
        if (px != null) out[sym] = saneMark(sym, px);
      } catch {
        /* keep ref */
      }
    }),
  );
  return out;
}

export function tickMockVenusRate(
  prev: bigint,
  dtSec: number,
  apr = CHAPEL_USD_TARGETS.yieldApr,
): bigint {
  const dt = Math.min(Math.max(1, dtSec), CHAPEL_USD_TARGETS.yieldDtCapSec);
  const mul = BigInt(Math.floor(1e18 * (1 + (apr * dt) / YEAR)));
  return (prev * mul) / 10n ** 18n;
}
