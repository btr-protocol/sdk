# @btr-protocol/cli: `btr`

Read-only command line over the public BTR API (`https://api.btr.markets/v1`), built on
`@btr-protocol/sdk`. No keys, no signing, no transactions. Every command is one entry of the SDK
operation table (`@btr-protocol/sdk/public`), the same table the MCP server exposes as tools.

```bash
bun install                      # at the sdk repo root
bun cli/src/bin.ts --help
alias btr="bun $PWD/cli/src/bin.ts"
```

| Command | API |
|---|---|
| `btr chains` | `GET /v1/chains` |
| `btr venues [chainId]` | `GET /v1/venues` (incl. `all_contracts`, `superseded` where served) |
| `btr registry [chainId]` | SDK deployment records, offline: every contract, library, role, and every generation (`current` / `superseded`) |
| `btr pools [--chain N] [--detail]` | `GET /v1/pools` · `GET /v1/assets/pools` |
| `btr quote <in> <out> <amounts...>` | `POST /v1/chain/quote` |
| `btr route <in> <out> <amount> [--max-hops 1\|2]` | `POST /v1/chain/route` |
| `btr depth <file\|->` | `POST /v1/depth` (body = caller-supplied pool state) |
| `btr marks [symbols...] [--status fresh\|stale\|dead]` | `GET /v1/md/price/{sym}` · `GET /v1/md/tickers` |
| `btr ohlc <symbol> [--tf 3600] [--from ms] [--to ms] [--limit n]` | `GET /v1/md/ohlc/{sym}` |

- Tokens: address or registry symbol (`USDC`). Amounts: integer base units, decimal or `0x`.
- Slippage (quote/route, shapes `min_out` only): `--slippage-pct` (spread mode, default 50),
  `--max-tol-pbps`, or `--slippage-pbps` (relative).
- Output: tables / key-value for reading; `--json` prints the API response unchanged.
- Exit codes: `0` ok, `1` API or network failure, `2` usage error.
- `--api <url>` or `BTR_API_URL` selects another gateway root.

Docs: https://btr.markets/docs/5-2-4-cli
