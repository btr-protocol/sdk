# Changelog

## Unreleased

### Added

- Depth `step` and the server ladder: `aggregatePairDepthAsync` / `aggregateDepthCurvesAsync` send
  `opts.step` (POST body, only when provided; a non-finite or <= 0 `step` throws RangeError before any request). `AggregatedDepthBook` carries `steps` (server
  ladder), `ladder` (`{ steps, defaultIdx }`, `defaultIdx` = index of the used `step`; null when
  `steps` is absent or `step` is off it), `bid_end` / `ask_end` (`DepthEnd`: `reached_cap` |
  `stopped_on_refusal`; `size` in the to-token). `AggRow` carries `tail` (server remainder row),
  `cum_base` (to), `cum_quote` (from) and `worst`. New fields are validated (also on `aggregateDepthCurvesAsync`, which returns the validated
  wire): a malformed one is absent and a row without finite `price` / `size` / `cum` is dropped. All are absent from a back without them (`steps` absence marks an old back).
  `GateFields`, `DepthGate`, `DepthEnd` and `DepthRowWire` are exported from `amm`.

- Depth gate fields: `aggregatePairDepthAsync` books now carry `swap_gated`, `open_path` and
  `reason` (`string | null`, an open set: today `no_route`, `unread`, `halted`, `unpriced`) from
  `/v1/depth`, inverted books included. One shared `GateFields` / `DepthGate` type in `amm/aimm`
  is extended by the depth, quote, route and chain quote/route wire types.

### Breaking

- `invert: true` (`aggregatePairDepthAsync`, now also `aggregateDepthCurvesAsync`) means something
  else: the request goes out with from/to swapped and the answer is returned as is, instead of
  reciprocating prices client-side (which never re-denominated `size` / `cum`). A caller that already
  swaps from/to AND sets `invert` now gets the original pair back. `step` is in the displayed pair's
  units. Known limits of the swapped request, until the back is fixed: (1) the back composes
  multi-hop detours for (from, to) only when no hub pool has base == `to`, so for a pair held by a
  hub part built with base == your `from`, the forward book has detours and the inverted one does not
  (the two are not reciprocal); (2) a universe with built hub parts of both orientations (base == from and base == to) for the pair is
  reciprocated on neither back and carries no flag. Single-pool-per-pair universes are right on the
  old and the new back (rows on the old back sit on a non-uniform grid).

### Removed

- Local aggregation with no production caller: `aggregate`, `mergeAgg`, `depthLevelsToRows`,
  `invertDepthCurve`, the `Row` / `DepthLevel` / `DepthCurve` types, `AggregateDepthOpts`
  `unit` / `ladder` / `stepIdx`, and the required `bid_net` / `ask_net` on `DepthBookWire` (no back
  serves them; `bidNet` / `askNet` now equal `bid` / `ask`). `stepLadder` stays until the front
  reads the server's `steps`.

### Changed

- Pool `swap` / `deposit` / `withdraw` send with gas LIMIT = `eth_estimateGas` × 1.25, capped at
  16 777 216 (`gasWithBuffer`, exported from `./eth`). The wallet used to estimate on its own with
  no margin: a pool v2 call read one block later can need more gas, and the out-of-gas revert still
  bills the limit. The estimate runs from the connected account.
- `chainQuote` / `chainRoute`: callers can now cap a spread-mode server tolerance with an absolute
  `maxTolPbps` (default 10 000 pbps, 1%; validated to 100..999_000). The policy bound used to scale
  `pct` by the uint16 spread-field maximum, so `pct: 50` on a 459 pbps quote authorized 32 767 pbps
  instead of 229. A served `tol_pbps` is now also capped at `ceil(pct% of the response's
  spread_pbps) + 1`; a backend that lies about the spread remains bounded by the absolute ceiling.
- Exported `slippageTolPbps` so route calldata builders pass the same `maxTolPbps` the quote client
  enforces. Relative-mode slippage is unchanged.
- Spread-mode quotes with `pct% × spread` above 1% now need an explicit `maxTolPbps` above the
  default 10 000 pbps ceiling. Valid quotes above the caller ceiling report `ceiling_exceeded`
  with guidance to raise `maxTolPbps`; malformed spreads and non-positive amounts/floors report
  `floor_violation`.
