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

- `fetchAbi('Pool', 143)` → the pinned deployed `pool-v2-s12` ABI; Admin, PoolFactory and
  AccessControl also come from the deployed bundle without network or `localStorage`.
- `fetchAbi(other, 143)` → `GET {api}/v1/abis/{name}?chain_id=143`; content and generation
  are checked against `abis.lock.json.chains[143]`, then cached by API, chain, generation, name.
- Name-only calls retain chain 143 for compatibility. Pass the chain explicitly in new code.
  An unpinned chain requires an explicit expected generation as the third argument; the server
  must confirm it. A different generation for an already pinned chain fails closed.
- `abis.lock.json.bundled` pins the static build-head exports independently. They do not
  identify deployed contracts. At rollout, add reviewed generated deployment JSONs under
  `abis/generations/<generation>`, update that chain's generation and content pins, update
  the deployment bundle imports in `src/abis/fetch.ts`, and run `bun test src/abis`.
  Never relabel build-head data as a deployed generation.
- `fetchVenues()` → `GET {api}/v1/venues` for chains and deployed addresses.
- Quoting / routing → `POST {api}/quote` · `POST {api}/route`.
- Point at your own deployment with `setApiRoot()`.

After a deliberate contract release, re-pin and **review the lock diff** — it is the whole trust
anchor:

```bash
BTR_DEX_EVM=../dex-evm BTR_ABI_UPDATE=1 bun run fetch-abis # re-pin build-head only
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

## Chain quoting trust boundary

`chainQuote` / `chainRoute` reject a server-authored floor (`tol_pbps`) wider than the request's own
slippage policy. Spread mode also takes a caller-owned absolute ceiling:

```ts
await chainQuote({ ...req, slippage: { mode: 'spread', pct: 50, maxTolPbps: 5_000 } });
```

- `maxTolPbps` defaults to **10 000 pbps (1%)** and is validated to `100..999_000`.
- The policy tolerance is `min(MAX_TOL_PBPS, pct% of the spread-field maximum, maxTolPbps)`.
- Spread-mode quote responses must carry a finite `spread_pbps` in `0..65_535`; `tol_pbps` is capped at
  `ceil(pct% of that spread) + 1`, so a plausible spread cannot excuse an enormous tolerance.
- Spread-mode quotes with `pct% × spread` above 1% need an explicit higher `maxTolPbps`. A valid
  quote above that caller ceiling throws `ceiling_exceeded` with guidance to raise `maxTolPbps`.
- Building calldata from `serverFloors` needs the same ceiling as `planToLegs` /
  `planToRouterPlan`'s `maxTolPbps`; `slippageTolPbps(slippage)` returns it.

The SDK bounds the **tolerance only**. `amount_out` itself is server-authored; the caller must
re-price it on chain before signing (the front does). Floor self-consistency does not verify price.
Route floors carry no `spread_pbps`, so their spread policy uses the field maximum plus the caller's
absolute ceiling, without a served-spread check.

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
