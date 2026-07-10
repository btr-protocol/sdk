# @btr-protocol/sdk

Protocol-internal TypeScript SDK for the BTR stack. Single source of truth for ABIs, EVM RPC client, chain registry, token list, and shared helpers — consumed by **front**, **back**, and contract tooling.

Version pinned in `package.json` (`version` field). See `CHANGELOG.md`.

## Purpose

- Framework-agnostic EVM JSON-RPC client (`./eth`) — no `ethers`, no `viem` dep.
- Canonical ABIs (`./abis`) for every deployed BTR DEX contract: AccessControl, Admin, Bridge, BridgeableERC20, Distributor, ExternalOracle, Flash, GovToken, Pool, PoolFactory, Staking, Treasury.
- Pool helpers: data fetch + swap quoting, single-pool, caller supplies the pool address (`./pool`).
- Off-chain AIMM pricer + route-finding: `quoteExactIn`, `enumerateRoutes`, `quoteRoute`, `rankSwap` (best plan incl. order splitting), `aggregateDepth`, plus the `poolStateFrom` on-chain seam (`./amm`).
- Off-chain swap-execution call builder: `planToLegs` maps a `rankSwap` plan to executable legs; `buildSwapCalls` turns legs into a deduplicated, ordered `approve`+`swap` calldata sequence (`./router`).
- Guardians + rewards: `./guardians`, `./rewards`.
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
| `@btr-protocol/sdk` | Curated root re-export (utils, guardians, pool incl. `POOL_ABI`, router, amm, eth) — the other 12 ABIs are `@btr-protocol/sdk/abis`-only, not re-exported at root |
| `@btr-protocol/sdk/abis` | Raw ABIs: `ACCESS_CONTROL_ABI`, `ADMIN_ABI`, `BRIDGE_ABI`, `BRIDGEABLE_ERC20_ABI`, `DISTRIBUTOR_ABI`, `EXTERNAL_ORACLE_ABI`, `FLASH_ABI`, `GOV_TOKEN_ABI`, `POOL_ABI`, `POOL_FACTORY_ABI`, `STAKED_ASSET_ABI`, `STAKING_ABI`, `TREASURY_ABI` |
| `@btr-protocol/sdk/amm` | Off-chain AIMM pricer (`buildLeg`, `quoteExactIn`, `depthCurve`) + route-finding (`enumerateRoutes`, `quoteRoute`, `rankSwap`, `aggregateDepth`) + `poolStateFrom` seam (see below) |
| `@btr-protocol/sdk/eth` | EVM JSON-RPC client, multicall, ERC-20/721/1155/4626/7540/777, OFT, signatures, RLP |
| `@btr-protocol/sdk/guardians` | Circuit-breaker + base guardian |
| `@btr-protocol/sdk/pool` | Single-pool data + tx: `getAsset`, `getCoverageRatio`, `getLPBalance`, `getSwapQuote`, `getPoolData`, `swap`, `deposit`, `withdraw`, `NATIVE_TOKEN` (canonical `POOL_ABI`, `SwapQuote`, `PoolAsset`) |
| `@btr-protocol/sdk/router` | `planToLegs(plan, opts)` + `buildSwapCalls(legs, opts)` + `totalValue(calls)` — route plan → ordered approve+swap calldata. No on-chain router (see below) |
| `@btr-protocol/sdk/rewards` | Merkle proofs, earning/voting damping, distributor helpers |
| `@btr-protocol/sdk/utils` | chains, tokens, constants, encoding, format, math, safe, typing, validation |
| `@btr-protocol/sdk/utils/logger` | logger only |

### Multi-pool routing

There is no on-chain `Router` contract (retired; routing is deliberately off-chain — see `dex/README.md`). Route-finding lives in `./amm`: `enumerateRoutes` (direct + 2-hop shared-anchor), `quoteRoute`, `rankSwap` (best plan, greedy order-splitting across routes when that beats the best single route net of gas), `aggregateDepth`; `poolStateFrom(assets, base, feedOf)` converts on-chain `getPoolData()` reads + per-spoke `LegFeed`s (mark, σ, profile, κ) into the pricer's `PoolState`. `./router` executes: `planToLegs` maps a `rankSwap` plan to `ExecLeg[]` (largest part first, per-leg slippage floors, EIP-7528 native sentinel → `ExecLeg.native`); `buildSwapCalls` emits deduplicated `[approvals…, swaps…]`. Submit atomically via EIP-5792 `wallet_sendCalls` where supported, else sequentially (`Pool.swap` pulls from `msg.sender`, so Multicall3 can't execute the batch); `totalValue` sums the `msg.value` to attach.

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
- `back/` — `@btr-protocol/back` Bun monorepo (collector, agents, docs) via `file:../sdk`

## Remote

No upstream remote configured yet — local-only. Create `btr-protocol/sdk` on GitHub and add origin to publish.
