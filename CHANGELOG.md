# Changelog

## Unreleased

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
