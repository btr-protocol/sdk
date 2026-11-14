// Dual-route LP mint/redeem ranking over the backend pricer (POST /v1/route|quote).
//
// Same two terminating instruments and the same comparison key (DIRECT, spec §2.2).
// Ranking and conversion are backend SSOT; season/flag gates and the haircut pipeline
// stay local (no pricing law in them). rankDeposit/rankRedeem keep their names and are
// async now: callers pass backend wire meta (addresses/decimals) for the request build.

import type { PoolState, QuoteRouteWire, WireMeta, routeAsync } from '../amm/aimm.js';
import {
  type LiabLeg,
  WAD,
  claimRate,
  covBitsOf,
  covWallsF,
  exitValue,
  feeCredit,
  legCoverage,
  poolExitCap,
  poolSolvency,
} from '../pool/liability.js';
import {
  type BackendConvertOpts,
  backendConvert,
  quoteSwapLiabilityCoreAsync,
} from '../pool/liabilityQuote.js';
import { toUnits } from '../utils/format.js';
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
  backend?: LpBackend;
  /** `Pool.previewWithdraw(tk, lp)` (`PoolLiquidityLib.previewWithdraw`): the same-asset payout in
   *  raw token units, net of the settlement toll off `exitCap`'s lower-pass sweep. `lpShares` is the
   *  LP share amount being redeemed (display units). Null = unread. The same-asset exit is priced by
   *  the chain's own preview: with live, fresh solvency words it is the lower of the preview and the
   *  state model; with the words pending, stale, off the chain clock or the pool degraded
   *  (`feed-unavailable`) the preview alone prices it, and an unread preview leaves it unpriced under
   *  the gate's reason. Cross and transfer exits never use it. See the front's `previewWithdraw` reader. */
  previewWithdraw?: (pool: NamedPool, symbol: string, lpShares: number) => Promise<bigint | null>;
  /** The C toll (WAD) the transfer-exit's second call (`withdraw`) pays: `exitCap`'s sweep over the
   *  books AFTER the `swapLiability` claim move (both legs' claims and the exposure high-water
   *  changed), e.g. from a simulated batch. Pool state cannot price it (exposure heads, record
   *  spreads), and the entry word understates it, so without this transfer-exit is `toll-pending`. */
  postMoveExitTollWad?: (ctx: PostMoveTollCtx) => Promise<bigint | null>;
  /** Max age (ms) of the state's `poolSolvencyWad` words (`solvencyAtMs`) an exit prices off;
   *  older or unstamped = `toll-stale`, stamped further ahead of `now` than {@link TOLL_FUTURE_SLACK_MS}
   *  = `toll-clock` (default {@link MAX_TOLL_AGE_MS}). The toll tracks the books and a stale low word
   *  overquotes, so cross and transfer exits are refused on it; the same-asset exit drops the model
   *  and is priced by `previewWithdraw` alone. */
  maxTollAgeMs?: number;
  /** Clock for the age check (ms epoch). Must be CHAIN time (sdk `chainNowMs`): the stamp is a block
   *  header time. Default `Date.now`, right only for a device whose clock is synced to the chain. */
  now?: () => number;
}

/** Default freshness of the solvency words: a few blocks on any served chain. */
export const MAX_TOLL_AGE_MS = 30_000;

export interface PostMoveTollCtx {
  pool: NamedPool;
  /** The holder's books after the claim move (indicative, float). */
  postState: PoolState;
  tokenIn: string;
  tokenOut: string;
  lpAmountIn: number;
  /** LP shares of `tokenOut` the move credits: the second call's `lpAmount`. */
  lpAmountOut: number;
}

/** Backend settings shared by every route. The pool address is per pool, so each conversion takes it
 *  from its holder (`convertFor`), never from here. */
export type LpBackend = Omit<BackendConvertOpts, 'poolAddress'> & { meta: WireMeta };

const needBackend = (opts: LpRouteOpts): LpBackend => {
  if (!opts.backend) throw new Error('lpRoutes: backend SSOT required (no TS pricer)');
  return opts.backend;
};

/** The conversion opts for one holder pool. Null when the pool carries no address: no route runs
 *  through it. A zero address is refused by `backendConvert` (a backend-error on that route). */
const convertFor = (
  holder: NamedPool,
  b: LpBackend,
): (LpBackend & { poolAddress: string }) | null =>
  holder.addr ? { ...b, poolAddress: holder.addr } : null;

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
      covBits: s.hub.covBits,
      storageVersion: s.hub.storageVersion,
      minLiquidity: s.hub.minLiquidity,
      liquidRes: s.hub.liquidRes,
      decimals: opts.backend?.baseDecimals,
    };
  }
  const leg = s.legs[symbol];
  if (!leg) return null;
  return {
    symbol,
    reserves: leg.res,
    liabilities: leg.liab,
    indexWad,
    covBits: leg.covBits,
    storageVersion: leg.storageVersion,
    minLiquidity: leg.minLiquidity,
    liquidRes: leg.liquidRes,
    decimals: leg.decimals,
  };
}

/** a >= b up to a relative 1e-12, so a live float value cannot false-refuse by one ulp. */
const geq = (a: number, b: number): boolean => a >= b - 1e-12 * Math.max(Math.abs(a), Math.abs(b));

/** A leg gate: a hard refusal, or a recall (the leg is invested and only the total book clears). */
type LiquidGate = { reason: string } | { recall: string } | null;

/** `need` must clear the liquid book. The chain recalls invested funds through the hook before it
 *  reverts (`PoolHooksLib.sol:95-128`): when the leg is invested and TOTAL reserves clear `need`, the
 *  route stays feasible and names the leg in `recall`; the on-chain simulation is the binding check
 *  (the 1e-12 tolerance in {@link geq} is safe only because of it). A liquid figure above total is a
 *  data mismatch: clamped to `reserves`, it never makes a refused route feasible. */
function liquidClear(leg: LiabLeg, need: number): LiquidGate {
  if (leg.liquidRes === undefined) return { reason: 'min-liquidity-unknown' };
  const liquid = Math.min(leg.liquidRes, leg.reserves);
  if (geq(liquid, need)) return null;
  return geq(leg.reserves, need) ? { recall: leg.symbol } : { reason: 'min-liquidity' };
}

/** `withdraw`/`withdrawTo` keep `R_liq − out ≥ minLiquidity` (`PoolLiquidityLib.sol:465-466`,
 *  `PoolHooksLib.liquidReserves` = reserves − invested). An unread floor or liquid book is unknown,
 *  never 0. A cross exit's out leg has `ctx.cWad = 0` (`:403`, set only on the same-asset arm `:502`),
 *  so `_fence` skips its `x` term there and only this floor applies. */
function liquidFloor(leg: LiabLeg, out: number): LiquidGate {
  if (leg.minLiquidity === undefined) return { reason: 'min-liquidity-unknown' };
  return liquidClear(leg, out + leg.minLiquidity);
}

/** `_fence` (`PoolLiquidityLib.sol:566-577`) on the leg that burns `face` at rate `c`: the liquid book
 *  must cover `x = R − (L − face)·c` (`:570-572`). Recall-type only: `x ≤ R` whenever `face ≤ L`
 *  (checked upstream, `insufficient-liability`) and `c ≥ 0`, so total reserves always clear it. */
function liquidFence(leg: LiabLeg, face: number, c: number): LiquidGate {
  if (leg.liquidRes === undefined) return { reason: 'min-liquidity-unknown' };
  const x = leg.reserves - (leg.liabilities - face) * c;
  return geq(Math.min(leg.liquidRes, leg.reserves), x) ? null : { recall: leg.symbol };
}

/** Collects the gates of one route: the first hard refusal, else the legs needing a recall. */
function gateRecall(...gates: LiquidGate[]): { reason: string } | { recallLegs: string[] } {
  const recallLegs: string[] = [];
  for (const g of gates) {
    if (g && 'reason' in g) return g;
    if (g && !recallLegs.includes(g.recall)) recallLegs.push(g.recall);
  }
  return { recallLegs };
}

const recallFields = (legs: string[]): { recall?: true; recallLegs?: string[] } =>
  legs.length ? { recall: true, recallLegs: legs } : {};

interface LpRouteStep {
  kind: 'swap' | 'deposit' | 'withdraw' | 'withdrawTo' | 'swapLiability';
  poolTag: string;
  poolAddr?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  /** `amountOut·(1−slip)` off the BACK END's conversion: indicative. A caller encodes it only
   *  after lifting it against the chain's own answer for the same call (`simulatePoolCall` /
   *  `previewWithdraw` through the wallet); `buildDepositCalls`/`buildRedeemCalls` refuse 0. */
  minOut: number;
}

export interface RankedLpRoute {
  id: 'market-first' | 'deposit-first' | 'cross-exit' | 'transfer-exit';
  label: string;
  feasible: boolean;
  reason?: string;
  out: number;
  /** The route's floor in `out` units (face for mints, tokens for exits); same caveat as the
   *  steps' `minOut`: back-derived until the caller lifts it against the chain. */
  minOut: number;
  hops: number;
  steps: LpRouteStep[];
  /** Set when a leg is invested and only its total reserves clear the exit gate: the chain recalls
   *  through the hook. The router cannot see whether the hook can deliver (no pre-outflow flag, a
   *  paused venue); the on-chain simulation decides. `recallLegs` names the legs. */
  recall?: true;
  recallLegs?: string[];
}

export interface RankedLpPlan {
  best: RankedLpRoute | null;
  routes: RankedLpRoute[];
}

type RouteShell = Omit<RankedLpRoute, 'feasible' | 'reason'> & { steps: LpRouteStep[] };

/** Single infeasible-shell pipeline: every dead route is built here, never as an inline literal. */
const unfeasible = (route: RouteShell, reason: string, out = 0): RankedLpRoute => {
  const { recall: _r, recallLegs: _l, ...rest } = route; // a dead route never carries a recall
  return { ...rest, out, feasible: false, reason };
};

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

/** Output first, then hops. The caller takes `best` with no retry, so a recall route (it may still
 *  fail at simulation) leads only when it beats the best clean route by more than 10 bps. */
export const rankRoutes = (routes: RankedLpRoute[]): RankedLpRoute[] => {
  const s = [...routes].sort((a, b) => b.out - a.out || a.hops - b.hops || 0);
  const top = s.find((r) => r.feasible);
  if (!top?.recall) return s;
  const clean = s.find((r) => r.feasible && !r.recall && r.out >= top.out * (1 - 0.001));
  return clean ? [clean, ...s.filter((r) => r !== clean)] : s;
};

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
  return `0x${toUnits(amountTok, dec).toString(16)}`;
};

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
  const bk = convertFor(holder, b);
  if (!bk) return null;
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
  const c = claimRate(holder.state);
  if (c === null) return unfeasible(shell, 'feed-unavailable');
  // The deposit mints face `amountIn / C`; that face is what the liability swap then burns.
  const faceIn = amountIn / c;
  shell.steps[1].amountIn = faceIn;

  let q: Awaited<ReturnType<typeof quoteSwapLiabilityCoreAsync>>;
  try {
    q = await quoteSwapLiabilityCoreAsync(
      inLeg,
      outLeg,
      faceIn,
      c,
      backendConvert(holder.state, xToken, targetSym, bk, 'credit'),
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
    const c = claimRate(holder.state);
    const direct: RankedLpRoute = {
      id: 'market-first',
      label: 'direct deposit',
      feasible: c !== null,
      ...(c === null ? { reason: 'feed-unavailable' } : {}),
      out: c === null ? 0 : amountIn / c,
      minOut: c === null ? 0 : amountIn / c,
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
  const bk = convertFor(holder, b);
  if (!bk) return null;
  const fromLeg = liabLeg(holder, targetSym, opts);
  const toLeg = liabLeg(holder, outToken, opts);
  if (!fromLeg || !toLeg) return null;

  // Chain `ok` (second `poolSolvencyWad` word): degraded, `creditRate` settles at C's lower bound
  // with the lower-pass toll, neither of which the state's C or toll word carries. Unknown = pending.
  const solv = solvencyGate(holder.state, opts);
  if (solv) return unfeasible(CROSS_DEAD, solv);
  // FAIR VALUE AT C, never at c_from (`_quoteWithdrawCross`): no rate ⇒ `mintRate` reverts.
  const c = claimRate(holder.state);
  if (c === null) return unfeasible(CROSS_DEAD, 'feed-unavailable');
  // `creditRate(false)`'s toll, the third `poolSolvencyWad` word while `ok`. Absent = params not
  // loaded: unknown, never 0 (a 0 overstates the payout and minOut reverts).
  const tw = holder.state.exitTollWad;
  if (tw == null) return unfeasible(CROSS_DEAD, 'toll-pending');
  // Chain: toll capped at the payout, so a toll >= 100% leaves nothing and the exit reverts.
  if (tw >= BigInt(WAD)) return unfeasible(CROSS_DEAD, 'toll-exceeds-payout');
  // `withdrawValue = floor(lp · index / WAD)` (`PoolLiquidityLib.sol:434`): floored in raw units
  // when the leg carries decimals, so the claim face sent to the back is never above the chain's.
  const dFrom = fromLeg.decimals;
  const withdrawValue =
    dFrom === undefined
      ? (lpFaceIn * (fromLeg.indexWad ?? WAD)) / WAD
      : rawToOut(exitFaceRaw(lpFaceIn, fromLeg.indexWad ?? WAD, dFrom), dFrom);
  if (!(withdrawValue > 0) || withdrawValue > fromLeg.liabilities)
    return unfeasible(CROSS_DEAD, 'insufficient-liability');
  const fair = withdrawValue * c;
  const convert = backendConvert(holder.state, targetSym, outToken, bk, 'exit');
  let q: Awaited<ReturnType<typeof convert>>;
  try {
    q = await convert(fair, c);
  } catch {
    return unfeasible(CROSS_DEAD, 'backend-error');
  }
  if (!q || !(q.amountOut > 0)) {
    return unfeasible(CROSS_DEAD, 'no-route');
  }
  // The from-leg's claim debit (`CovLib.debitToll`, Φ⁺ at constant reserves, scaled 1/C) comes out
  // of the payout after the C toll (`_quoteWithdrawCross` `PoolLiquidityLib.sol:541-543`). A back
  // that omits it has not priced it: fail closed, never a zero debit (a wall saturates it to the
  // whole payout).
  if (q.debitToll === undefined) return unfeasible(CROSS_DEAD, 'toll-pending');
  // Lemma B mark cap, and NO output-leg haircut: the claim was settled at C on the way in.
  const markCap = fair * q.markPrice;
  const gross = q.amountOut > markCap ? markCap : q.amountOut;
  if (!(gross > 0)) return unfeasible(CROSS_DEAD, 'no-route');
  // `_quoteWithdrawCross`: `amt = q.amountOut − _cToll(q.amountOut, toll) − debit` (`:538-543`), the
  // C toll (capped at the output) staying in the output leg's reserves. The backend computes it from
  // `claim.toll_wad` (`Quote.cToll`); without one, `_cToll` off the state's word at the gross. In raw
  // units, every rounding toward the pool: gross floored, tolls ceiled.
  const d = toLeg.decimals;
  if (d === undefined) return unfeasible(CROSS_DEAD, 'toll-pending');
  const rGross = floorRaw(gross, d);
  const rCalc = cToll(rGross, tw);
  const rToll = q.cToll === undefined ? rCalc : minBig(maxBig(ceilRaw(q.cToll, d), rCalc), rGross);
  const rDebit = ceilRaw(q.debitToll, d);
  const rOut = rGross - rToll > rDebit ? rGross - rToll - rDebit : 0n;
  const toll = Number(rToll) / 10 ** d;
  const debit = q.debitToll;
  const out = rawToOut(rOut, d);
  if (!(out > 0)) return unfeasible(CROSS_DEAD, debit > 0 ? 'coverage-wall' : 'no-route');
  // `_applyWithdraw`: reserves fall by `out`; liabilities rise by the route fee's LP credit and the
  // treasury face (route proto fee + the toll's proto slice), each `fee*WAD/g` (g = lastGoodC = c,
  // stamped by `mintRate`) and dropped to 0 when it exceeds the book (`_credit`). Same inputs as
  // the chain, so the floor check accepts iff the chain does.
  const stampedC = Math.floor(c * 1e9) / 1e9;
  const lpCredit = feeCredit((q.grossOut * q.lpFeeBps) / 1e4, toLeg.liabilities, stampedC);
  const protoFee =
    (q.grossOut * q.protoFeeBps) / 1e4 + (toll * (holder.state.protoSharePct ?? 0)) / 100;
  const face = feeCredit(protoFee, toLeg.liabilities + lpCredit, stampedC);
  const toBits = covBitsOf(toLeg);
  if (toBits === null) return unfeasible(CROSS_DEAD, 'toll-pending');
  if (
    covWallsF(
      toBits,
      toLeg.reserves,
      toLeg.liabilities,
      toLeg.reserves - out,
      toLeg.liabilities + lpCredit + face,
    )
  )
    return unfeasible(CROSS_DEAD, 'coverage-wall');
  // `withdrawTo` reverts `InsufficientAmount` when the out leg would fall under its keeper floor.
  // Absent is unknown, never 0: a floor that was not read cannot be proven clear.
  const gate = gateRecall(liquidFloor(toLeg, out), liquidFence(fromLeg, withdrawValue, c));
  if ('reason' in gate) return unfeasible(CROSS_DEAD, gate.reason);

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
  return seasonGate({ ...shell, ...recallFields(gate.recallLegs) }, targetSym, lpFaceIn, opts);
}

/** `PoolSolvencyLib.sweep`'s `ok` as the state carries it (`solvencyOk`, from `withPoolSolvency`):
 *  null when live and fresh; `toll-pending` when not loaded; `feed-unavailable` when degraded (a dark
 *  leg); `toll-stale` when the words are not provably fresh ({@link tollStale}). */
export function solvencyGate(
  state: PoolState,
  opts: LpRouteOpts,
): 'toll-pending' | 'toll-stale' | 'toll-clock' | 'feed-unavailable' | null {
  if (state.solvencyOk === undefined || state.solvencyOk === null) return 'toll-pending';
  if (!state.solvencyOk) return 'feed-unavailable';
  return tollStaleReason(state, opts);
}

/** A stamp up to this far ahead of `now` is clock noise (a header time against a synced chain clock
 *  differs by a block or two) and reads as age 0; further ahead it is not believed. */
export const TOLL_FUTURE_SLACK_MS = 10_000;

/** Why the solvency words cannot be trusted at `opts.now`, or null when they are fresh. `solvencyAtMs`
 *  is CHAIN time (the read's block header), so `now` must be chain time too (`chainNowMs`): a device
 *  clock behind the chain would otherwise date every stamp in the future. Unstamped, older than the
 *  caller's bound, or an unusable clock fail closed. */
function tollStaleReason(
  state: PoolState,
  opts: Pick<LpRouteOpts, 'now' | 'maxTollAgeMs'>,
): 'toll-stale' | 'toll-clock' | null {
  const at = state.solvencyAtMs;
  if (at === undefined || at === null) return 'toll-stale';
  const raw = (opts.now ?? Date.now)() - at;
  if (!Number.isFinite(raw)) return 'toll-stale';
  if (raw < -TOLL_FUTURE_SLACK_MS) return 'toll-clock';
  return Math.max(raw, 0) <= (opts.maxTollAgeMs ?? MAX_TOLL_AGE_MS) ? null : 'toll-stale';
}

const WAD_N = 10n ** 18n;
/** Relative margin over f64 composition (a few ulps of the state's float books), toward the pool. */
const SLACK = 1 - 2 ** -46;
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
/** A float payout in raw units, never above the chain's integer floor: shaved by {@link SLACK},
 *  truncated, then one unit off. */
function floorRaw(v: number, d: number): bigint {
  const r = toUnits(v * SLACK, d);
  return r > 0n ? r - 1n : 0n;
}
/** A float charge in raw units, never below the chain's: grossed up by {@link SLACK}, plus a unit. */
const ceilRaw = (v: number, d: number): bigint => (v > 0 ? toUnits(v / SLACK, d) + 1n : 0n);
/** Raw payout back to display units such that `toUnits(out, d) <= raw`. Below 1e15 the quotient
 *  round-trips `toUnits`' 16 significant digits exactly; above, f64 can round up, so shave. */
function rawToOut(raw: bigint, d: number): number {
  if (raw <= 0n) return 0;
  const v = Number(raw) / 10 ** d;
  return raw < 10n ** 15n ? v : v * SLACK;
}
/** `PoolLiquidityLib._cToll`: `ceil(amt * tw / WAD)`, capped at `amt`. */
function cToll(amt: bigint, tw: bigint): bigint {
  const f = (amt * tw + WAD_N - 1n) / WAD_N;
  return f > amt ? amt : f;
}

/** `_quoteWithdrawSame` payout net of the C toll: `amt − _cToll(amt, tw)` (`PoolLiquidityLib.sol:
 *  497-498, 510`), tw < WAD. Indicative float only: a caller without wire decimals cannot floor. */
function sameAssetNetF(gross: number, tw: bigint): number {
  return gross * (1 - Number(tw) / WAD) * SLACK;
}

/** `withdraw`'s claim face in raw units, `floor(lp · index / WAD)` (`PoolLiquidityLib.sol:434`),
 *  LP shares at the underlying's decimals (`LPToken.decimals`). The f64 index is shaved by an ulp,
 *  so the face never lands above the chain's integer one (an exact index can lose one raw unit). */
function exitFaceRaw(lpShares: number, indexWad: number, d: number): bigint {
  const lp = toUnits(lpShares, d);
  // An f64 index sits within half an ulp of the chain's uint; one ulp off covers it.
  const ulp = 2 ** (Math.floor(Math.log2(indexWad)) - 52);
  const idx = BigInt(Math.floor(indexWad)) - BigInt(Math.ceil(ulp));
  return (lp * idx) / WAD_N;
}

/** `_quoteWithdrawSame` gross in raw units: `floor(face · exitMu(R, L, cap) / WAD)`, `exitMu =
 *  min(floor(R·WAD/L), cap)` (`PoolLiquidityLib.sol:118-126, 497-498`). The float books round toward
 *  the pool (R floored, L ceiled, cap shaved), so `mu` is never above the chain's; with `mu ≫ 1`
 *  a float face would overquote by up to `mu` raw units per unit of face fraction. */
function sameAssetGrossRaw(
  faceRaw: bigint,
  reserves: number,
  liabilities: number,
  cap: number,
  d: number,
): bigint {
  if (!(cap > 0) || faceRaw <= 0n) return 0n;
  const capWad = Number.isFinite(cap) ? BigInt(Math.floor(cap * SLACK * 1e18)) : null;
  const L = liabilities > 0 ? ceilRaw(liabilities, d) : 0n;
  const cLeg = L > 0n ? (floorRaw(reserves, d) * WAD_N) / L : null;
  const mu = cLeg === null ? capWad : capWad === null ? cLeg : minBig(cLeg, capWad);
  if (mu === null) return 0n;
  return (faceRaw * mu) / WAD_N;
}

/** Raw same-asset payout net of the C toll, back in display units (`toUnits(out) <= chain`). */
function sameAssetNetRaw(amt: bigint, tw: bigint, d: number): number {
  return rawToOut(amt - cToll(amt, tw), d);
}

/** Move `delta` of face onto `symbol`'s claim book in `state` (mutated). False when the state has no
 *  book for it: a missing leg is never conjured from a spread of undefined. */
export function changeFace(state: PoolState, symbol: string, delta: number): boolean {
  if (symbol === state.base && state.hub) {
    state.hub.liab += delta;
    return true;
  }
  const leg = state.legs[symbol];
  if (!leg) return false;
  state.legs[symbol] = { ...leg, liab: leg.liab + delta };
  return true;
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
  const bk = convertFor(holder, b);
  if (!bk) return null;
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
  // `swapLiability` settles at `creditRate`: degraded = C's lower bound, which the state cannot
  // price. Unknown `ok` = pending.
  const solv = solvencyGate(holder.state, opts);
  if (solv) return unfeasible(shell, solv);
  // The second call's C toll is `exitCap`'s sweep AFTER the claim move, never the entry word
  // (the move reshapes the exposure the toll prices; the entry word can understate it).
  if (!opts.postMoveExitTollWad) return unfeasible(shell, 'toll-pending');
  const c = claimRate(holder.state);
  if (c === null) return unfeasible(shell, 'feed-unavailable');

  let q: Awaited<ReturnType<typeof quoteSwapLiabilityCoreAsync>>;
  try {
    q = await quoteSwapLiabilityCoreAsync(
      fromLeg,
      toLeg,
      lpFaceIn,
      c,
      backendConvert(holder.state, targetSym, outToken, bk, 'credit'),
    );
  } catch {
    return unfeasible(shell, 'backend-error');
  }
  if (!q) return unfeasible(shell, 'no-route');

  // The next call sweeps again: the conversion reduced the claim book and booked route fees.
  const postState = {
    ...holder.state,
    solvencyCWad: null, // the chain word is the PRE-move rate; the post-move books are modelled
    hub: holder.state.hub && { ...holder.state.hub },
    legs: { ...holder.state.legs },
  };
  const outLiab = toLeg.liabilities + q.liabOut + q.lpFeeCredit + q.protoFeeCredit;
  if (
    !changeFace(postState, targetSym, -q.liabIn) ||
    !changeFace(postState, outToken, q.liabOut + q.lpFeeCredit + q.protoFeeCredit)
  )
    return unfeasible(shell, 'no-route');
  const postC = poolSolvency(postState);
  if (postC === null) return unfeasible(shell, 'feed-unavailable');
  // `_quoteWithdrawSame` on the post-move books: `exitCap` re-sweeps (`PoolLiquidityLib.sol:495`),
  // so rate and toll both come from the post-move state.
  let tw: bigint | null;
  try {
    tw = await opts.postMoveExitTollWad({
      pool: holder,
      postState,
      tokenIn: targetSym,
      tokenOut: outToken,
      lpAmountIn: lpFaceIn,
      lpAmountOut: q.lpAmountOut,
    });
  } catch {
    return unfeasible(shell, 'backend-error');
  }
  if (tw == null || tw < 0n) return unfeasible(shell, 'toll-pending');
  if (tw >= BigInt(WAD)) return unfeasible(shell, 'toll-exceeds-payout');
  // The second call burns the minted shares (`lpWithdraw`, floored), not the float face: the face is
  // re-floored off them and `mu` (up to `c_leg ≫ 1`) multiplies whole raw units only. The face is
  // `lp · index / WAD` at the index the call READS: `swapLiability` books its LP fee slice (raising the
  // out leg's index) before it prices the mint (`PoolLiquidityLib.sol:663-686`, `idxOut =
  // mintIndex(assetOut)`) and the mint does not move it, so the index is the post-fee `q.indexOutWad`,
  // not the pre-mint one.
  const dOut = toLeg.decimals;
  const exitOut =
    dOut === undefined
      ? sameAssetNetF(exitValue(q.liabOut, legCoverage(toLeg.reserves, outLiab), postC), tw)
      : sameAssetNetRaw(
          sameAssetGrossRaw(
            exitFaceRaw(rawToOut(floorRaw(q.lpAmountOut, dOut), dOut), q.indexOutWad, dOut),
            toLeg.reserves,
            outLiab,
            postC,
            dOut,
          ),
          tw,
          dOut,
        );
  if (!(exitOut > 0)) return unfeasible(shell, 'no-route');
  const gate = gateRecall(liquidFloor(toLeg, exitOut), liquidFence(fromLeg, q.liabIn, c));
  if ('reason' in gate) return unfeasible(shell, gate.reason);
  Object.assign(shell, recallFields(gate.recallLegs));
  // The tail burns what the exit was priced on: the floored share count (raw-exact when decimals).
  const lpWithdraw =
    dOut === undefined ? q.lpAmountOut : rawToOut(floorRaw(q.lpAmountOut, dOut), dOut);
  shell.steps[0].amountOut = q.lpAmountOut;
  shell.steps[0].minOut = q.lpAmountOut * (1 - slip);
  shell.steps[1].amountIn = lpWithdraw;
  shell.steps[1].amountOut = exitOut;
  shell.steps[1].minOut = exitOut * (1 - slip);
  return { ...shell, out: exitOut, minOut: shell.steps[1].minOut, feasible: true };
}

/** Redeem lpFaceIn (LP share units) of targetSym LP, ending in outToken tokens. */
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
    const solv = solvencyGate(holder.state, opts);
    // A same-asset exit is never blocked by the solvency words: with the toll pending, stale, off the
    // chain clock or the pool degraded (a dark leg), the state cannot price it, and the chain's own
    // `previewWithdraw` (the toll it will charge) does. Only an unread preview leaves it unpriced.
    const tw = holder.state.exitTollWad;
    const modelless = solv !== null || tw == null;
    if (!modelless && tw != null && tw >= BigInt(WAD))
      return { best: null, routes: [unfeasible(gated, 'toll-exceeds-payout')] };
    const slip = opts.slippageFrac;
    // `exitMu`: in-kind at `min(c_leg, cap)`, net of the C toll (`_quoteWithdrawSame`).
    const cap = modelless ? 0 : poolExitCap(holder.state);
    const face = (lpFaceIn * (leg.indexWad ?? WAD)) / WAD;
    if (!(face > 0) || face > leg.liabilities)
      return { best: null, routes: [unfeasible(gated, 'insufficient-liability')] };
    const gross = modelless ? 0 : exitValue(face, legCoverage(leg.reserves, leg.liabilities), cap);
    // With wire decimals the chain's integer law: face floored off the raw shares, then `mu`.
    const d = leg.decimals;
    const grossRaw =
      d === undefined || modelless
        ? null
        : sameAssetGrossRaw(
            exitFaceRaw(lpFaceIn, leg.indexWad ?? WAD, d),
            leg.reserves,
            leg.liabilities,
            cap,
            d,
          );
    // Live, fresh solvency words price the model; without them (`modelless`) there is no model.
    let actual = modelless
      ? Number.POSITIVE_INFINITY
      : grossRaw === null || d === undefined
        ? sameAssetNetF(gross, tw as bigint)
        : sameAssetNetRaw(grossRaw, tw as bigint, d);
    if (opts.previewWithdraw && leg.decimals !== undefined) {
      let raw: bigint | null = null;
      try {
        raw = await opts.previewWithdraw(holder, targetSym, lpFaceIn);
      } catch {
        raw = null;
      }
      if (raw != null) {
        // The lower of the two: either alone can run ahead of settlement (the preview arms no band
        // guard; the state model is float books).
        const pv = rawToOut(raw, leg.decimals);
        actual = Math.min(pv, actual);
      }
    }
    // No model and the preview unread: there is no price to show, not a zero one. The reason is the
    // solvency gate's own (pending / stale / clock / feed-unavailable).
    if (!Number.isFinite(actual))
      return { best: null, routes: [unfeasible(gated, solv ?? 'toll-pending')] };
    if (!(actual > 0)) return { best: null, routes: [unfeasible(gated, 'no-route')] };
    // Fence at the pool rate: a degraded pool's book rate is `lastGoodC`, not in state: skipped.
    const c = solv === null ? claimRate(holder.state) : null;
    const gate = gateRecall(
      liquidFloor(leg, actual),
      c === null ? null : liquidFence(leg, face, c),
    );
    if ('reason' in gate) return { best: null, routes: [unfeasible(gated, gate.reason)] };
    Object.assign(gated, recallFields(gate.recallLegs));
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
