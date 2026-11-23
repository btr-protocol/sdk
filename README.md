# @btr-protocol/sdk

TypeScript SDK, CLI (`btr`) and MCP server (`btr-mcp`) for the BTR DEX: live reads plus **unsigned** call builders your own wallet signs and sends.

```bash
bun add @btr-protocol/sdk          # npm
bunx jsr add @btr-protocol/sdk     # jsr
```

Runtime: [bun](https://bun.sh) >= 1.1. The package ships TypeScript source; both bins have a bun shebang.
API base `https://api.btr.markets` (override with `BTR_API_URL` or `setApiRoot()`). Agent docs: https://btr.markets/llms.txt

**Nothing here holds a key, signs or broadcasts.** Every build returns `{ to, data, value }` calls; the user's wallet sends them (sequentially or via EIP-5792 `wallet_sendCalls`).

## SDK

| Entrypoint | Contents |
|---|---|
| `.` | Curated root: utils, pool, router, amm, chain client, `protocol` fetchers, venues, oracle, eth |
| `.` (protocol reads) | Typed `/v1/*` reads: `fetchSummary`, `fetchLiquidity`, `fetchHealth`, `fetchPools`, `fetchMdPrice`, `lpRows`, ... |
| `/venues` | `fetchRegistry` (live, checked against baked), `rosterFor`, `fetchLiveAbi`, `fetchAbis` |
| `/pool` | Single-pool chain reads + helpers: `getAsset`, `getLPBalance`, `getSwapQuote`, `sendDeadline` |
| `/router` | Call builders: `buildApprovalCalls`, `buildSwapCalls`, `depositCallData`, `buildSwapLiabilityCalls`, `planToLegs` |
| `/amm` | AIMM types + book-mode fetchers (`/v1/quote`, `/v1/route`, `/v1/depth`) |
| `/eth` | Dependency-free JSON-RPC client (`createHttpProvider`), ABI codec (`encodeFn`), ERC-20, multicall |
| `/abis` | Pinned ABIs (`POOL_ABI`, ...) and `fetchAbi` |
| `/oracle`, `/governance`, `/utils`, `/types` | Signed-quote verification, governance helpers, formatting/math |

Chain-mode quotes (`chainQuote`, `chainRoute`) are exported from the root.

### Read pools / prices

```ts
import { fetchSummary, fetchMdPrice, fetchRegistry } from '@btr-protocol/sdk';

const reg = await fetchRegistry(143);            // contracts, tokens, live pools
const s = await fetchSummary(143, '24h');        // protocol + per-pool/leg APY, TVL, coverage
const px = await fetchMdPrice(143, 'BTC');
```

### Quote

```ts
import { chainRoute } from '@btr-protocol/sdk';

const r = await chainRoute({
  chain_id: 143,
  token_in: reg.tokens.USDC,
  token_out: reg.tokens.WBTC,
  amount_in: `0x${(1_000n * 10n ** 6n).toString(16)}`,
  slippage: { mode: 'relative', pbps: 5_000 },  // 50 bps
});
const floor = r.best?.floors[0];                 // amount_out, min_out, tol_pbps (bounded client-side)
```

`chainRoute` / `chainQuote` reject a server floor wider than your own slippage policy. `amount_out` is server-authored: re-price on chain before signing.

### Route + approve + swap

```ts
import { buildApprovalCalls, buildSwapCalls, type ExecLeg } from '@btr-protocol/sdk/router';

const legs: ExecLeg[] = /* one per hop of r.best.parts: pool, tokenIn, tokenOut, amountIn, minOut, quotedOut */;
const opts = { recipient: user, sender: user };
const approvals = buildApprovalCalls(legs, opts);  // approvals only
const calls = buildSwapCalls(legs, opts);          // deduplicated [...approvals, ...swaps]
await wallet.request({ method: 'wallet_sendCalls', params: [{ from: user, chainId: '0x8f', calls }] });
```

`btr build-swap` (below) is the reference for mapping `r.best.parts` hops to legs (pools and tokens resolved from the live registry, chained hops floored).

### Deposit

```ts
import { encodeFn, ERC20_ABI } from '@btr-protocol/sdk/eth';
import { depositCallData } from '@btr-protocol/sdk/router';

const calls = [
  { to: token, data: encodeFn({ abi: ERC20_ABI, functionName: 'approve', args: [pool, amount] }), value: 0n },
  { to: pool, data: depositCallData(token, amount, minLpOut), value: 0n },  // minLpOut > 0 required
];
```

### Withdraw

```ts
import { POOL_ABI, sendDeadline } from '@btr-protocol/sdk/pool';

const data = encodeFn({ abi: POOL_ABI, functionName: 'withdraw', args: [token, lpAmount, minOut, sendDeadline()] });
const calls = [{ to: pool, data, value: 0n }];
```

Preview the floor first with `Pool.previewWithdraw` (`btr lp-preview`).

### Debt swap

```ts
import { buildSwapLiabilityCalls } from '@btr-protocol/sdk/router';

// Burn FROM-leg LP shares, mint TO-leg shares in the same pool. No approval needed.
const calls = buildSwapLiabilityCalls(pool, { tokenFrom, tokenTo, lpAmountIn, minLpAmountOut });
```

Derive `minLpAmountOut` from `btr debt-swap-quote` (an `eth_call` of the same `swapLiability`).

## CLI

```bash
bunx -p @btr-protocol/sdk btr <cmd> [args] [--chain <id>] [--json] [--trust-live] [--fallback-baked]
```

Text views by default, `--json` for raw data. Exit 0 ok, 1 failure, 2 usage. Live registry data that differs from the baked record, or a failed fetch, is an error unless `--trust-live` / `--fallback-baked`.

| Command | Args | Output | Kind |
|---|---|---|---|
| `pools` | `[--window] [--address 0x..]` | Pool tree: APY, coverage, volume, TVL, LP position | read |
| `metrics` | `[--window]` | Protocol KPIs, per-leg APR split, deployed, TVL | read |
| `risk` | `[--window]` | Coverage, skew, oracle age, deployed per leg | read |
| `flow` | `[--window]` | LP deposits/withdrawals per leg | read |
| `keepers` | | Role Safes, quorum, drift, health, oracle age | read |
| `quote` | `<in> <out> <amount> [--slippage-bps]` | Routed quote + server floor | read |
| `depth` | `<in> <out> --amounts 1,10,100 [--slippage-bps]` | Quote at each size | read |
| `lp-preview` | `<pool> <symbol> <lp-raw>` | `Pool.previewWithdraw` | read |
| `debt-swap-quote` | `<pool> <from-symbol> <to-symbol> <lp-raw> --from` | TO-leg shares minted now | read |
| `lp-rows`, `quote-lp`, `quote-path`, `depth-book`, `timeseries-bulk`, `indicators` | `--body '<json>'` | Raw POST `/v1/*` response | read |
| `timeseries`, `liquidity`, `activity`, `pool-assets`, `pool-metrics`, `oracle-pushes`, `safety-history`, `safety-breakers`, `health`, `assets`, `md-tickers` | `[--params 'k=v&..']` | Raw GET `/v1/*` response | read |
| `pool-params` | `<pool>` | Live risk parameters, every leg | read |
| `density` | `<pair> [--params]` | Observed price density | read |
| `oracle-push` | `<tx> [--params]` | One push: input + signers | read |
| `md-price` / `md-ohlc` | `<symbol>` (`[--params]`) | Market-data price / OHLC | read |
| `registry`, `pool-list`, `roster`, `abis` | | Contracts, tokens, pools, roster, ABI index | read |
| `abi` | `<name>` | ABI JSON | read |
| `build-swap` | `<in> <out> <amount> --from [--slippage-bps]` | Unsigned approve + `swap_qe` calls | build |
| `build-approve` | `<in> <out> <amount> --from [--slippage-bps]` | Unsigned approvals only | build |
| `build-deposit` | `<pool> <symbol> <amount> --from --min-out <raw>` | Unsigned approve + `depositMin` | build |
| `build-withdraw` | `<pool> <symbol> <amount> --from --min-out <raw>` | Unsigned `withdraw` | build |
| `build-debt-swap` | `<pool> <from-symbol> <to-symbol> <lp-raw> --from --min-out <raw>` | Unsigned `swapLiability` | build |

`--window` is `24h | 7d | 30d`. `--from` is the signing wallet: sender and recipient of every output. `--min-out` is a raw positive integer and the only slippage guard on LP builds; derive it from `lp-preview` / `debt-swap-quote` / `quote`.

```bash
btr quote USDC WBTC 1000
btr build-swap USDC WBTC 1000 --from 0xYou --json   # -> { chainId, from, floor, calls: [{to,data,value}] }
```

## MCP

`btr-mcp` serves stdio JSON-RPC (MCP `2024-11-05`). Tools are generated from the same table as the CLI: one tool per command, `-` replaced by `_` (`build_swap`, `debt_swap_quote`, ...). Positional args and `--flags` become same-named properties, plus optional `chain`. Each description is prefixed `[read]` or `[build]`; build tools return unsigned calls only.

| Tool group | Tools |
|---|---|
| Views | `pools`, `metrics`, `risk`, `flow`, `keepers` |
| Quotes | `quote`, `depth`, `lp_preview`, `debt_swap_quote`, `lp_rows`, `quote_lp`, `quote_path`, `depth_book` |
| Wire reads | `timeseries`, `timeseries_bulk`, `liquidity`, `activity`, `pool_assets`, `pool_metrics`, `pool_params`, `density`, `oracle_pushes`, `oracle_push`, `safety_history`, `safety_breakers`, `health`, `assets`, `md_tickers`, `md_price`, `md_ohlc`, `indicators` |
| Registry | `registry`, `pool_list`, `roster`, `abi`, `abis` |
| Builds (unsigned) | `build_swap`, `build_approve`, `build_deposit`, `build_withdraw`, `build_debt_swap` |

```json
{
  "mcpServers": {
    "btr": { "command": "bunx", "args": ["-p", "@btr-protocol/sdk", "btr-mcp"] }
  }
}
```

With npm: `"command": "npx", "args": ["-y", "-p", "@btr-protocol/sdk", "btr-mcp"]` (bun must still be on `PATH`).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) (toolchain, ABI pinning) and [RELEASING.md](RELEASING.md).

## License

MIT
