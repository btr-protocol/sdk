/**
 * Canonical yield-hook vocabulary: SSoT for back (strategies.yaml `kind`) + front
 * (strategy catalog). Hoisted here to kill the 2× duplicated StrategyKind unions.
 *
 * A `YieldHookKind` is a DISPLAY / STRATEGY label, distinct from the on-chain hook
 * CONTRACT it binds to. Venue labels may share an adapter: Euler v2 vaults are ERC-4626,
 * Venus is a Compound v2 fork.
 *
 * kind → on-chain YieldHook adapter:
 *   idle        → (none)               buffer-only, no hook installed
 *   aave-v3     → AaveV3YieldHook
 *   erc4626     → ERC4626YieldHook
 *   euler-v2    → ERC4626YieldHook
 *   venus       → CompoundV2YieldHook
 *   morpho-blue → MorphoBlueYieldHook
 */
export const YIELD_HOOK_KINDS = [
  'idle',
  'aave-v3',
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
  erc4626: 'ERC4626YieldHook',
  'euler-v2': 'ERC4626YieldHook',
  venus: 'CompoundV2YieldHook',
  'morpho-blue': 'MorphoBlueYieldHook',
} as const;
