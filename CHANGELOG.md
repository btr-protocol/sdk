# Changelog

All notable changes to `@btr-protocol/sdk` are documented here.

## [0.3.0] - 2026-05-10

### Changed
- Pool ABI consolidates Liquidity+Exchange (post-Phase 42B.1.5 module merge). `ILIQUIDITY_ABI` + `IEXCHANGE_ABI` exports deprecated -both alias `POOL_ABI` for back-compat. Selectors stable; on-chain interfaces (`ILiquidity`, `IExchange`) remain composite stubs of `IPoolModule`.
- Regenerated `POOL_ABI` and `ROUTER_ABI` from `dex/evm/out/` (post-merge forge build).

### Deprecated
- `ILIQUIDITY_ABI`, `IEXCHANGE_ABI` (re-export `POOL_ABI`). Prefer `POOL_ABI` in new code.

## [0.2.0] - 2026-05-10

### Added
- Additive ABI exports (`Bridge`/`Router`/`Treasury`/`PoolProxy`/`PoolProxyFactory`) post-V1 drop. No selector changes; V-free contract identity in source.
- New `src/abis/{Bridge,Router,Treasury,PoolProxy,PoolProxyFactory}.ts` exporting `BRIDGE_ABI`, `ROUTER_ABI`, `TREASURY_ABI`, `POOL_PROXY_ABI`, `POOL_PROXY_FACTORY_ABI` as `const` arrays.
- TSDoc note on `BRIDGE_ABI`: "LayerZero v2 OApp endpoint" (disambiguates LZ version from BTR contract symbol).

### Changed
- Existing exports (`AIMM_ABI`, `DARKPOOL_ABI`, `POOL_ABI`) unchanged in name and selectors.

## [0.1.0] - 2026-05-09

### Changed
- Extracted from `btr/dex/sdk@1.0.0` into standalone repo at `btr/sdk`.
- Renamed package: `@btr-protocol/sdk` → `@btr-protocol/sdk`.
- Toolchain: bun + biome + tsgo (`@typescript/native-preview`). Dropped `oxlint`, `prettier`, `eslint`, `tsc`.
- Reset version to `0.1.0` to mark new lifecycle.

### Added
- `./rewards` subpath export (Merkle proofs, earning/voting power damping, distributor helpers).
- `biome.json` (single-quote, semicolons, 100-col, organize-imports).
- This `CHANGELOG.md`.

### Removed
- `tsconfig.json` `paths` aliases (`@/...`) -package consumers use the exports map; internal imports are relative.

### Notes
- Source tree (`src/{abis,eth,flows,guardians,oracles,pool,rewards,types,utils}/`) copied verbatim from `btr/dex/sdk/src/`. No behaviour change.
- Old `btr/dex/sdk/` retained until consumers cut over (Phase 32 cleanup).
