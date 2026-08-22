# LP Routing Spec — Liability Transfer Tab + Dual-Route Mint/Redeem

Status: DESIGN ONLY — no implementation yet. Operator review required first.

Repos touched (later): `dex/` (no contract changes needed), `sdk/` (mirror math + router extension),
`front/` (LP modal). Everything below composes existing pool entrypoints.

## 0. Contract surface this spec builds on

All in `dex/evm/src`:

| Entrypoint | Where | Notes |
|---|---|---|
| `Pool.swapLiability(tokenIn, tokenOut, lpAmountIn, minLpAmountOut, deadline) → lpAmountOut` | `Pool.sol:179`, logic `libraries/PoolLiquidity.sol:411-484` | Burns caller's `tokenIn` LP receipt, mints `tokenOut` LP receipt. Moves liabilities only — no reserves move. |
| `Pool.deposit(token, amount)` | `PoolLiquidity.sol:114-170` | Mints `amt·WAD/idx − deadLp` shares at the current index. |
| `Pool.withdraw(token, lp, minOut, deadline)` / `withdrawTo(tokenFrom, tokenTo, …)` | `Pool.sol:141-176`, `PoolLiquidity.sol:251-324` | Cross path (`_quoteWithdrawCross :335`) = from-haircut → mark conversion → mark cap → out-haircut; charges protoFee + spread on output leg. |
| `previewWithdraw(tk, lp)` | `PoolLiquidity.sol:487` | `(amountOut, haircut)` view. |
| `maxRedeem(owner, tk)` | `PoolLiquidity.sol:515` | Folds HALT, index, **anti-JIT frozen shares**, liquid-reserve floor into one capacity number. |

Key semantics of `swapLiability` (cited line ranges above):

1. Both legs must have `LIABILITY_SWAP_ENABLED_BIT` (`PoolConstantsLib.sol:15`, bit 2 of asset
   flags); checked at `PoolLiquidity.sol:423-425`. Disabled ⇒ tab shows the leg as non-transferable.
2. `liabIn = lpAmountIn · idxIn / WAD`; **in-leg coverage haircut** via `applyHaircut(:93)` —
   deficit `(L−R)/L` scaled by `(1 − haircutSuppressorBps/FULL_BPS)`, capped at 100%.
3. Conversion priced by `Pricing.anchorPathQuoteLp`, then **Lemma B mark cap**: output clamped to
   `fairIn · markPrice · 10^(dTo−dFrom)` (`_markCap :379`) — re-denomination credits at oracle mark,
   never the skewed mid.
4. Depeg band guard on both legs (`priceBandGuardAll :452`).
5. **Protocol-fee EXEMPT** and no `accrueLpFee` booking (:454-462 comments): no reserves move, so
   there is nothing to skim. The swapper still pays the full spread (embedded, net). Spread "lands
   as a global coverage gain".
6. **Out-leg haircut applied again** to the converted amount (:464).
7. `lpAmountOut = liabOut·WAD/idxOut − deadOut`; zero-output guard; `minLpAmountOut` checked on what
   the swapper receives (:476).
8. **Anti-JIT interaction (critical)**: the burn is gated by the in-leg lock and the mint arms a
   fresh lock on destination shares (:478-482). `LPToken._armLock` freezes freshly minted shares for
   `flowCooldownSecs` (`LPToken.sol:113-115`), and `_unlockedShares` (`PoolLiquidity.sol:542`)
   returns 0 unlocked for a same-timestamp balance. ⇒ a deposit and a `swapLiability` **cannot
   execute atomically in one batch** for freshly minted shares. See §2.5.

---

## 1. Liability Transfer Tab (in-modal)

### 1.1 UX

Replaces today's third LP tab deep-link. `SwapForm.tsx:788-793` already anticipates this:
*"NOT wired yet: an in-modal swap leg … When that lands, this tab stops navigating and starts
composing."*

- Tabs become `Deposit | Withdraw | Transfer` (label "Transfer", not "Swap" — see disclaimer).
- Pay row: wallet's leg-LP position, shown with the receipt symbol convention (`AUDF.fc`-style,
  `receiptSymbol(lpTag, sym)`, `SwapForm.tsx:841`). Amount input is in **LP shares** (what the
  contract burns), with a face-value readout underneath (`shares · idx/WAD`).
- Receive row: target leg selector (same pool only; legs flagged `LIABILITY_SWAP_ENABLED`), receive
  symbol = `<target>.sc`.
- Max button = min(unlocked shares, `liabIn ≤ L_in` bound). Unlocked shares mirror
  `_unlockedShares`: read the holder's lock slot (`sdk/pool/storage.ts` slot machinery) or gate on
  `maxRedeem(user, token) ≥ amount` (conservative but one multicall read).

### 1.2 Quote — sdk mirror of swapLiability

New module `sdk/src/pool/liability.ts` (pure, testable, same style as `front/src/lib/lpMath.ts`;
state inputs come from `getAsset` via `sdk/pool/index.ts` + the intra-pool quote from
`amm/aimm.quoteExactIn`, which already mirrors `anchorPathQuote`):

```
quoteSwapLiability(inAsset, outAsset, lpAmountIn) -> {
  liabIn            // face burned, in-leg units
  haircutIn         // applyHaircut(liabIn, R_in, L_in, suppressor_in)
  fairIn            // liabIn - haircutIn
  conv              // quoteExactIn(poolState, inTk -> outTk, fairIn): spread/toll/skew embedded
  markCap           // fairIn * q.markPrice * decAdj; conv clamped to it
  haircutOut        // second applyHaircut on the converted amount
  liabOut           // final credited face on the out leg
  lpAmountOut       // liabOut*WAD/idxOut (deadOut ~ 0 on any seeded live leg)
  impactBps         // 1 - lpAmountOut*idxOut / lpAmountIn*idxIn, vs the 1:1-face baseline
}
```

Decomposition shown per row (all four are real components of `impactBps`):
in-leg coverage haircut · conversion spread/impact · mark-cap clamp (when binding) · out-leg
coverage haircut.

Fee breakdown row states explicitly: **protocol fee 0, LP-fee booking none** (contract-exempt, §0.5)
— cost is spread + haircuts only. This distinguishes the tab from market swaps where proto fee +
toll leave the pool.

### 1.3 Slippage guard

`minLpAmountOut = lpAmountOut_quote · (1 − slippageFrac)`, bigint-rounded DOWN (reuse `applySlip`
semantics from `sdk/router/index.ts`). Contract checks it against post-seed received shares
(`PoolLiquidity.sol:476`), so the guard measures exactly what lands in the wallet.
Default slippage 0.5%, same control as the swap form.

### 1.4 Execution

One call — `Pool.swapLiability(tokenIn, tokenOut, lpAmountIn, minLpAmountOut, deadline)`.
No approvals ever (burns own balance, standard ERC-20). Deadline via `defaultDeadline()`.

### 1.5 Disclaimers (modal copy)

- "This moves your liability between legs of ONE pool. It is not a market swap: no reserves trade,
  no counterparty fills, and the pool's inventory does not change."
- "If either leg is under-covered, an exit haircut proportional to its live shortfall applies — on
  the leg you leave, and again on the leg you enter." (Show live numbers when > 0.)
- "Transferred shares restart the anti-JIT cooldown on the destination leg."
- Disabled state when flag bit missing on either leg: "Leg transfers are disabled for <leg>."

---

## 2. Dual-Route Mint / Redeem

### 2.1 Route enumeration

Depositing `token X`, want `target-LP` (X and target both listed in pool P — single-pool scope;
cross-pool is explicitly out of scope v1):

- **Route A (market-first)**: `rankSwap(X → target)` over the fleet (`amm/router.rankSwap`, reuse
  splits/water-fill unchanged) → best plan → `Pool.swap(X→target)` legs → `Pool.deposit(target, amt)`.
- **Route B (deposit-first)**: `Pool.deposit(X, amt)` → X-LP →
  `Pool.swapLiability(X, target, lpX, minLpT)` → target-LP.

Redeeming `target-LP`, want `token Y`:

- **Route A′ (one-call cross exit)**: `Pool.withdrawTo(target, Y, lpTarget, minY)` — the cross
  withdraw IS the market route fused into one call (from-haircut → anchor-path conversion with fees
  → mark cap → out-haircut).
- **Route B′ (transfer-first)**: `Pool.swapLiability(target, Y, lpTarget, minLpY)` → Y-LP →
  `Pool.withdraw(Y, lpY, minY)` (same-asset exit: haircut only, no spread/proto fee).

### 2.2 Comparison metric

Both routes terminate in the SAME instrument (target-LP for mint, Y tokens for redeem), so the
primary key is directly comparable:

```
mint:   maximize lpTarget_out          // face, target units — identical receipts
redeem: maximize amountOut_Y           // Y units
```

Normalize by face/mark only when presenting (USD value of the result) or if a future variant ends in
different pools' receipts: value = `lp · idx/WAD · mark_to_USD`. The comparison must use the
*mirrors*, never mixed f64/bignum results: quote both routes through the same bigint liability
mirror (§1.2) and the same `quoteExactIn` path so shared terms cancel. Tiebreak: fewer legs (gas).

### 2.3 Where it lives

- New `sdk/src/router/lpRoutes.ts`: `rankDeposit(pools, xToken, targetSym, amountIn, opts)` /
  `rankRedeem(...)` returning `{ best: LpPlan, routes: RankedLpRoute[] }` where each route carries
  per-leg amounts, per-leg guards (minOut / minLpAmountOut), feasibility flags, and its ExecCall
  list. It calls `amm/router.rankSwap` for Route A's market leg — no fork of that logic.
- Calldata builders extend `sdk/src/router/index.ts` (same file, beside `buildSwapCalls`):
  `buildDepositCalls` / `buildRedeemCalls` reuse `ExecCall`, `buildApprovalCalls`,
  `defaultDeadline`. Do NOT duplicate approval/wrap logic.

### 2.4 EIP-5792 batch composition

No on-chain router exists (`sdk/router/index.ts` header); batches originate from the user account.

| Plan | Calls |
|---|---|
| Mint A | `[approve(X→pool)?, swap(X→target)…, deposit(target)]` — swap legs reuse `buildSwapExecCalls`; deposit needs no extra approval beyond the swap's (same spender). |
| Mint B | `[approve(X→pool)?, deposit(X), swapLiability]` — one approval total: LP burn needs no allowance. |
| Redeem A′ | `[withdrawTo]` — single call, no approvals. |
| Redeem B′ | `[swapLiability, withdraw]` — no approvals. |

Atomicity: strongly prefer `wallet_sendCalls`; sequential fallback is acceptable because every leg
carries its own slippage floor and a failed later leg leaves earlier value as *usable* intermediate
holdings (target tokens or LP), not dust. Exception: §2.5 makes Mint B / Redeem B′ non-batchable for
fresh flows anyway.

### 2.5 Failure modes & constraints

- **Anti-JIT lock breaks Route B/B′ for fresh capital.** A same-timestamp deposit arms
  `frozen = minted` (`LPToken.sol:113`); `_unlockedShares` then returns 0, so an atomic
  `deposit → swapLiability` reverts, and `swapLiability → withdraw` likewise (the transfer just
  armed the out-leg lock). Consequences, spec'd as behavior:
  - Router gates Route B on pre-existing seasoned X-LP: unlocked shares (via `maxRedeem`) ≥ needed.
    Users with existing positions get true dual-route; brand-new deposits effectively have only
    Route A until `flowCooldownSecs` passes.
  - The modal must NOT present Route B as executable when gated off — show "available after
    cooldown" instead of quoting a route the batch would revert.
- **Coverage haircuts differ per leg and per side**: Route B eats the in-leg haircut on X plus
  out-leg haircut on target; Route A eats neither. Under-covered X ⇒ Route A usually wins mint;
  under-covered target ⇒ Route B can win even paying double haircut, because Route A buys an
  under-covered leg's tokens at a skew premium that the transfer reprices at oracle mark.
- **Mark cap binding** (Lemma B): when adaptive dispersion pushes the mid past the mark, Route B's
  quoted conversion clamps — the router must quote the clamped number, and the UI should show the
  clamp rather than hide it inside impact.
- **Depeg bands / HALT**: any leg halted or out of band kills all routes touching it; surface which
  leg, not a generic revert.
- **minLiquidity / reserve clip**: Route A can hit the `R==0 && L!=0` deposit rejection
  (`PoolLiquidity.sol:143`) or the cov-wall; Route A′ hits `maxRedeem`'s liquid floor. Per-leg
  minOut floors stay as today; add per-route capacity from `quote.maxIn` / `maxRedeem` so the picker
  drops infeasible routes instead of picking them.

---

## 3. Modal Integration

Deposit tab gains a **target-LP selector** (defaults to pay-leg receipt; lists every enabled leg of
the pool, receipt-symbol style). Details block renders the chosen route:

- Route A: "Market-swap 1,000 AUDF → 998.2 USDC.b (route/stable, impact 12 bp), then deposit →
  998.1 USDC.b.fc" with per-leg amounts and per-leg minOut.
- Route B: "Deposit 1,000 AUDF → 1,000.0 AUDF.fc, transfer liability → 996.9 USDC.b.fc
  (haircut-in 30 bp, spread 8 bp, haircut-out 22 bp)" — hidden/greyed with reason when locked or
  flag-disabled.
- A "compare routes" toggle (operator mode initially) shows the losing route's number too.

Withdraw mirrors: receive-asset selector already exists for cross-withdraw (`withdrawOutSym`,
`SwapForm.tsx:289-296`); extend it to offer Route B′ and render the same per-leg breakdown.
Receipt symbols follow the existing `.sc` convention everywhere.

---

## 4. Expert Debate (recorded tradeoffs)

**Price impact of swapLiability vs market spread.**
Pro-transfer: it moves no reserves, so it cannot walk the book; cost is bounded by two coverage
haircuts plus the quoted spread, and it is protocol-fee-free. Pro-market: a market swap actually
rebalances inventory (earns/costs the spread honestly), while the transfer's spread is a paper charge
that lands as a global coverage gain — cheap for the swapper when the pool is balanced, but it does
not improve the leg it leaves except by shrinking liabilities.

**When each route wins.**
Mint: Route A wins when X is under-covered (avoid its haircut) and the market leg is small relative
to depth; Route B wins when the target leg is under-covered (buying it via swap costs the skew
premium that a liability transfer reprices at mark) and the user already holds seasoned X-LP.
Redeem: A′ (single `withdrawTo`) wins on gas and when the target leg is healthy; B′ wins when the
*destination* leg is under-covered — transfer first, then exit the healthier leg with haircut-only
costs, skipping the cross-exit's proto fee + output-leg spread. All of this flips on live coverage,
so the router must re-quote per submission, never cache across blocks.

**Failure modes.**
(a) Anti-JIT lock makes both liability routes non-atomic for fresh capital (§2.5) — the sharpest
edge found in this design pass; gating on `maxRedeem` is the mitigation, and any future "allow
same-tx transfer of just-minted shares" is a CONTRACT change requiring its own audit, not a frontend
workaround. (b) Mark cap binding turns a quoted gain into a clamp between quote and send — covered
by minLpAmountOut. (c) Coverage ratios move between quote and execution; both haircuts are
recomputed on-chain, so slippage tolerance must absorb haircut drift, not just price drift.
(d) Flag/halt/band states flip per leg — fail closed with named reasons. (e) Split plans from
`rankSwap` composing into a deposit: sum-of-parts deposit is fine (deposits are linear), but each
part's minOut compounds — keep per-part floors, never one blended floor.

**Slippage guards per leg.**
Market legs keep exact-amount `minOut` floors (bigint, round down). Liability legs use
`minLpAmountOut` measured on received shares post-dead-seed. Deposits get NO price guard (they mint
at current index by design — contract comment at `Pool.sol:150`) but DO get the `R==0/L≠0` and
dust-share reverts surfaced as pre-checks. Every composed batch keeps deadlines from
`defaultDeadline()`, one shared value per atomic batch.
