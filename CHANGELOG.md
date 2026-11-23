# Changelog

## 0.9.0 - Unreleased

The SDK is the single gateway for every BTR API read, chain read and write (front, CLI, MCP).

### Added

- `api.ts` request family: `btrFetchRaw(path, ApiOpts)` (result carries `headers`), `btrJson`,
  `btrApi(path, chainId, o)`, `btrFetch(url, o)` (raw `Response` with the same 429/timeout
  handling), `fetchJson`, `parseJson`, `HttpError`, `notServed`, `setFetchTimeoutMs`.
- Per-family 429 cooldowns shared by API and chain reads: `familyOf`, `guard429`,
  `noteHttp429`, `note429Error`, `http429Cooldown(family?)`, `http429RemainingMs(family?)`,
  `resetHttp429(family?)`, `retryAfterMs`, `RETRY_AFTER_CAP_MS`.
- `relayProvider(chainId, RelayOpts)` (`/eth`): the one read provider over BTR's `/v1/rpc` relay,
  memoized per (root, chain), JSON-RPC batch + in-flight dedupe; `fresh: true` on a request
  (deposit floor, pre-sign simulation) never joins a duplicate. Contract reads = `multicall` on it.
- `send(provider, calls, SendOpts)` (`/eth`): the one writer (estimate -> buffered gas limit ->
  `eth_sendTransaction` -> receipt), `TxCall`, `SendOpts`, `SendResult`, `TxRevertedError`;
  `decodeRevert(abis, e, label)`.
- Call builders returning `TxCall` (`calls.ts`, root export): `fnCall`, `PoolToken`,
  `batchRiskOpCall`, `claimTreasuryCalls`, `faucetClaimCalls`, `faucetRegisterCall`, `poolExitCall`.
- One encoder per pool write selector (`calldata.ts`): `approveCallData`, `depositCallData`,
  `depositV1CallData`, `withdrawCallData`, `swapLiabilityCallData`.
- `fetchHalts(chainId, scope: HaltScope, query?, o?)` + CLI `halts` / MCP `halts` (404 until the
  gateway route ships).
- `fetchPoolParams`, `fetchDensity`, `fetchOraclePush` take a wire type parameter `<R>`.

### Changed (breaking)
- `send()` is the one writer for wallets too: `opts.stack` (a `SendStack`) carries a wallet UI's hooks (EIP-5792 `wallet_sendCalls` bundle with sequential fallback, preflight, per-call `sendOne` given the only `Broadcast`). `batchModeOf`, `canBundle`, `sendCallsParams`, `isBatchRefused`, `strandingNotice` move here from the front.
- Removed `sendTransaction` (rpc) and `createPrivateKeyClient`/`Client`: use `send(privateKeyProvider(rpcUrl, key, chainId), calls)`.

- `btrFetchRaw` takes `ApiOpts` (fetch/base/query/body/timeoutMs/signal + `RequestInit` fields),
  not `RequestInit`. The old `btrFetch<T>(path, init)` JSON helper is gone: use `btrJson`;
  `btrFetch` now takes a full URL and returns the `Response`.
- `btrApi`, `ApiOpts`, `Query` move from `./protocol` to `./api` (still on the root export);
  `protocol` `io`/`api` helpers removed.
- `LiveOpts` removed: `fetchRoster`, `fetchAbis`, `fetchLiveAbi` and `RegistryOpts` take/extend
  `ApiOpts`; errors read `BTR API <status> <path>`; default timeout 15 s (was 10 s).
- `/amm` `backendBase()` defaults to `${getApiRoot()}/v1`: honours `setApiRoot()`/`BTR_API_URL`;
  env `BTR_API` is no longer read; import throws if `BTR_API` is set without `BTR_API_URL`.
- `withChainId` throws on a non-positive/non-integer chain id (front: module-scope callers fail at
  load on a bad `ACTIVE_CHAIN_ID`).
- `createWalletClient`, `createPublicClient`, `writeContract`, `WriteOptions` removed: write with
  `send()`, read with `relayProvider` + `multicall`/`readContract`.
- `depositCallData`/`swapLiabilityCallData` now live in `calldata.ts` (still re-exported from
  `/router` and the root).
- `batchRiskOpCall` / `claimTreasuryCalls` take the Admin ABI as a required last argument (no
  bundled default: keeps the 176 kB Admin ABI off pages that only build pool exits).
- CLI `rpcProvider` is `relayProvider` (same relay queue as the front).

## 0.8.0 - 2026-11-23

### Added

- Full front parity across SDK, CLI and MCP: typed `/v1` read fetchers (summary, timeseries, activity,
  liquidity, pool params/metrics, density, oracle pushes, safety, assets, md tickers/price/ohlc,
  indicators), `lpRows`, standalone `buildSwapLiabilityCalls`, root `btrFetch`/`btrFetchRaw`/`btrApi`.
- One command table drives both `btr` and `btr-mcp` (41 tools). Builds (`build-swap`, `build-approve`,
  `build-deposit`, `build-withdraw`, `build-debt-swap`) return unsigned `{from,to,data,value}` only.
- LP and debt-swap floors derive from an on-chain preview; `--slippage-bps` (front default/cap),
  MCP cap 500 bps; every build reports `lossBps`.

### Changed (breaking)

- CLI `swap`, `lp deposit|withdraw`, `pools --list` -> `build-swap`, `build-deposit`, `build-withdraw`,
  `pool-list`. MCP `get_registry`, `list_pools`, `get_roster`, `get_abi`, `list_abis` -> `registry`,
  `pool_list`, `roster`, `abi`, `abis`; MCP arg `chainId` -> `chain`. `build-withdraw` takes raw LP shares.

### Fixed

- Route checks refuse non-positive hop amounts, chained-hop amount mismatches and any leg or approval
  above the requested input; swap slippage applies once per route, not per hop.
- CLI RPC calls send `gas` (relay refuses anonymous `eth_call` without it).

## 0.7.0 - 2026-11-22

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
