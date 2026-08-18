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
 * which is also what the chain's OracleDeploy `_syms()` pins (Arc: 18, the idx-17 USDC/USD depeg
 * reference is seeded from ORACLE_SEED_USDCUSD_1E18, not from this file). A symbol with no NXR
 * mapping is a hard error, never a silent skip, and the mapping is `src/venues/nxr.ts NXR_MARKS` —
 * chain-free, because an asset's mark source does not change when it is listed on a second chain.
 * This script therefore needs no per-chain feed table and cannot exit 1 on a chain simply for not
 * being Sepolia, which is what it did before.
 *
 * Auth: NXR serves /v1/price anonymously; if NXR_API_KEY is exported it is sent as the API key
 * header. Never inline a key here.
 *
 * A mark is accepted only when the EXPLICIT pair answers 200, is inside its declared scale band, and
 * is fresh. All three are load-bearing. NXR's ticker parser is delimiter-less, so a wrong-shaped
 * symbol does not 404 — it resolves to something else and returns a plausible mid (`CVX-USD` is
 * Chevron at ~197, not Convex at ~3). And `status` is served per-mark: `USDG-USD` answered 200 with
 * a peg-plausible 0.99986 and `status: "dead", age_ms: 469991` on 2026-08-14. Neither the band nor
 * the peg clamp can see either failure; only the pair being declared and the age being checked can.
 *
 * Why fresh marks matter beyond the seed size: the first signed keeper push has dt=0, so its
 * deviation band is the bare maxDev floor (50bp stable / 100bp volatile) around the SEED. A seed
 * fetched minutes before broadcast lands the push inside the band by construction; a stale one
 * strands the feed (Sepolia, 2026-07-24: WBTC seeded 65,020 and never recoverable by ladder,
 * because NXR signs market marks, not rungs).
 */

import { join } from 'node:path';
import {
  type MarkBasis,
  closedUntil,
  nxrMark,
  nxrPair,
  sessionOpenLabel,
} from '../src/venues/nxr.js';
import { SEPOLIA_CHAIN_ID } from '../src/venues/sepolia.js';

/** Deploy targets. `chainId` is pinned because it is not a copy of anything: it names the output
 *  file and is checked against the risk JSON, so `arc` can never write Sepolia's snapshot. The seed
 *  SIZE is deliberately NOT pinned here — it is read from the risk JSON below. A second hand-written
 *  copy of it guarded nothing this ceremony does not already guard (`ArcPoolDeploy._loadCfg` asserts
 *  the snapshot against the risk JSON, and `checkSeedBudget()` refuses a roster it cannot fund),
 *  while a resize left the copy stale and exited 1 on the very file it is meant to read. */
const CHAINS = {
  sepolia: { chainId: SEPOLIA_CHAIN_ID, risk: 'sepolia-risk-params.json', basis: 'USD' },
  arc: { chainId: 5_042_002, risk: 'arc-risk-params.json', basis: 'USDC' },
} as const satisfies Record<string, { chainId: number; risk: string; basis: MarkBasis }>;

const chainArg = (process.argv[2] || process.env.CHAIN || 'sepolia').toLowerCase();
const CHAIN = CHAINS[chainArg as keyof typeof CHAINS];
if (!CHAIN) {
  console.error(`unknown chain '${chainArg}' — expected one of ${Object.keys(CHAINS).join(', ')}`);
  process.exit(1);
}

const DEX = process.env.DEX_DIR || join(import.meta.dir, '../../dex');
// The Solidity halves (ArcPoolDeploy._riskPath/_marksPath) resolve RISK_PARAMS/SEED_MARKS against
// the forge working directory dex/evm. Mirror them so one env override names the same file for the
// fetcher and the deploy scripts, instead of two different defaults.
const EVM = join(DEX, 'evm');
const RISK = process.env.RISK_PARAMS
  ? join(EVM, process.env.RISK_PARAMS)
  : join(EVM, `deployments/${CHAIN.risk}`);
const OUT = process.env.SEED_MARKS
  ? join(EVM, process.env.SEED_MARKS)
  : join(EVM, `deployments/${CHAIN.chainId}.seed-marks.json`);
const NXR = (process.env.NXR_REST_URL || 'https://api.nxrates.com').replace(/\/$/, '');

/** Peg band for an asset that declares no scale band of its own; matches the Solidity [0.98,1.02]
 *  clamp. Per-asset bands live on `NXR_MARKS[...].band` — they mirror the deploy scripts' own
 *  requires so a bad snapshot fails HERE, before broadcast, rather than stranding a feed. */
const PEG = [0.98, 1.02] as const;
/** The ceremony runbook's freshness bound: seeds must come from live NXR shortly pre-broadcast.
 *  ENFORCED against the per-mark `age_ms`/`status` NXR serves, not merely stamped on the output —
 *  a peg-plausible mid from a dead ticker is exactly what the band cannot see. */
const MAX_AGE_MS = 5 * 60_000;

const risk: {
  chainId: number;
  seedUsdPerLeg: number;
  unmintableSeedUsdPerLeg?: number;
  symbols: string[];
} = await Bun.file(RISK).json();
const seedUsdPerLeg = risk.seedUsdPerLeg;
if (!Number.isFinite(seedUsdPerLeg) || seedUsdPerLeg <= 0) {
  console.error(`${RISK}: seedUsdPerLeg absent or non-positive — nothing to size a seed from`);
  process.exit(1);
}
// The native (unmintable) legs read a SECOND depth target from the same SoT. OPTIONAL: Sepolia's
// USDC is a TestnetERC20 mock (the bridged concept does not exist there), so sepolia-risk-params.json
// carries no key and the snapshot must not either. Where the params file HAS the key (Arc) the
// snapshot must carry it too, or ArcPoolDeploy._assertSeedMarksCfg sees a mismatch on a key this file
// never wrote. A present-but-non-positive key is a hard error, never a silently zero-sized class.
const unmintableSeedUsdPerLeg = risk.unmintableSeedUsdPerLeg;
if (unmintableSeedUsdPerLeg !== undefined) {
  if (!Number.isFinite(unmintableSeedUsdPerLeg) || unmintableSeedUsdPerLeg <= 0) {
    console.error(
      `${RISK}: unmintableSeedUsdPerLeg present but non-positive — nothing to size the native legs from`,
    );
    process.exit(1);
  }
}
// The risk JSON is the SoT for the roster and the seed size; the chain arg only selects WHICH file.
// A mismatch means the operator is seeding a different ceremony than they think.
if (risk.chainId !== CHAIN.chainId) {
  console.error(`${RISK}: chainId ${risk.chainId} != ${CHAIN.chainId} (${chainArg})`);
  process.exit(1);
}

// Roster = the chain's own listed assets, resolved through the single symbol→NXR mapping table, on
// the BASIS this chain's pools consume a mark in. `nxrPair` returns null rather than falling back
// to the USD row: on a quoteUnit-0 chain that fallback is a mark off by the whole USD/USDC basis
// with nothing left on-chain to correct it, which no band or peg clamp can see.
const roster = (risk.symbols ?? []).map((symbol) => {
  // The BASE is exempt from the basis, and not as an exception to it: it carries no market feed
  // (there is no USDC/USDC identity — Pricing._readBasePriceOrHalt discards the base read for
  // quoting), only the signed depeg reference, which is deliberately USD-quoted because a
  // depeg is only observable against USD. Its mark below is the identity 1 and never fetched.
  const basis = symbol === risk.symbols[0] ? 'USD' : CHAIN.basis;
  const m = nxrPair(symbol, basis);
  const full = nxrMark(symbol);
  if (!m || !full) {
    console.error(
      `${RISK}: symbol ${symbol} has no ${basis}-basis NXR mark source — add it to` +
        ` src/venues/nxr.ts NXR_MARKS${basis === 'USDC' ? ' (the `usdc` row)' : ''}.` +
        ` Probe the EXPLICIT pair first: a delimiter-less near-miss answers 200 with another` +
        ` asset's mid, so "it returns a price" is not evidence the pair exists. Confirm it also` +
        ` answers flags 64 — a flags-128 compose-on-read cross has no snapshot and cannot be signed.`,
    );
    process.exit(1);
  }
  // nxrQuote/quoteVia are cleared before the basis pair is applied: a spread does not REMOVE a
  // key the basis row omits, so `CAD-USDC` would silently inherit the USD row's
  // `nxrQuote: 'USD-CAD'` and be seeded upside down.
  return { symbol, ...full, nxrQuote: undefined, quoteVia: undefined, ...m };
});
if (!roster.length) {
  console.error(`${RISK}: empty symbols[] — nothing to seed`);
  process.exit(1);
}

const errs: string[] = [];
const marks: Record<string, { ticker: string; mid: number; mark1e18: string }> = {};
const fetchedAt = new Date();
const KEY = process.env.NXR_API_KEY?.trim();

/** One live mid from NXR, or a reason it is not seedable. `shut` exempts a scheduled FX halt from
 *  the age bound and from that alone: the mark is frozen because the market is, the keeper's first
 *  push carries the same frozen mark, and failing here would block the ceremony every weekend.
 *  `dead` is never exempt — it is NXR's own verdict that nothing is feeding the ticker. */
async function fetchMid(pair: string, shut: boolean): Promise<{ mid: number } | { err: string }> {
  let j: { mid?: number; age_ms?: number; status?: string };
  try {
    const r = await fetch(`${NXR}/v1/price/${encodeURIComponent(pair)}`, {
      headers: KEY
        ? { Accept: 'application/json', 'X-NXR-Key': KEY }
        : { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok)
      return { err: `${pair}: NXR ${r.status} — pair absent, do NOT substitute a variant` };
    j = (await r.json()) as typeof j;
  } catch (e) {
    return { err: `${pair}: ${(e as Error).message}` };
  }
  // Freshness is per-mark and NXR reports it, but the band cannot see it: a dead ticker still
  // returns a peg-plausible mid. USDG-USD served 0.99986 with `status: "dead", age_ms: 469991` on
  // 2026-08-14. Seeding from that puts the first signed push a whole staleness window away from the
  // seed it has to land beside, and dt=0 gives it only the bare maxDev floor to do it.
  const age = j.age_ms;
  if (j.status === 'dead')
    return { err: `${pair}: NXR reports the ticker dead at age ${age ?? '?'}ms — not seedable` };
  if (typeof age === 'number' && age > MAX_AGE_MS && !shut)
    return {
      err:
        `${pair}: mark is ${Math.round(age / 1000)}s old (status ${j.status ?? '?'}),` +
        ` bound is ${MAX_AGE_MS / 1000}s and the market is open`,
    };
  if (typeof j.mid !== 'number' || !(j.mid > 0)) return { err: `${pair}: no live mid from NXR` };
  return { mid: j.mid };
}

for (const f of roster) {
  // USDC/USDC is an identity feed by construction — never fetched, never off 1.
  if (f.symbol === 'USDC') {
    marks[f.symbol] = { ticker: f.nxrSymbol, mid: 1, mark1e18: (10n ** 18n).toString() };
    continue;
  }
  // /v1/price/{ticker} is the only endpoint serving a live px:
  // {ticker,mid,bid,ask,ci,confidence,flags,age_ms,status}. /v1/tickers/detail is a CATALOGUE and
  // carries no price at all. `nxrQuote` names the served ticker when NXR only carries the
  // reciprocal of the pair the feed is denominated in; the mid is reciprocated back. `quoteVia`
  // names a BRIDGE leg instead, and the mark is the product — the two are mutually exclusive.
  const quoted = f.nxrQuote ?? f.nxrSymbol;
  const shut = closedUntil(f.symbol) !== null;
  if (shut)
    console.warn(
      `  ${f.symbol}: market closed until ${sessionOpenLabel(closedUntil(f.symbol)!)}, seeding the frozen mark`,
    );

  const got = await fetchMid(quoted, shut);
  if ('err' in got) {
    errs.push(`${f.symbol} (${got.err})`);
    continue;
  }
  let mid = f.nxrQuote ? 1 / got.mid : got.mid;
  if (f.quoteVia) {
    const bridge = await fetchMid(f.quoteVia, shut);
    if ('err' in bridge) {
      errs.push(`${f.symbol} bridge (${bridge.err})`);
      continue;
    }
    mid *= bridge.mid;
  }

  const [lo, hi] = f.band ?? PEG;
  if (mid < lo || mid > hi) {
    errs.push(
      `${f.symbol}: mid ${mid} outside plausible [${lo}, ${hi}] — fat-finger or wrong pair`,
    );
    continue;
  }
  marks[f.symbol] = {
    // The pair the mark IS, so the record states its own denomination: a bridged mark records the
    // composition it came from, not just its first leg.
    ticker: f.quoteVia ? `${f.nxrSymbol} x ${f.quoteVia}` : f.nxrSymbol,
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

const snapshot = {
  chainId: CHAIN.chainId,
  source: `${NXR}/v1/price`,
  fetchedAt: fetchedAt.toISOString(),
  maxAgeMs: MAX_AGE_MS,
  seedUsdPerLeg,
  ...(unmintableSeedUsdPerLeg === undefined ? {} : { unmintableSeedUsdPerLeg }),
  marks,
};
await Bun.write(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(
  `${OUT}: ${chainArg} · ${Object.keys(marks).length} marks @ ${fetchedAt.toISOString()} ` +
    `(broadcast within ${MAX_AGE_MS / 60_000} min or re-run)`,
);
