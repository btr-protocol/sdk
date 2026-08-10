/**
 * Fetch the ONE NX Rates mark snapshot a deploy ceremony seeds from.
 *
 *   bun run scripts/fetch-seed-marks.ts            # sepolia (default) → 11155111.seed-marks.json
 *   bun run scripts/fetch-seed-marks.ts arc        # arc testnet      → 5042002.seed-marks.json
 *   CHAIN=arc bun run scripts/fetch-seed-marks.ts  # same, via env
 *
 * Both halves of the ceremony read this file: <Chain>OracleDeploy seeds every feed from it, and
 * <Chain>PoolDeploy converts seedUsdPerLeg to token units with it (then asserts its mark equals the
 * on-chain feed seed). One fetch, one artifact, no second source that can disagree.
 *
 * The ROSTER is never restated here: it is the `symbols` array of that chain's risk-params JSON,
 * which is also what the chain's OracleDeploy `_syms()` pins (Arc: 14 = 8 peg stables + 6 FX; the
 * idx-14 USDC/USD depeg reference is seeded from ORACLE_SEED_USDCUSD_1E18, not from this file).
 * A symbol with no NXR mapping in the feed table is a hard error, never a silent skip. The mapping
 * itself is `nxrSymbol`/`nxrQuote` on SEPOLIA_ORACLE_FEEDS, the one table that carries it (stables →
 * Pyth `X-USD` USDC≈1 proxy; WETH→ETH-USDC; FX→`X-USD` for /v1/price).
 *
 * Auth: NXR serves /v1/price anonymously; if NXR_API_KEY is exported it is sent as the API key
 * header. Never inline a key here.
 *
 * Why fresh marks matter beyond the seed size: the first signed keeper push has dt=0, so its
 * deviation band is the bare maxDev floor (50bp stable / 100bp volatile) around the SEED. A seed
 * fetched minutes before broadcast lands the push inside the band by construction; a stale one
 * strands the feed (Sepolia, 2026-07-24: WBTC seeded 65,020 and never recoverable by ladder,
 * because NXR signs market marks, not rungs).
 */

import { join } from 'node:path';
import { SEPOLIA_CHAIN_ID, SEPOLIA_ORACLE_FEEDS } from '../src/venues/sepolia.js';

/** Deploy targets. `seedUsdPerLeg` is the value the ceremony was SIZED for; the risk JSON is the
 *  source of truth and is asserted against it, so an edited JSON fails here, not at broadcast. */
const CHAINS = {
  sepolia: { chainId: SEPOLIA_CHAIN_ID, risk: 'sepolia-risk-params.json', seedUsdPerLeg: 50_000 },
  arc: { chainId: 5_042_002, risk: 'arc-risk-params.json', seedUsdPerLeg: 4_000 },
} as const;

const chainArg = (process.argv[2] || process.env.CHAIN || 'sepolia').toLowerCase();
const CHAIN = CHAINS[chainArg as keyof typeof CHAINS];
if (!CHAIN) {
  console.error(`unknown chain '${chainArg}' — expected one of ${Object.keys(CHAINS).join(', ')}`);
  process.exit(1);
}

const DEX = process.env.DEX_DIR || join(import.meta.dir, '../../dex');
const RISK = join(DEX, `evm/deployments/${CHAIN.risk}`);
const OUT = join(DEX, `evm/deployments/${CHAIN.chainId}.seed-marks.json`);
const NXR = (process.env.NXR_REST_URL || 'https://api.nxrates.com').replace(/\/$/, '');

/** Plausibility bands, mirroring the deploy scripts' own requires so a bad snapshot fails HERE —
 *  before broadcast — instead of stranding a feed mid-ceremony. Peg band matches the Solidity
 *  [0.98,1.02] clamp. */
const PEG = [0.98, 1.02] as const;
const BANDS: Record<string, readonly [number, number]> = {
  WETH: [500, 20_000], WBTC: [20_000, 500_000], cbBTC: [20_000, 500_000],
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

const risk: { chainId: number; seedUsdPerLeg: number; symbols: string[] } =
  await Bun.file(RISK).json();
const seedUsdPerLeg = risk.seedUsdPerLeg;
if (!Number.isFinite(seedUsdPerLeg) || seedUsdPerLeg <= 0) {
  console.error(`${RISK}: seedUsdPerLeg absent or non-positive — nothing to size a seed from`);
  process.exit(1);
}
// The risk JSON is the SoT for both the chain and the seed size; the table above is the pinned
// expectation. A mismatch means the operator is seeding a different ceremony than they think.
if (risk.chainId !== CHAIN.chainId) {
  console.error(`${RISK}: chainId ${risk.chainId} != ${CHAIN.chainId} (${chainArg})`);
  process.exit(1);
}
if (seedUsdPerLeg !== CHAIN.seedUsdPerLeg) {
  console.error(
    `${RISK}: seedUsdPerLeg ${seedUsdPerLeg} != pinned ${CHAIN.seedUsdPerLeg} for ${chainArg} — update the pin deliberately if the ceremony was resized`,
  );
  process.exit(1);
}

// Roster = the chain's own listed assets, resolved through the single symbol→NXR mapping table.
const roster = (risk.symbols ?? []).map((symbol) => {
  const f = SEPOLIA_ORACLE_FEEDS.find((x) => x.symbol === symbol);
  if (!f) {
    console.error(`${RISK}: symbol ${symbol} has no NXR mapping in the oracle feed table`);
    process.exit(1);
  }
  return f;
});
if (!roster.length) {
  console.error(`${RISK}: empty symbols[] — nothing to seed`);
  process.exit(1);
}

const errs: string[] = [];
const marks: Record<string, { ticker: string; mid: number; mark1e18: string }> = {};
const fetchedAt = new Date();
const KEY = process.env.NXR_API_KEY?.trim();

for (const f of roster) {
  // USDC/USDC is an identity feed by construction — never fetched, never off 1.
  if (f.symbol === 'USDC') {
    marks[f.symbol] = { ticker: f.nxrSymbol, mid: 1, mark1e18: (10n ** 18n).toString() };
    continue;
  }
  let mid: number | null = null;
  try {
    // /v1/price/{ticker} is the only endpoint serving a live px: {ticker,mid,bid,ask,ci,confidence}.
    // /v1/tickers/detail is a CATALOGUE and carries no price at all.
    // NXR serves the fiat crosses USD-base ONLY: /v1/price/CAD-USD is 404 while
    // USD-CAD is 200. `nxrQuote` names that served ticker; reciprocate it back
    // to the X-USD cross the feed is denominated in.
    const quoted = f.nxrQuote ?? f.nxrSymbol;
    const r = await fetch(`${NXR}/v1/price/${encodeURIComponent(quoted)}`, {
      headers: KEY ? { Accept: 'application/json', 'X-NXR-Key': KEY } : { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { mid?: number };
      if (typeof j.mid === 'number' && j.mid > 0) mid = f.nxrQuote ? 1 / j.mid : j.mid;
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
      chainId: CHAIN.chainId,
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
  `${OUT}: ${chainArg} · ${Object.keys(marks).length} marks @ ${fetchedAt.toISOString()} ` +
    `(broadcast within ${MAX_AGE_MS / 60_000} min or re-run)`,
);
