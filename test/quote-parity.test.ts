/**
 * SDK ↔ chain quote parity, pinned to one block.
 *
 * `quoteExactIn` is the float mirror of `Pricing.sol`, and every band, ladder and depth overlay
 * the UI draws is read off it. Nothing asserted that mirror against the deployed bytecode: the
 * fixture suite (`src/amm/aimm.test.ts`) checks the SDK against itself, and `solidity_parity.rs`
 * checks Rust against Solidity. This closes the gap that let a `reserve * 0.999` fudge advertise
 * fills the chain refuses outright.
 *
 * Requires ORACLE_RPC_URL (`source ~/Work/btr/keepers/.env.sepolia`); skipped without it.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { EXTERNAL_ORACLE_ABI } from '../src/abis/ExternalOracle';
import {
  type AimmProfile,
  type PoolState,
  buildLeg,
  depthCurve,
  quoteExactIn,
} from '../src/amm/aimm';
import { decodeFn, encodeFn } from '../src/eth/abi';
import { createHttpProvider } from '../src/eth/client';
import type { Address, Eip1193Provider, Hex } from '../src/eth/types';
import { getAsset, getSwapQuote, readCurve, readRiskConfig } from '../src/pool/index';
import { decodeB64 } from '../src/utils/encoding';
import {
  SEPOLIA_BTR,
  SEPOLIA_ORACLE_FEEDS,
  SEPOLIA_TOKENS,
  sepoliaFeedByName,
} from '../src/venues/sepolia';

const RPC = process.env.ORACLE_RPC_URL ?? '';
const BASE = 'USDC';
const STALE_GRACE_CAP_S = 30; // Pricing._readOracleStale

/** DEN-01: NXR signs `<X>-USD` under an on-chain `<X>-USDC` name ⇒ Pricing._denominate divides. */
const USD_QUOTED = new Set(
  SEPOLIA_ORACLE_FEEDS.filter(
    (f) => f.symbol !== BASE && f.name.endsWith(`-${BASE}`) && !f.nxrSymbol.endsWith(`-${BASE}`),
  ).map((f) => f.symbol),
);

/** Rewrites the block tag of every eth_call / eth_getStorageAt so one run sees one state. */
function pinned(p: Eip1193Provider, block: Hex): Eip1193Provider {
  return {
    request: (args: { method: string; params?: unknown[] }) => {
      if (args.method === 'eth_call' || args.method === 'eth_getStorageAt') {
        const params = [...(args.params ?? [])];
        params[params.length - 1] = block;
        return p.request({ ...args, params } as never);
      }
      return p.request(args as never);
    },
  } as Eip1193Provider;
}

interface Built {
  state: PoolState;
  decimals: Record<string, number>;
}

async function feedRow(p: Eip1193Provider, feedId: Hex) {
  const data = (await p.request({
    method: 'eth_call',
    params: [
      {
        to: SEPOLIA_BTR.oracle,
        data: encodeFn({ abi: EXTERNAL_ORACLE_ABI, functionName: 'getFeed', args: [feedId] }),
      },
      'latest',
    ],
  })) as Hex;
  return decodeFn({ abi: EXTERNAL_ORACLE_ABI, functionName: 'getFeed', data }) as Record<
    string,
    bigint | number
  >;
}

/** Rebuild a `PoolState` from chain exactly as the front's `useAllPools` does, at the pinned block. */
async function buildState(
  p: Eip1193Provider,
  pool: Address,
  symbols: readonly string[],
  now: number,
): Promise<Built> {
  const baseUsdFeed = sepoliaFeedByName(`${BASE}-USD`);
  const baseUsdRow = baseUsdFeed ? await feedRow(p, baseUsdFeed.feedId) : null;
  const baseUsd = baseUsdRow
    ? Number(decodeB64(BigInt(baseUsdRow.lastPriceB64 ?? 0n), 18)) / 1e18
    : 0;

  const baseAsset = await getAsset(p, pool, SEPOLIA_TOKENS[BASE]!);
  const baseDec = Number(baseAsset.decimals);
  const baseRes = Number(baseAsset.reserves) / 10 ** baseDec;

  const legs: PoolState['legs'] = {};
  const decimals: Record<string, number> = { [BASE]: baseDec };
  for (const sym of symbols) {
    if (sym === BASE) continue;
    const token = SEPOLIA_TOKENS[sym];
    const feed = SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === sym);
    if (!token || !feed) continue;
    const [asset, risk, row] = await Promise.all([
      getAsset(p, pool, token),
      readRiskConfig(p, pool, token),
      feedRow(p, feed.feedId),
    ]);
    const dec = Number(asset.decimals);
    if (!(Number(asset.liabilities) > 0)) continue;
    const presetId = Number(asset.presetId);
    // A listed leg always carries a preset (`PoolAdmin.validatePresetAssign`) and there is no
    // curve-less pricing law, so a missing curve is a broken read, not a quoting mode: skip the
    // symbol rather than compare against a fallback that does not exist on either side.
    const curve = presetId > 0 ? await readCurve(p, pool, presetId) : null;
    if (!curve) continue;
    let mark = Number(decodeB64(BigInt(row.lastPriceB64 ?? 0n), 18)) / 1e18;
    if (USD_QUOTED.has(sym)) {
      if (!(baseUsd > 0)) continue; // fail closed, as the front does
      mark /= baseUsd;
    }
    if (!(mark > 0)) continue;
    const profile: AimmProfile = {
      vega: Number(asset.vega),
      minFee: Number(asset.minFeePbps),
      minDisp: Number(asset.minDispersion),
      protoShare: 0,
      curve,
    };
    const ttl = Number(row.ttl ?? 0);
    const src = Number(row.sourceTs ?? 0);
    const upd = Number(row.updatedAt ?? 0);
    const obs = src ? Math.min(Math.floor(src / 1000), upd) : upd;
    const age = Math.max(0, now - obs);
    const grace = Math.min(ttl / 2, STALE_GRACE_CAP_S);
    legs[sym] = buildLeg(
      sym,
      mark,
      Number(row.sigma ?? 0),
      Number(asset.reserves) / 10 ** dec,
      Number(asset.liabilities) / 10 ** dec,
      baseRes,
      dec,
      profile,
      risk.kappaCovBps,
      {
        confidence: Number(row.confidence ?? 0),
        staleExcess: obs > 0 && age > grace ? age - grace : 0,
      },
    );
    decimals[sym] = dec;
  }
  return { state: { base: BASE, legs }, decimals };
}

/** Pairs and size ladders. Sizes are fractions of the OUTPUT leg's reserves so every ladder
 *  crosses the reserve boundary; the chain refuses at and past it (Pricing.sol:737). */
const PAIRS: Array<{ pool: 'stable' | 'volatile'; from: string; to: string }> = [
  { pool: 'stable', from: 'USDC', to: 'RLUSD' },
  { pool: 'stable', from: 'RLUSD', to: 'USDC' },
  { pool: 'stable', from: 'RLUSD', to: 'DAI' },
  { pool: 'stable', from: 'DAI', to: 'USDT' },
  { pool: 'stable', from: 'USDC', to: 'USDT' },
];
const FRACTIONS = [0.01, 0.1, 0.5, 0.9, 0.999, 1.05];

type Row = { pair: string; size: number; chain: number; sdk: number; deltaBp: number | null };

describe.skipIf(!RPC)('SDK ↔ chain quote parity (pinned Sepolia block)', () => {
  let block: Hex;
  let built: Record<string, Built>;
  let pools: Record<string, Address>;
  let p: Eip1193Provider;
  const rows: Row[] = [];

  beforeAll(async () => {
    const raw = createHttpProvider(RPC);
    const bn = (await raw.request({ method: 'eth_blockNumber', params: [] })) as Hex;
    block = bn;
    const head = (await raw.request({ method: 'eth_getBlockByNumber', params: [bn, false] })) as {
      timestamp: Hex;
    };
    const now = Number(BigInt(head.timestamp));
    p = pinned(raw, block);
    pools = { stable: SEPOLIA_BTR.stablePool, volatile: SEPOLIA_BTR.volatilePool };
    built = {
      stable: await buildState(
        p,
        pools.stable,
        ['USDC', 'USDT', 'DAI', 'RLUSD', 'USDE', 'USDS'],
        now,
      ),
    };
  }, 180_000);

  test('parity across pairs and sizes, including the reserve boundary', async () => {
    let worstInterior = 0;
    const refusals: string[] = [];
    for (const { pool, from, to } of PAIRS) {
      const b = built[pool];
      if (!b) continue;
      const { state, decimals } = b;
      const outLeg = to === BASE ? null : state.legs[to];
      const ref = outLeg ? outLeg.res : Number(state.legs[from]?.res ?? 0);
      if (!(ref > 0)) continue;
      for (const f of FRACTIONS) {
        // Size in `from` units; the reserve fraction is measured on the OUTPUT token, converted
        // through the mark so the ladder straddles the real clip rather than a nominal one.
        const px = quoteExactIn(state, from, to, 0).midPrice || 1; // out-per-in
        const size = Math.max(1, Math.round((ref * f) / px));
        const wei = BigInt(Math.round(size)) * 10n ** BigInt(decimals[from] ?? 18);
        const cq = await getSwapQuote(
          p,
          pools[pool]!,
          SEPOLIA_TOKENS[from]!,
          SEPOLIA_TOKENS[to]!,
          wei,
        ).catch(() => null);
        const chain = cq ? Number(cq.amountOut) / 10 ** (decimals[to] ?? 18) : 0;
        const sdk = quoteExactIn(state, from, to, size).amountOut;
        const deltaBp = chain > 0 ? (sdk / chain - 1) * 1e4 : null;
        rows.push({ pair: `${from}→${to}`, size, chain, sdk, deltaBp });

        if (chain > 0) worstInterior = Math.max(worstInterior, Math.abs(deltaBp!));
        else if (sdk !== 0)
          refusals.push(`${from}→${to} @ ${size}: chain 0, sdk ${sdk.toFixed(4)}`);
      }
    }
    console.log(
      `\nblock ${BigInt(block)}\npair            size          chain             sdk        Δbp\n${rows
        .map(
          (r) =>
            `${r.pair.padEnd(14)} ${String(r.size).padStart(9)} ${r.chain.toFixed(4).padStart(15)} ${r.sdk
              .toFixed(4)
              .padStart(
                15,
              )} ${(r.deltaBp === null ? 'REFUSED' : r.deltaBp.toFixed(4)).padStart(10)}`,
        )
        .join('\n')}\nworst interior |Δ| = ${worstInterior.toFixed(4)} bp\nrefusal breaks: ${
        refusals.length ? `\n  ${refusals.join('\n  ')}` : 'none'
      }\n`,
    );
    // EXACT refusal parity: where the chain returns nothing, the SDK must draw nothing.
    expect(refusals).toEqual([]);
    expect(worstInterior).toBeLessThanOrEqual(0.05);
  }, 300_000);

  // The printed order book is the ladder, so parity on `quoteExactIn` alone is not enough: a rung
  // swept pre-toll/pre-fee draws a spread the chain never quotes. Every rung must BE a fill.
  test('ladder parity: every printed rung is an executable chain quote', async () => {
    const b = built.stable!;
    const { state, decimals } = b;
    const rows: Array<{
      leg: string;
      side: string;
      inAmt: number;
      chain: number;
      sdk: number;
      deltaBp: number;
    }> = [];
    let worst = 0;
    const dead: string[] = [];
    for (const [from, to] of [
      ['USDC', 'RLUSD'],
      ['USDC', 'DAI'],
      ['DAI', 'RLUSD'],
    ] as const) {
      const curve = depthCurve(state, from, to);
      // ask: spend cumBase of `from` → cumTok of `to`; bid: sell cumTok of `to` → cumBase of `from`.
      for (const [side, levels] of [
        ['ask', curve.asks],
        ['bid', curve.bids],
      ] as const) {
        const live = levels.filter((l) => l.cumTok > 1e-9 && l.cumBase > 1e-9);
        const pick = [0, 1, Math.floor(live.length / 2), live.length - 1]
          .filter((i, j, a) => i >= 0 && i < live.length && a.indexOf(i) === j)
          .map((i) => live[i]!);
        for (const l of pick) {
          // The printed rung is the SKEW curve (pre-fee, pre-toll); `netPrice` carries the
          // haircut, so the executable size is the rung scaled by price/netPrice. That net size
          // is what the chain must reproduce.
          const [tIn, tOut, amtIn, amtOut] =
            side === 'ask'
              ? [from, to, l.cumBase, l.cumTok * (l.price / l.netPrice)]
              : [to, from, l.cumTok, l.cumBase * (l.netPrice / l.price)];
          const dIn = decimals[tIn] ?? 18;
          const wei = BigInt(Math.round(amtIn * 10 ** dIn));
          if (wei <= 0n) continue;
          const cq = await getSwapQuote(
            p,
            pools.stable!,
            SEPOLIA_TOKENS[tIn]!,
            SEPOLIA_TOKENS[tOut]!,
            wei,
          ).catch(() => null);
          const chain = cq ? Number(cq.amountOut) / 10 ** (decimals[tOut] ?? 18) : 0;
          if (!(chain > 0)) {
            dead.push(`${from}→${to} ${side} @ ${amtIn.toFixed(4)} ${tIn}: chain refused`);
            continue;
          }
          const deltaBp = (amtOut / chain - 1) * 1e4;
          worst = Math.max(worst, Math.abs(deltaBp));
          rows.push({ leg: `${from}→${to}`, side, inAmt: amtIn, chain, sdk: amtOut, deltaBp });
        }
      }
      const bp = (px: number) => (px / curve.mid - 1) * 1e4;
      // Printed touch is the skew anchor (0.000 bp both sides by construction); the round trip
      // that matters is the COST, read off netPrice.
      console.log(
        `${from}/${to} mid ${curve.mid.toFixed(8)} touch ${bp(curve.bids[0]!.price).toFixed(3)}/${bp(curve.asks[0]!.price).toFixed(3)} bp cost ${bp(curve.bids[0]!.netPrice).toFixed(3)}/${bp(curve.asks[0]!.netPrice).toFixed(3)} bp round-trip ${(bp(curve.asks[0]!.netPrice) - bp(curve.bids[0]!.netPrice)).toFixed(3)} bp`,
      );
    }
    console.log(
      `\nrung            side        amountIn           chain             sdk        Δbp\n${rows
        .map(
          (r) =>
            `${r.leg.padEnd(14)} ${r.side.padEnd(5)} ${r.inAmt.toFixed(4).padStart(14)} ${r.chain
              .toFixed(4)
              .padStart(15)} ${r.sdk.toFixed(4).padStart(15)} ${r.deltaBp.toFixed(4).padStart(10)}`,
        )
        .join('\n')}\nworst rung |Δ| = ${worst.toFixed(4)} bp\n`,
    );
    expect(dead).toEqual([]); // no rung at or beyond the reserve cliff
    expect(rows.length).toBeGreaterThan(8);
    expect(worst).toBeLessThanOrEqual(0.05);
  }, 300_000);
});
