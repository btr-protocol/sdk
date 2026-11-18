# @btr-protocol/mcp: `btr-mcp`

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server over the public BTR
API, built on `@btr-protocol/sdk` with no other dependency. Tools are the SDK operation table
(`@btr-protocol/sdk/public`), the same one the `btr` CLI runs: `btr_chains`, `btr_venues`,
`btr_registry`, `btr_pools`, `btr_quote`, `btr_route`, `btr_depth`, `btr_marks`, `btr_ohlc`.
Every tool is `readOnlyHint: true` with a closed input schema. No keys, no signing, no
transaction tools.

## stdio (local clients)

```json
{ "mcpServers": { "btr": { "command": "bun", "args": ["/path/to/sdk/mcp/src/bin.ts"] } } }
```

## Streamable HTTP (hosting)

```bash
bun mcp/src/bin.ts --http --host 0.0.0.0 --port 8787 --path /mcp --allow-origin https://app.example
```

Stateless: each `POST` gets an `application/json` JSON-RPC reply; notifications get `202`;
`GET`/`DELETE` are `405` (no server stream, no sessions); `GET /health` is `200`. Browser
`Origin`s are refused unless loopback or in `--allow-origin` (`*` for any); requests without
`Origin` pass. Bodies are capped at 1 MiB. Embed with `mcpFetchHandler(opts)` from
`src/http.ts`, a Web-standard `(Request) => Promise<Response>`.

All clients of one deployment share its egress IP's API rate limit.

Docs: https://btr.markets/docs/5-2-5-mcp-server
