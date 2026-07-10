# @btr-protocol/sdk

Protocol-internal TypeScript SDK for the BTR stack. Single source of truth for ABIs, EVM RPC client, chain registry, token list, and shared helpers — consumed by **front**, **back**, and contract tooling.

Version pinned in `package.json` (`version` field). See `CHANGELOG.md`.

## Purpose

- Framework-agnostic EVM JSON-RPC client (`./eth`) — no `ethers`, no `viem` dep.
- Canonical ABIs (`./abis`) for every deployed BTR DEX contract: AccessControl, Admin, Bridge, BridgeableERC20, Distributor, ExternalOracle, Flash, GovToken, Pool, PoolFactory, Staking, Treasury.
- Pool helpers: data fetch + swap quoting, single-pool, caller supplies the pool address (`./pool`).
- Off-chain swap-execution call builder: turns an already-decided route (a list of pool legs, computed off-chain) into a deduplicated, ordered `approve`+`swap` calldata sequence — does not itself find routes (`./router`).
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
| `@btr-protocol/sdk` | Curated root re-export (utils, guardians, pool incl. `POOL_ABI`, eth) — the other 11 ABIs are `@btr-protocol/sdk/abis`-only, not re-exported at root |
| `@btr-protocol/sdk/abis` | Raw ABIs: `ACCESS_CONTROL_ABI`, `ADMIN_ABI`, `BRIDGE_ABI`, `BRIDGEABLE_ERC20_ABI`, `DISTRIBUTOR_ABI`, `EXTERNAL_ORACLE_ABI`, `FLASH_ABI`, `GOV_TOKEN_ABI`, `POOL_ABI`, `POOL_FACTORY_ABI`, `STAKING_ABI`, `TREASURY_ABI` |
| `@btr-protocol/sdk/eth` | EVM JSON-RPC client, multicall, ERC-20/721/1155/4626/7540/777, OFT, signatures, RLP |
| `@btr-protocol/sdk/guardians` | Circuit-breaker + base guardian |
| `@btr-protocol/sdk/pool` | Pool data fetch + swap quoting, single pool (canonical `POOL_ABI`, `SwapQuote`, `PoolAsset`) |
| `@btr-protocol/sdk/router` | `buildSwapCalls(legs, opts)` — off-chain-computed route → ordered approve+swap calldata. No on-chain router; no path-finding (see below) |
| `@btr-protocol/sdk/rewards` | Merkle proofs, earning/voting damping, distributor helpers |
| `@btr-protocol/sdk/utils` | chains, tokens, constants, encoding, format, math, safe, typing, validation |
| `@btr-protocol/sdk/utils/logger` | logger only |

### Multi-pool routing status

There is no on-chain `Router` contract (retired; routing is deliberately off-chain — see `dex/README.md`). `@btr-protocol/sdk/router` only assembles calldata for a route you've already decided; it does not compare quotes across pools or find multi-hop paths. That path-finding/best-quote logic (direct + 2-hop routes, greedy order-splitting across pools) exists today only in the reference dApp at `front/src/lib/amm/router.ts` — porting it into this SDK (so any integrator, not just the reference front-end, can find the best quote across one or more BTR DEX pools) is a planned but not-yet-done item.

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

Multi-leg — you've already decided the route (e.g. via `front/src/lib/amm/router.ts`'s route-ranking logic) and just need calldata:

```ts
import { buildSwapCalls } from '@btr-protocol/sdk/router';

const calls = buildSwapCalls(
  [
    { pool: poolA, tokenIn, tokenOut: hubToken, amountIn, minOut: hopMinOut },
    { pool: poolB, tokenIn: hubToken, tokenOut, amountIn: hopMinOut, minOut: finalMinOut },
  ],
  { recipient: yourAddress },
);
// calls = deduplicated [...approvals, ...swaps], ready to submit
```

## Consumers

- `front/` — `@btr-protocol/front` (Preact SPA) via `file:../sdk`
- `back/` — `@btr-protocol/back` Bun monorepo (collector, agents, docs) via `file:../sdk`

## Remote

No upstream remote configured yet — local-only. Create `btr-protocol/sdk` on GitHub and add origin to publish.
