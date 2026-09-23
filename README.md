# @btr-protocol/sdk

TypeScript SDK for BTR — a thin client over the BTR backend.

**The BTR stack is currently closed source.** There is no public contract repository. The SDK
ships no contract source and no build pipeline for one: it talks to the deployed protocol through
the backend API and standard EVM JSON-RPC.

## ABIs come from the backend, pinned at build time

The backend's getAbi service is the source of truth, and `bun run fetch-abis` bakes its answer
into `src/abis/` before every typecheck, test and build. What makes that safe is `abis.lock.json`:
a normalised content hash per ABI, and nothing is written that misses its pin — not the backend's
answer, not a sibling checkout, not the file already on disk.

- `fetchAbi('Pool' | 'Admin')` → the build-pinned copy, no network, no `localStorage`.
- `fetchAbi(other)` → `GET {api}/v1/abis/{name}`, cached for the session only.
- `fetchVenues()` → `GET {api}/v1/venues` for chains and deployed addresses.
- Quoting / routing → `POST {api}/quote` · `POST {api}/route`.
- Point at your own deployment with `setApiRoot()`.

After a deliberate contract release, re-pin and **review the lock diff** — it is the whole trust
anchor:

```bash
BTR_ABI_UPDATE=1 bun run fetch-abis     # re-pin
BTR_ABI_ALLOW_STALE=1 bun run fetch-abis # offline build against the vendored STALE fallback
```

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
| `/amm` | AIMM types + book-mode fetchers (`/v1/quote`, `/v1/route`, `/v1/depth`); swap pricing = `/v1/chain/*` |
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

Multi-pool — `POST {api}/route` returns the `SwapPlan` (`routeAsync`); build calldata from it:

```ts
import { buildSwapCalls, planToLegs } from '@btr-protocol/sdk/router';

const legs = planToLegs(plan, { slippageFrac, tokenOf, isOfficialPool, serverFloors });
const calls = buildSwapCalls(legs ?? [], { recipient: yourAddress });
// calls = deduplicated [...approvals, ...swaps] — EIP-5792 wallet_sendCalls or sequential
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
