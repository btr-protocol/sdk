# @btr-protocol/sdk

Protocol-internal TypeScript SDK for the BTR stack. Single source of truth for ABIs, EVM RPC client, chain registry, token list, and shared helpers — consumed by **front**, **back**, **swap**, and contract tooling.

Version pinned in `package.json` (`version` field). See `CHANGELOG.md`.

## Purpose

- Framework-agnostic EVM JSON-RPC client (`./eth`) — no `ethers`, no `viem` dep.
- Canonical ABIs (`./abis`) for every deployed BTR contract: AccessControl, Admin, Bridge, BridgeableERC20, BtrPoolAdapter, Dex, Distributor, Factory, Flash, GovToken, Pool, PoolFactory, PriceProvider, Router, StakedGov, StakedLP, Staking, Swapper, Treasury, Vault.
- Pool helpers: data fetch + swap quoting (`./pool`).
- High-level flows: swap / deposit / withdraw (`./flows`).
- Oracles + guardians + rewards: `./oracles`, `./guardians`, `./rewards`.
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
| `@btr-protocol/sdk` | Curated root re-export (utils, ABIs, oracles, guardians, pool, eth) |
| `@btr-protocol/sdk/abis` | Raw ABIs: `ACCESS_CONTROL_ABI`, `ADMIN_ABI`, `BRIDGE_ABI`, `BRIDGEABLE_ERC20_ABI`, `BTR_POOL_ADAPTER_ABI`, `DEX_ABI`, `DISTRIBUTOR_ABI`, `FACTORY_ABI`, `FLASH_ABI`, `GOV_TOKEN_ABI`, `POOL_ABI`, `POOL_FACTORY_ABI`, `PRICE_PROVIDER_ABI`, `ROUTER_ABI`, `STAKED_GOV_ABI`, `STAKED_LP_ABI`, `STAKING_ABI`, `SWAPPER_ABI`, `TREASURY_ABI`, `VAULT_ABI` |
| `@btr-protocol/sdk/eth` | EVM JSON-RPC client, multicall, ERC-20/721/1155/4626/7540/777, OFT, signatures, RLP |
| `@btr-protocol/sdk/flows` | High-level swap / deposit / withdraw flows |
| `@btr-protocol/sdk/guardians` | Circuit-breaker + base guardian |
| `@btr-protocol/sdk/oracles` | Binance oracle + base oracle |
| `@btr-protocol/sdk/pool` | Pool data fetch + swap quoting (canonical `POOL_ABI`, `SwapQuote`, `PoolAsset`) |
| `@btr-protocol/sdk/rewards` | Merkle proofs, earning/voting damping, distributor helpers |
| `@btr-protocol/sdk/utils` | chains, tokens, constants, encoding, format, math, safe, typing, validation |
| `@btr-protocol/sdk/utils/logger` | logger only |

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

```ts
import { createHttpProvider, createPublicClient } from '@btr-protocol/sdk/eth';
import { POOL_ABI } from '@btr-protocol/sdk/abis';
import { swap } from '@btr-protocol/sdk/flows';

const provider = createHttpProvider('https://...');
const client = createPublicClient(provider);

await swap(provider, POOL_ABI, {
  poolAddress: '0x...',
  tokenIn: '0x...',
  tokenOut: '0x...',
  amountIn: 1_000_000n,
  slippageBps: 50,
});
```

## Consumers

- `front/` — `@btr-protocol/front` (Preact SPA) via `file:../sdk`
- `back/` — `@btr-protocol/back` Bun monorepo (swap gateway, collector, agents) via `file:../sdk`
- `swap/` — `@btr-supply/swap` aggregator may pull ABIs for quote validation

## Remote

No upstream remote configured yet — local-only. Create `btr-protocol/sdk` on GitHub and add origin to publish.
