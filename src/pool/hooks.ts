/**
 * Canonical yield-hook vocabulary: SSoT for back (strategies.yaml `kind`) + front
 * (strategy catalog). Hoisted here to kill the 2× duplicated StrategyKind unions.
 *
 * A `YieldHookKind` is a DISPLAY / STRATEGY label, distinct from the on-chain hook
 * CONTRACT it binds to: `venus` binds the CompoundV2 adapter (Venus is a Compound v2
 * fork), the only YieldHook adapter dex-evm ships.
 *
 * kind → on-chain YieldHook adapter:
 *   idle  → (none)               buffer-only, no hook installed
 *   venus → CompoundV2YieldHook
 */
export const YIELD_HOOK_KINDS = ['idle', 'venus'] as const;

export type YieldHookKind = (typeof YIELD_HOOK_KINDS)[number];

/** Runtime kind → adapter contract name (`null` = no hook). Mirrors the comment above. */
export const YIELD_HOOK_ADAPTER: Record<YieldHookKind, string | null> = {
  idle: null,
  venus: 'CompoundV2YieldHook',
} as const;
