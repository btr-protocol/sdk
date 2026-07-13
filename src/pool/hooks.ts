/**
 * Canonical yield-hook vocabulary — SSoT for back (strategies.yaml `kind`) + front
 * (strategy catalog). Hoisted here to kill the 2× duplicated StrategyKind unions.
 *
 * A `YieldHookKind` is a DISPLAY / STRATEGY label, distinct from the on-chain hook
 * CONTRACT it binds to. Several venue labels intentionally map to a shared adapter:
 * the dedicated `VenusHook` + `EulerV2YieldHook` contracts were deleted (2026-07) once
 * they proved to be exact aliases of the CompoundV2 / ERC4626 adapters — the venue
 * label survives for UI/APR attribution, the adapter is reused.
 *
 * kind → on-chain YieldHook adapter (dex/evm/src/hooks/*):
 *   idle        → (none)               buffer-only, no hook installed
 *   aave-v3     → AaveV3YieldHook
 *   aave-v4     → AaveV4YieldHook      experimental (reserveId ABI)
 *   erc4626     → ERC4626YieldHook
 *   euler-v2    → ERC4626YieldHook     Euler v2 vaults are ERC-4626 (alias hook deleted)
 *   venus       → CompoundV2YieldHook  Venus = Compound v2 fork (alias hook deleted)
 *   morpho-blue → MorphoBlueYieldHook
 */
export const YIELD_HOOK_KINDS = [
  'idle',
  'aave-v3',
  'aave-v4',
  'erc4626',
  'euler-v2',
  'venus',
  'morpho-blue',
] as const;

export type YieldHookKind = (typeof YIELD_HOOK_KINDS)[number];

/** Runtime kind → adapter contract name (`null` = no hook). Mirrors the comment above. */
export const YIELD_HOOK_ADAPTER: Record<YieldHookKind, string | null> = {
  idle: null,
  'aave-v3': 'AaveV3YieldHook',
  'aave-v4': 'AaveV4YieldHook',
  erc4626: 'ERC4626YieldHook',
  'euler-v2': 'ERC4626YieldHook',
  venus: 'CompoundV2YieldHook',
  'morpho-blue': 'MorphoBlueYieldHook',
} as const;
