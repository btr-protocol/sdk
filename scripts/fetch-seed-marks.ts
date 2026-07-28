/**
 * Fetch the ONE NX Rates mark snapshot a Sepolia deploy ceremony seeds from.
 *
 *   bun run scripts/fetch-seed-marks.ts        # writes dex/evm/deployments/11155111.seed-marks.json
 *
 * Both halves of the ceremony read this file: SepoliaOracleDeploy seeds every feed from it, and
 * SepoliaPoolDeploy converts seedUsdPerLeg to token units with it (then asserts its mark equals the
 * on-chain feed seed). One fetch, one artifact, no second source that can disagree.
 *
 * Why fresh marks matter beyond the seed size: the first signed keeper push has dt=0, so its
 * deviation band is the bare maxDev floor (50bp stable / 100bp volatile) around the SEED. A seed
 * fetched minutes before broadcast lands the push inside the band by construction; a stale one
 * strands the feed (Sepolia, 2026-07-24: WBTC seeded 65,020 and never recoverable by ladder,
 * because NXR signs market marks, not rungs).
 *
 * Symbol mapping is NOT restated here — it is `nxrSymbol` on SEPOLIA_ORACLE_FEEDS
 * (stables → Pyth `X-USD` USDC≈1 proxy; WETH→ETH-USDC; FX→`X-USD` for /v1/price).
 */

import { join } from 'node:path';
import { SEPOLIA_CHAIN_ID, SEPOLIA_ORACLE_FEEDS } from '../src/venues/sepolia.js';

const DEX = process.env.DEX_DIR || join(import.meta.dir, '../../dex');
const RISK = join(DEX, 'evm/deployments/sepolia-risk-params.json');
const OUT = join(DEX, `evm/deployments/${SEPOLIA_CHAIN_ID}.seed-marks.json`);
const NXR = (process.env.NXR_REST_URL || 'https://api.nxrates.com').replace(/\/$/, '');

/** Plausibility bands, mirroring the deploy scripts' own requires so a bad snapshot fails HERE —
 *  before broadcast — instead of stranding a feed mid-ceremony. Peg band matches the Solidity
 *  [0.98,1.02] clamp; syrupUSDC accrues so it takes the wide stable band. */
const PEG = [0.98, 1.02] as const;
const BANDS: Record<string, readonly [number, number]> = {
  syrupUSDC: [1.0, 1.5], WETH: [500, 20_000], WBTC: [20_000, 500_000], cbBTC: [20_000, 500_000],
  BNB: [100, 5_000], XAUT: [1_500, 10_000], PAXG: [1_500, 10_000], EURC: [0.9, 1.3],
  // FX core (fiat-backed stables). These legs are NOT ~1.0 against the USDC base — their mark is
  // the real fiat rate — so the PEG band below would reject every one of them. Each window is a
  // SCALE guard (catches a 1e3 fat-finger or an inverted pair) around the measured 2026-07-27
  // rate, deliberately wide enough for any plausible FX move: a tight window on a live rate would
  // strand the ceremony, and an absent one silently applies PEG and fails at 0.98.
  // ⚠ INVERSION IS THE DANGEROUS ERROR, not magnitude: NXR serves CAD/BRL/JPY/KRW natively as
  // USD/X (1.41, 5.10, 163.5, 1469.9). The nxrSymbol for these legs is the X-USD cross, so a
  // mis-set symbol yields the reciprocal — and only these bands catch it.
  QCAD: [0.5, 1.0],        // CAD/USD 0.7099
  AUDF: [0.4, 1.0],        // AUD/USD 0.7002
  BRLA: [0.1, 0.4],        // BRL/USD 0.1963
  JPYC: [0.003, 0.012],    // JPY/USD 0.0061197
  KRW1: [0.0003, 0.0015],  // KRW/USD 0.00068070
};
/** The ceremony runbook's freshness bound: seeds must come from live NXR shortly pre-broadcast. */
const MAX_AGE_MS = 5 * 60_000;

const seedUsdPerLeg: number = (await Bun.file(RISK).json()).seedUsdPerLeg;
if (!Number.isFinite(seedUsdPerLeg) || seedUsdPerLeg <= 0) {
  console.error(`${RISK}: seedUsdPerLeg absent or non-positive — nothing to size a seed from`);
  process.exit(1);
}

const errs: string[] = [];
const marks: Record<string, { ticker: string; mid: number; mark1e18: string }> = {};
const fetchedAt = new Date();

for (const f of SEPOLIA_ORACLE_FEEDS) {
  // USDC/USDC is an identity feed by construction — never fetched, never off 1.
  if (f.symbol === 'USDC') {
    marks[f.symbol] = { ticker: f.nxrSymbol, mid: 1, mark1e18: (10n ** 18n).toString() };
    continue;
  }
  let mid: number | null = null;
  try {
    // /v1/price/{ticker} is the only endpoint serving a live px: {ticker,mid,bid,ask,ci,confidence}.
    // /v1/tickers/detail is a CATALOGUE and carries no price at all.
    const r = await fetch(`${NXR}/v1/price/${encodeURIComponent(f.nxrSymbol)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { mid?: number };
      if (typeof j.mid === 'number' && j.mid > 0) mid = j.mid;
    }
  } catch (e) {
    errs.push(`${f.symbol} (${f.nxrSymbol}): ${(e as Error).message}`);
    continue;
  }
  if (mid == null) {
    errs.push(`${f.symbol} (${f.nxrSymbol}): no live mid from NXR`);
    continue;
  }
  const [lo, hi] = BANDS[f.symbol] ?? PEG;
  if (mid < lo || mid > hi) {
    errs.push(`${f.symbol}: mid ${mid} outside plausible [${lo}, ${hi}] — fat-finger or wrong pair`);
    continue;
  }
  marks[f.symbol] = {
    ticker: f.nxrSymbol,
    mid,
    // 1e18 fixed point, the unit both deploy scripts consume (M.encodeB64(x, 18)).
    mark1e18: BigInt(Math.round(mid * 1e18)).toString(),
  };
}

// Refuse to write a partial snapshot: a missing mark would silently fall back to a default
// somewhere downstream, which is the failure mode this whole artifact exists to remove.
if (errs.length) {
  console.error(`NXR seed marks NOT written (${errs.length} problem(s)):`);
  for (const e of errs) console.error(`  ${e}`);
  process.exit(1);
}

await Bun.write(
  OUT,
  `${JSON.stringify(
    {
      chainId: SEPOLIA_CHAIN_ID,
      source: `${NXR}/v1/price`,
      fetchedAt: fetchedAt.toISOString(),
      maxAgeMs: MAX_AGE_MS,
      seedUsdPerLeg,
      marks,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `${OUT}: ${Object.keys(marks).length} marks @ ${fetchedAt.toISOString()} ` +
    `(broadcast within ${MAX_AGE_MS / 60_000} min or re-run)`,
);
