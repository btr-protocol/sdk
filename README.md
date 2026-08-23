# @btr-protocol/sdk

TypeScript SDK for the BTR stack — a **thin proxy over the backend**, not a second source of truth.

## Single source of truth: the backend

ABIs, quoting, routing and chain/venue config are owned by the **backend** (`btr-quote`, served at
`quote.btr.markets`). The SDK does NOT hard-code a parallel copy. It is a thin wrapper on that API:

- **ABIs** — `fetchAbi('Pool')` → `GET {api}/abis/{name}` (hot + cold cached). Never bundled; the
  wire contract is whatever the backend serves. Mirror on GitHub: `github.com/btr-protocol/abis`.
- **Venues / chains / addresses** — `fetchVenues()` → `GET {api}/venues`. Not hard-coded.
- **Quoting / routing / pricing** — `quoteExactInAsync` / `routeAsync` → `POST {api}/quote` ·
  `POST {api}/route`. The bit-exact integer pricer (`btr-core`) runs on the backend.
- Root URL overridable via `setApiRoot()` so any integrator can point at their own backend.

**We deliberately do NOT maintain a frontend library for quoting/routing/pricing.** One behaviour
change should touch one place (the backend), never a TypeScript port and a Rust mirror that drift.
The `./amm` / `./router` modules here are a LEGACY offline compute surface kept for integrators who
need local quotes without a network; the recommended + maintained path is the backend API.

## Purpose

- Framework-agnostic EVM JSON-RPC client (`./eth`) — no `ethers`, no `viem` dep.
- Lazy ABI + venue fetch (`./abis/fetch`, `./venues/fetch`) — thin, cached, backend-served.
- Shared utils: encoding, validation, math, formatting, logger, constants, chains, tokens (`./utils`).

## Install (workspace `file:` example)

In a consumer `package.json`:

```jsonc
{
  "dependencies": {
    "@btr-protocol/sdk": "file:../sdk"
  }
}
```

Then:

```bash
bun install
```

## Exports

| Subpath | Purpose |
|---|---|
| `@btr-protocol/sdk` | Curated root re-export (utils, pool incl. `POOL_ABI`, router, amm, eth) — the other ABIs are `@btr-protocol/sdk/abis`-only, not re-exported at root |
| `@btr-protocol/sdk/abis` | Raw ABIs: `ACCESS_CONTROL_ABI`, `ADMIN_ABI`, `EXTERNAL_ORACLE_ABI`, `FLASH_ABI`, `LP_TOKEN_ABI`, `POOL_ABI`, `POOL_FACTORY_ABI`, `POOL_HOOKS_ABI` |
| `@btr-protocol/sdk/amm` | Off-chain AIMM pricer (`buildLeg`, `quoteExactIn`, `depthCurve`) + route-finding (`enumerateRoutes`, `quoteRoute`, `rankSwap`, `aggregateDepth`) + `poolStateFrom` seam (see below) |
| `@btr-protocol/sdk/eth` | EVM JSON-RPC client, multicall, ERC-20/721/1155/4626, signatures, RLP |
| `@btr-protocol/sdk/pool` | Single-pool data + tx: `getAsset`, `getCoverageRatio`, `getLPBalance`, `getSwapQuote`, `getPoolData`, `swap`, `deposit`, `withdraw`, `NATIVE_TOKEN` (canonical `POOL_ABI`, `SwapQuote`, `PoolAsset`) |
| `@btr-protocol/sdk/router` | `planToLegs(plan, opts)` + `buildSwapCalls(legs, opts)` + `totalValue(calls)` — route plan → ordered approve+swap calldata. No on-chain router (see below) |
| `@btr-protocol/sdk/utils` | chains, tokens, constants, encoding, format, math, safe, typing, validation |
| `@btr-protocol/sdk/utils/logger` | logger only |

### Multi-pool routing

Routing is deliberately off-chain: there is no on-chain `Router` contract. Route-finding lives in `./amm`: `enumerateRoutes` (direct + 2-hop shared-anchor), `quoteRoute`, `rankSwap` (best plan, greedy order-splitting across routes when that beats the best single route net of gas), `aggregateDepth`; `poolStateFrom(assets, base, feedOf)` converts on-chain `getPoolData()` reads + per-spoke `LegFeed`s (mark, σ, profile, κ) into the pricer's `PoolState`. `./router` executes: `planToLegs` maps a `rankSwap` plan to `ExecLeg[]` (largest part first, per-leg slippage floors, EIP-7528 native sentinel → `ExecLeg.native`); `buildSwapCalls` emits deduplicated `[approvals…, swaps…]`. Submit atomically via EIP-5792 `wallet_sendCalls` where supported, else sequentially (`Pool.swap` pulls from `msg.sender`, so Multicall3 can't execute the batch); `totalValue` sums the `msg.value` to attach.

## Toolchain

- Runtime/bundler: `bun`
- Type checker: `tsgo` (via `@typescript/native-preview`)
- Lint + format: `@biomejs/biome`

```bash
bun install
bun run typecheck
bun run build
bun run test
bun run lint
```

## Generated code (single source of truth)

Everything the SDK knows about the contracts is derived from the sibling forge artifacts, never
written by hand. `scripts/manifest.ts` is the one table saying which artifact backs which export;
`scripts/gen.ts` writes from it:

| Generated | Contents |
|---|---|
| `src/abis/*.ts` + `index.ts` | Contract ABIs, with library-thrown events/errors merged into `POOL_ABI` |
| `src/pool/layout.generated.ts` | `POOL_STORAGE` / `POOL_MAPPINGS` / `POOL_STRUCTS` from solc's `storageLayout` |
| `src/pool/structs.generated.ts` | Per-struct field-name unions + the `Assert`/`FieldsMatch` conformance types |

```bash
cd ../dex/evm && forge build && cd ../../shared/evm && forge build   # artifacts first
bun run gen          # regenerate
bun run gen:check    # verify only — non-zero exit on drift
```

`gen:check` runs as the first step of `bun run build` and `bun run check`, so a contract change that
skips regeneration fails the build instead of shipping a stale wire format. Hand-editing any file
above is always wrong: it is overwritten wholesale and `gen:check` will fail on it.

**Consumers (`back`, `front`, `keepers`) must not keep their own selector or ABI maps.** Import from
`@btr-protocol/sdk/abis` and derive selectors/topic0s at runtime from those ABIs. Four independent
hand-maintained copies of this data have drifted from the contracts and caused real bugs.

## Usage

Single pool — you already know which `Pool` holds the pair:

```ts
import { createHttpProvider } from '@btr-protocol/sdk/eth';
import { getSwapQuote, swap } from '@btr-protocol/sdk/pool';

const provider = createHttpProvider('https://...');

const quote = await getSwapQuote(provider, poolAddress, tokenIn, tokenOut, amountIn);

await swap(provider, poolAddress, {
  tokenIn,
  tokenOut,
  amountIn,
  minAmountOut: quote.amountOut, // apply your own slippage tolerance
  recipient: yourAddress,
});
```

Multi-pool — find the best route, then build calldata:

```ts
import { poolStateFrom, rankSwap } from '@btr-protocol/sdk/amm';
import { buildSwapCalls, planToLegs, totalValue } from '@btr-protocol/sdk/router';

const pools = [{ tag: 'stable', addr: poolAddress, state: poolStateFrom(poolData.assets, 'USDC', feedOf) }];
const ranked = rankSwap(pools, 'WETH', 'USDT', amountInFloat); // direct + 2-hop, may split

const legs = ranked && planToLegs(ranked.best, { slippageFrac: 0.005, tokenOf });
const calls = buildSwapCalls(legs ?? [], { recipient: yourAddress });
// calls = deduplicated [...approvals, ...swaps] — EIP-5792 wallet_sendCalls (value: totalValue(calls)) or sequential
```

## Consumers

- `front/` — `@btr-protocol/front` (Preact SPA) via `file:../sdk`
- `back/` — `@btr-protocol/back` Bun monorepo (collector, data, docs, referrals) via `file:../sdk`
- `keepers/` — `btr-keeper` bots via `file:../../sdk`

Repo: https://github.com/btr-protocol/sdk
