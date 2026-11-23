# Contributing

Toolchain: [bun](https://bun.sh) (runtime, tests), `tsgo` (types), biome (lint/format).

```bash
bun install
bun run typecheck
bun run test          # test/solidity-mirror reads BTR_DEX_EVM_SRC (dex-evm sources)
```

The BTR contracts are closed source; the SDK ships no contract source and talks to the deployed
protocol through the backend API and standard EVM JSON-RPC.

## ABIs: pinned at build time

The backend's getAbi service is the source of truth, and `bun run fetch-abis` bakes its answer into
`src/abis/` before every typecheck, test and build. `abis.lock.json` holds a normalised content hash
per ABI; nothing is written that misses its pin (not the backend's answer, not a sibling checkout,
not the file already on disk).

- `fetchAbi(name, chainId)` serves pinned deployed ABIs (Pool, Admin, PoolFactory, AccessControl)
  from the bundle, with no network or `localStorage`.
- A name without a pin in `abis.lock.json.chains[<chain>]` is refused locally and never reaches the
  wire. On an unpinned chain the request is `GET {api}/v1/abis/{name}?chain_id=N&generation=G`,
  checked against G and cached by API, chain, generation, name.
- An unpinned chain requires an explicit expected generation (third argument); the server must
  confirm it. A different generation for an already pinned chain fails closed.
- `abis.lock.json.bundled` pins the static build-head exports independently; they do not identify
  deployed contracts. At rollout: add reviewed generated deployment JSONs under
  `abis/generations/<generation>`, update that chain's generation and content pins and the bundle
  imports in `src/abis/fetch.ts`, then `bun test src/abis`. Never relabel build-head data as a
  deployed generation.

After a deliberate contract release, re-pin and **review the lock diff**: it is the whole trust
anchor.

```bash
BTR_DEX_EVM=../dex-evm BTR_ABI_UPDATE=1 bun run fetch-abis   # re-pin build-head only
BTR_ABI_ALLOW_STALE=1 bun run fetch-abis                     # offline build against the vendored fallback
```

## Chain quoting trust boundary

`chainQuote` / `chainRoute` reject a server-authored floor (`tol_pbps`) wider than the request's own
slippage policy. Spread mode also takes a caller-owned absolute ceiling `maxTolPbps` (see
`DEFAULT_SPREAD_TOL_PBPS` and `slippageTolPbps` in `src/chain/quote.ts`); spread-mode responses
must carry a valid `spread_pbps`, and `tol_pbps` is capped by the requested share of it. Building
calldata from `serverFloors` needs the same ceiling as `planToLegs` / `planToRouterPlan`.
The SDK bounds the tolerance only; `amount_out` must be re-priced on chain before signing.

## CLI / MCP

`src/cli/table.ts` is the one command table: `btr` and `btr-mcp` are both generated from it, so a
capability exists in both or neither. `read` entries only read; `build` entries return unsigned
calls. Command bodies live in `src/cli/cmds.ts`.
