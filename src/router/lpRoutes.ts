// Dual-route LP mint/redeem ranking over the backend pricer (POST /v1/route|quote).
//
// Same two terminating instruments and the same comparison key (DIRECT, spec §2.2).
// Ranking and conversion are backend SSOT; season/flag gates and the haircut pipeline
// stay local (no pricing law in them). rankDeposit/rankRedeem keep their names and are
// async now: callers pass backend wire meta (addresses/decimals) for the request build.

import {
  type NamedPoolWire,
  type QuoteRouteWire,
  type WireMeta,
  poolStateToWire,
  type routeAsync,
} from '../amm/aimm.js';
import {
  type BackendConvertOpts,
  type LiabLeg,
  WAD,
  backendConvert,
  exitValue,
  legCoverage,
  poolExitCap,
  poolSolvency,
  quoteSwapLiabilityCoreAsync,
} from '../pool/liability.js';
import type { NamedPool, SwapPlan } from './route.js';
import { assertSlip, poolHolding } from './route.js';

export interface LpRouteOpts {
  /** The caller's effective tolerance, resolved at quote time (spread-based by default in the
   *  front). REQUIRED: the back end authors slippage, so none is picked here. */
  slippageFrac: number;
  liabilityEnabled?: (symbol: string) => boolean;
  maxRedeem?: (symbol: string) => number;
  liquidityIndexWad?: (symbol: string) => number;
  /** Backend wire meta (required for any priced route): token addresses + decimals. */
  backend?: BackendConvertOpts & { meta: WireMeta };
  /** The pool's C-exposure half-spread (PBPS, `exposureTollPbps`) an ENTRY pays: deposits mint
   *  `(amt - toll)/C`. Absent reads 0 (a balanced pool); a caller that can read the marks sets it. */
  entryTollPbps?: number;
  /** Same, for an EXIT (2·maxDev basis): the payout is `out·(1 - toll)`. */
  exitTollPbps?: number;
}

const tollKeep = (pbps: number | undefined): number => 1 - (pbps ?? 0) / 1e6;

const needBackend = (opts: LpRouteOpts): BackendConvertOpts & { meta: WireMeta } => {
  if (!opts.backend) throw new Error('lpRoutes: backend SSOT required (no TS pricer)');
  return opts.backend;
};

function liabLeg(pool: NamedPool, symbol: string, opts: LpRouteOpts): LiabLeg | null {
  const s = pool.state;
  const indexWad = opts.liquidityIndexWad?.(symbol) || WAD;
  if (symbol === s.base) {
    if (!s.hub) return null;
    return {
      symbol,
      reserves: s.hub.res,
      liabilities: s.hub.liab,
      indexWad,
    };
  }
  const leg = s.legs[symbol];
  if (!leg) return null;
  return {
    symbol,
    reserves: leg.res,
    liabilities: leg.liab,
    indexWad,
  };
}

interface LpRouteStep {
  kind: 'swap' | 'deposit' | 'withdraw' | 'withdrawTo' | 'swapLiability';
  poolTag: string;
  poolAddr?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  minOut: number;
}

export interface RankedLpRoute {
  id: 'market-first' | 'deposit-first' | 'cross-exit' | 'transfer-exit';
  label: string;
  feasible: boolean;
  reason?: string;
  out: number;
  /** The floor the batch ENCODES, in `out` units (face for mints, tokens for exits). */
  minOut: number;
  hops: number;
  steps: LpRouteStep[];
}

export interface RankedLpPlan {
  best: RankedLpRoute | null;
  routes: RankedLpRoute[];
}

type RouteShell = Omit<RankedLpRoute, 'feasible' | 'reason'> & { steps: LpRouteStep[] };

/** Single infeasible-shell pipeline: every dead route is built here, never as an inline literal. */
const unfeasible = (route: RouteShell, reason: string, out = 0): RankedLpRoute => ({
  ...route,
  out,
  feasible: false,
  reason,
});

const MARKET_DEAD: RouteShell = {
  id: 'market-first',
  label: 'market swap, then deposit',
  out: 0,
  minOut: 0,
  hops: 1,
  steps: [],
};

const CROSS_DEAD: RouteShell = {
  id: 'cross-exit',
  label: 'cross withdraw (one call)',
  out: 0,
  minOut: 0,
  hops: 1,
  steps: [],
};

const seasonGate = (
  route: RouteShell,
  burnedSymbol: string,
  burnedFace: number,
  opts: LpRouteOpts,
): RankedLpRoute => {
  const capacity = opts.maxRedeem?.(burnedSymbol);
  if (capacity !== undefined && capacity < burnedFace) {
    return unfeasible(route, 'cooldown', route.out);
  }
  return { ...route, feasible: true };
};

const flagGate = (
  route: RouteShell,
  symbols: string[],
  opts: LpRouteOpts,
): RankedLpRoute | null => {
  if (!symbols.every((s) => opts.liabilityEnabled?.(s) ?? true)) {
    return unfeasible(route, 'flag-disabled', route.out);
  }
  return null;
};

const rankRoutes = (routes: RankedLpRoute[]): RankedLpRoute[] =>
  [...routes].sort((a, b) => b.out - a.out || a.hops - b.hops || 0);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Wire hex → f64 token units. BigInt-divides first so a WAD fraction (1e18 raw) stays exact;
 *  throws past 2^53 integer tokens instead of silently rounding wei. */
export const hexToF64 = (h: string, dec: number): number => {
  const raw = BigInt(h);
  const scale = 10n ** BigInt(Math.max(0, dec));
  const int = raw / scale;
  if (int > MAX_SAFE) throw new Error(`hexToF64: value exceeds 2^53 (${h})`);
  const rem = raw % scale;
  return Number(int) + Number(rem) / 10 ** dec;
};
/** Token units → wire hex. The f64 input is already wei-inexact past 2^53 scaled units;
 *  what fails closed here is an absurd token SIZE (>2^53 whole tokens), never a normal 18-dec
 *  amount (1 token = 1e18 raw is routine). u128 range is enforced backend-side. */
export const toRawHex = (amountTok: number, dec: number): string => {
  if (!Number.isFinite(amountTok) || amountTok < 0) throw new Error('toRawHex: non-finite amount');
  if (amountTok > Number.MAX_SAFE_INTEGER) throw new Error('toRawHex: amount exceeds 2^53');
  const scaled = Math.round(amountTok * 10 ** dec);
  if (!Number.isFinite(scaled) || scaled < 0) throw new Error('toRawHex: non-finite amount');
  return `0x${BigInt(scaled).toString(16)}`;
};

function wiresOf(pools: NamedPool[], b: BackendConvertOpts & { meta: WireMeta }): NamedPoolWire[] {
  return pools.map((p) =>
    poolStateToWire(p.tag, p.addr, p.state, b.meta, b.meta.decimalsOf(p.state.base)),
  );
}

export function wirePlanToSwap(
  pools: NamedPool[],
  req: { tokenIn: string; tokenOut: string; amountIn: number },
  res: Awaited<ReturnType<typeof routeAsync>>,
  decOf: (sym: string) => number,
): { plan: SwapPlan; singles: import('./route.js').RouteQuote[] } {
  try {
    const addrOf = (tag: string) => pools.find((p) => p.tag === tag)?.addr;
    const toRoute = (legs: { pool_tag: string; token_in: string; token_out: string }[]) => {
      const rl = legs.map((l) => ({
        poolTag: l.pool_tag,
        poolAddr: addrOf(l.pool_tag),
        tokenIn: l.token_in,
        tokenOut: l.token_out,
      }));
      const tokens: string[] = rl.length ? [rl[0].tokenIn] : [];
      for (const leg of rl)
        if (tokens[tokens.length - 1] !== leg.tokenOut) tokens.push(leg.tokenOut);
      return { legs: rl, tokens, hops: rl.length };
    };
    const toQuote = (q: QuoteRouteWire): import('./route.js').RouteQuote => {
      const r = toRoute(q.legs);
      const fills = q.legs.map((l, i) => ({
        leg: r.legs[i],
        amountIn: hexToF64(l.amount_in, decOf(l.token_in)),
        amountOut: hexToF64(l.amount_out, decOf(l.token_out)),
      }));
      return {
        route: r,
        amountIn: hexToF64(q.amount_in, decOf(r.legs[0].tokenIn)),
        amountOut: hexToF64(q.amount_out, decOf(r.legs[r.legs.length - 1].tokenOut)),
        fills,
      };
    };
    const parts = res.best_parts.map((p) => {
      const fraction = hexToF64(p.fraction, 18);
      const quote = toQuote({
        legs: p.legs,
        amount_in: p.legs[0]?.amount_in ?? '0x0',
        amount_out: p.amount_out,
      });
      return { route: quote.route, fraction, quote };
    });
    const plan: SwapPlan = {
      amountIn: req.amountIn,
      amountOut: hexToF64(res.best_amount_out, decOf(req.tokenOut)),
      parts,
      isSplit: res.best_is_split,
    };
    return { plan, singles: res.singles.map(toQuote) };
  } catch (e) {
    throw new Error(`wirePlanToSwap: malformed route wire: ${(e as Error).message}`);
  }
}

// ── mint: X -> target-LP ────────────────────────────────────────────────────────

async function transferMint(
  pools: NamedPool[],
  xToken: string,
  targetSym: string,
  amountIn: number,
  opts: LpRouteOpts,
): Promise<RankedLpRoute | null> {
  const b = needBackend(opts);
  const slip = opts.slippageFrac;
  const holder = poolHolding(pools, xToken, targetSym);
  if (!holder) return null;
  const inLeg = liabLeg(holder, xToken, opts);
  const outLeg = liabLeg(holder, targetSym, opts);
  if (!inLeg || !outLeg) return null;

  const shell: RouteShell = {
    id: 'deposit-first',
    label: 'deposit, then transfer liability',
    out: 0,
    minOut: 0,
    hops: 2,
    steps: [
      {
        kind: 'deposit',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: xToken,
        tokenOut: xToken,
        amountIn,
        amountOut: amountIn,
        minOut: 0,
      },
      {
        kind: 'swapLiability',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: xToken,
        tokenOut: targetSym,
        amountIn,
        amountOut: 0,
        minOut: 0,
      },
    ],
  };
  const flagged = flagGate(shell, [xToken, targetSym], opts);
  if (flagged) return flagged;
  const gated = seasonGate(shell, xToken, amountIn, opts);
  if (!gated.feasible) return gated;
  const c = poolSolvency(holder.state);
  if (c === null) return unfeasible(shell, 'feed-unavailable');
  // The deposit mints face `amountIn / C`; that face is what the liability swap then burns.
  const faceIn = (amountIn * tollKeep(opts.entryTollPbps)) / c;
  shell.steps[1].amountIn = faceIn;

  let q: Awaited<ReturnType<typeof quoteSwapLiabilityCoreAsync>>;
  try {
    q = await quoteSwapLiabilityCoreAsync(
      inLeg,
      outLeg,
      faceIn,
      c,
      backendConvert(holder.state, xToken, targetSym, b),
    );
  } catch {
    return unfeasible(shell, 'backend-error');
  }
  if (!q) return unfeasible(shell, 'no-route');
  // step[1] is in SHARES (the chain's swapLiability arg); `out` is FACE like every other route.
  shell.steps[1].amountOut = q.lpAmountOut;
  shell.steps[1].minOut = q.lpAmountOut * (1 - slip);
  const faceOut = (q.lpAmountOut * (outLeg.indexWad ?? WAD)) / WAD;
  return {
    ...shell,
    out: faceOut,
    minOut: (shell.steps[1].minOut * (outLeg.indexWad ?? WAD)) / WAD,
    feasible: true,
  };
}

/** Mint amountIn of xToken, ending in targetSym LP. Single-pool scope (spec §2.1). */
export async function rankDeposit(
  pools: NamedPool[],
  xToken: string,
  targetSym: string,
  amountIn: number,
  opts: LpRouteOpts,
): Promise<RankedLpPlan> {
  assertSlip('rankDeposit', opts.slippageFrac);
  if (!(amountIn > 0)) return { best: null, routes: [] };
  if (xToken === targetSym) {
    const holder = poolHolding(pools, xToken, xToken);
    if (!holder) return { best: null, routes: [] };
    // Face minted at C (`PoolLiquidityLib.deposit`); no rate ⇒ the chain refuses the mint.
    const c = poolSolvency(holder.state);
    const direct: RankedLpRoute = {
      id: 'market-first',
      label: 'direct deposit',
      feasible: c !== null,
      ...(c === null ? { reason: 'feed-unavailable' } : {}),
      out: c === null ? 0 : (amountIn * tollKeep(opts.entryTollPbps)) / c,
      minOut: c === null ? 0 : (amountIn * tollKeep(opts.entryTollPbps)) / c,
      hops: 1,
      steps: [
        {
          kind: 'deposit',
          poolTag: holder.tag,
          poolAddr: holder.addr,
          tokenIn: xToken,
          tokenOut: xToken,
          amountIn,
          amountOut: amountIn,
          minOut: 0,
        },
      ],
    };
    return { best: direct.feasible ? direct : null, routes: [direct] };
  }
  // Cross-asset deposits go deposit-then-liability-swap only. The swap-then-deposit arm is gone:
  // its deposit leg runs unfloored in a later transaction (anti-JIT forbids batching it), and
  // v2 deposits are allowlisted at genesis.
  const transfer = await transferMint(pools, xToken, targetSym, amountIn, opts);
  const routes = rankRoutes([transfer].filter((r): r is RankedLpRoute => r !== null));
  return { best: routes.find((r) => r.feasible) ?? null, routes };
}

// ── redeem: target-LP -> Y ──────────────────────────────────────────────────────

async function crossExit(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts,
): Promise<RankedLpRoute | null> {
  const b = needBackend(opts);
  const slip = opts.slippageFrac;
  const holder = poolHolding(pools, targetSym, outToken);
  if (!holder) return null;
  const fromLeg = liabLeg(holder, targetSym, opts);
  const toLeg = liabLeg(holder, outToken, opts);
  if (!fromLeg || !toLeg) return null;

  // FAIR VALUE AT C, never at c_from (`_quoteWithdrawCross`): no rate ⇒ `mintRate` reverts.
  const c = poolSolvency(holder.state);
  if (c === null) return unfeasible(CROSS_DEAD, 'feed-unavailable');
  const withdrawValue = (lpFaceIn * (fromLeg.indexWad ?? WAD)) / WAD;
  const fair = withdrawValue * c * tollKeep(opts.exitTollPbps);
  const convert = backendConvert(holder.state, targetSym, outToken, b);
  let q: Awaited<ReturnType<typeof convert>>;
  try {
    q = await convert(fair);
  } catch {
    return unfeasible(CROSS_DEAD, 'backend-error');
  }
  if (!q || !(q.amountOut > 0)) {
    return unfeasible(CROSS_DEAD, 'no-route');
  }
  // Lemma B mark cap, and NO output-leg haircut: the claim was settled at C on the way in.
  const markCap = fair * q.markPrice;
  const out = q.amountOut > markCap ? markCap : q.amountOut;
  if (!(out > 0)) return unfeasible(CROSS_DEAD, 'no-route');

  const shell: RouteShell = {
    id: 'cross-exit',
    label: 'cross withdraw (one call)',
    out,
    minOut: out * (1 - slip),
    hops: 1,
    steps: [
      {
        kind: 'withdrawTo',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: targetSym,
        tokenOut: outToken,
        amountIn: lpFaceIn,
        amountOut: out,
        minOut: out * (1 - slip),
      },
    ],
  };
  return seasonGate(shell, targetSym, lpFaceIn, opts);
}

async function transferExit(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts,
): Promise<RankedLpRoute | null> {
  const b = needBackend(opts);
  const slip = opts.slippageFrac;
  const holder = poolHolding(pools, targetSym, outToken);
  if (!holder) return null;
  const fromLeg = liabLeg(holder, targetSym, opts);
  const toLeg = liabLeg(holder, outToken, opts);
  if (!fromLeg || !toLeg) return null;

  const shell: RouteShell = {
    id: 'transfer-exit',
    label: 'transfer liability, then same-asset exit',
    out: 0,
    minOut: 0,
    hops: 2,
    steps: [
      {
        kind: 'swapLiability',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: targetSym,
        tokenOut: outToken,
        amountIn: lpFaceIn,
        amountOut: 0,
        minOut: 0,
      },
      {
        kind: 'withdraw',
        poolTag: holder.tag,
        poolAddr: holder.addr,
        tokenIn: outToken,
        tokenOut: outToken,
        amountIn: 0,
        amountOut: 0,
        minOut: 0,
      },
    ],
  };
  const flagged = flagGate(shell, [targetSym, outToken], opts);
  if (flagged) return flagged;
  const gated = seasonGate(shell, targetSym, lpFaceIn, opts);
  if (!gated.feasible) return gated;
  const c = poolSolvency(holder.state);
  if (c === null) return unfeasible(shell, 'feed-unavailable');

  let q: Awaited<ReturnType<typeof quoteSwapLiabilityCoreAsync>>;
  try {
    q = await quoteSwapLiabilityCoreAsync(
      fromLeg,
      toLeg,
      lpFaceIn,
      c,
      backendConvert(holder.state, targetSym, outToken, b),
    );
  } catch {
    return unfeasible(shell, 'backend-error');
  }
  if (!q) return unfeasible(shell, 'no-route');

  // Same-asset exit of the credited face: `min(c_leg, C)` on the destination leg AFTER the credit.
  const exitOut = exitValue(
    q.liabOut,
    legCoverage(toLeg.reserves, toLeg.liabilities + q.liabOut),
    c,
  );
  shell.steps[0].amountOut = q.lpAmountOut;
  shell.steps[0].minOut = q.lpAmountOut * (1 - slip);
  shell.steps[1].amountIn = q.lpAmountOut;
  shell.steps[1].amountOut = exitOut;
  shell.steps[1].minOut = exitOut * (1 - slip);
  return { ...shell, out: exitOut, minOut: shell.steps[1].minOut, feasible: true };
}

/** Redeem lpFaceIn (FACE units) of targetSym LP, ending in outToken tokens. */
export async function rankRedeem(
  pools: NamedPool[],
  targetSym: string,
  outToken: string,
  lpFaceIn: number,
  opts: LpRouteOpts,
): Promise<RankedLpPlan> {
  assertSlip('rankRedeem', opts.slippageFrac);
  if (!(lpFaceIn > 0)) return { best: null, routes: [] };
  if (targetSym === outToken) {
    const holder = poolHolding(pools, targetSym, targetSym);
    const leg = holder && liabLeg(holder, targetSym, opts);
    if (!holder || !leg) return { best: null, routes: [] };
    const shell: RouteShell = {
      id: 'cross-exit',
      label: 'same-asset withdraw',
      out: 0,
      minOut: 0,
      hops: 1,
      steps: [
        {
          kind: 'withdraw',
          poolTag: holder.tag,
          poolAddr: holder.addr,
          tokenIn: targetSym,
          tokenOut: outToken,
          amountIn: lpFaceIn,
          amountOut: 0,
          minOut: 0,
        },
      ],
    };
    const gated = seasonGate(shell, targetSym, lpFaceIn, opts);
    if (!gated.feasible) return { best: null, routes: [gated] };
    const slip = opts.slippageFrac;
    // `exitMu`: in-kind at `min(c_leg, cap)`; a dark mark degrades the cap to C's lower bound and
    // the hatch stays open. `exitTollPbps` is the C-exposure toll taken off the payout.
    const cap = poolExitCap(holder.state);
    const actual =
      exitValue(lpFaceIn, legCoverage(leg.reserves, leg.liabilities), cap) *
      tollKeep(opts.exitTollPbps);
    gated.steps[0].amountOut = actual;
    gated.steps[0].minOut = actual * (1 - slip);
    gated.out = actual;
    gated.minOut = gated.steps[0].minOut;
    return { best: gated, routes: [gated] };
  }
  needBackend(opts);
  const cross = await crossExit(pools, targetSym, outToken, lpFaceIn, opts);
  const transfer = await transferExit(pools, targetSym, outToken, lpFaceIn, opts);
  const routes = rankRoutes([cross, transfer].filter((r): r is RankedLpRoute => r !== null));
  return { best: routes.find((r) => r.feasible) ?? null, routes };
}
