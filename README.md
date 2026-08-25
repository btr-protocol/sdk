# @btr-protocol/sdk

TypeScript SDK for BTR — a thin client over the BTR backend.

**The BTR stack is currently closed source.** There is no public contract repository. The SDK
ships no contract source and no build pipeline for one: it talks to the deployed protocol through
the backend API and standard EVM JSON-RPC.

## ABIs come from the backend

ABIs are **fetched at runtime from the backend**, not bundled as a source of truth:

- `fetchAbi('Pool')` → `GET {api}/v1/abis/{name}` (hot + cold cached).
- `fetchVenues()` → `GET {api}/v1/venues` for chains and deployed addresses.
- Quoting / routing → `POST {api}/quote` · `POST {api}/route`.
- Point at your own deployment with `setApiRoot()`.

Static copies of the interfaces under `@btr-protocol/sdk/abis` exist only for offline typing;
the wire contract is whatever the backend serves.

## Install

```jsonc
{
  "dependencies": {
    "@btr-protocol/sdk": "file:../sdk"
  }
}
```

## Exports

| Subpath | Purpose |
|---|---|
| `.` | Curated root re-export (utils, pool, router, amm, eth) |
| `/abis` | Static interface snapshots (`POOL_ABI`, `POOL_FACTORY_ABI`, …) |
| `/amm` | Off-chain AIMM pricer + route-finding (fallback compute; the backend is authoritative) |
| `/eth` | Dependency-free EVM JSON-RPC client, multicall, ERC-20/721/1155/4626, signatures, RLP |
| `/pool` | Single-pool reads + tx builders (`getSwapQuote`, `swap`, `deposit`, `withdraw`) |
| `/router` | Route plan → ordered approve+swap calldata (`planToLegs`, `buildSwapCalls`) |
| `/venues` | Chain / venue registry, backend-fetched with static fallback |
| `/utils` | encoding, validation, math, formatting, logger, constants |

## Usage

Single pool:

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

## Toolchain

Runtime/bundler is [bun](https://bun.sh), type checker is `tsgo`, lint/format is biome.

```bash
bun install
bun run typecheck
bun run test
```

Repo: https://github.com/btr-protocol/sdk

## License

MIT
