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
import { quoteExactIn, buildLeg, type AimmProfile, type PoolState } from '../src/amm/aimm';
import { decodeFn, encodeFn } from '../src/eth/abi';
import { createHttpProvider } from '../src/eth/client';
import type { Address, Eip1193Provider, Hex } from '../src/eth/types';
import { EXTERNAL_ORACLE_ABI } from '../src/abis/ExternalOracle';
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
    const curve = presetId > 0 ? await readCurve(p, pool, presetId) : null;
    let mark = Number(decodeB64(BigInt(row.lastPriceB64 ?? 0n), 18)) / 1e18;
    if (USD_QUOTED.has(sym)) {
      if (!(baseUsd > 0)) continue; // fail closed, as the front does
      mark /= baseUsd;
    }
    if (!(mark > 0)) continue;
    const profile: AimmProfile = {
      gamma: Number(asset.gamma),
      vega: Number(asset.vega),
      lambda: 0,
      minFee: Number(asset.minFeePbps),
      maxFee: Number(asset.maxFeePbps),
      minDisp: Number(asset.minDispersion),
      maxDisp: Number(asset.maxDispersion),
      covMin: risk.coverageMin,
      covMax: risk.coverageMax,
      depthAmp: risk.depthAmplifier,
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
});
