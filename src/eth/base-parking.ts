/**
 * Base (8453) parking defaults for BTR directional vault keepers.
 *
 * LONG / idle / unlevered: ERC-4626 yield vaults.
 * SHORT collateral: Moonwell mToken markets (supply only — not yield vaults).
 *
 * @see shared/evm/src/config/BaseParking.sol
 */

export const BASE_CHAIN_ID = 8453 as const;

/** LONG / cash parking — ERC-4626 yield vaults */
export const YIELD_VAULTS = {
  USDC: '0x1D3b1Cd0a0f242d598834b3F2d126dC6bd774657' as const, // Clearstar USDC Reactor
  WETH: '0x43Cd00De63485618A5CEEBE0de364cD6cBeB26E7' as const, // Metronome msETH Vault
  CBBTC: '0xdbA76Bc542bb07538e046B40F2e8a215B409F7A8' as const, // Moonwell Frontier cbBTC
} as const;

/** SHORT collateral parking — Moonwell markets only */
export const MOONWELL_MARKETS = {
  USDC: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22' as const,
  WETH: '0xdC7810B47eAAb250De623F0eE07764afa5F71ED1' as const,
  CBBTC: '0xF877ACaFA28c19b96727966690b2f44d35aD5976' as const,
} as const;

export const BASE_ASSETS = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  WETH: '0x4200000000000000000000000000000000000006' as const,
  CBBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as const,
} as const;

export type RouteKind = 'atomic' | 'intent';

/** Levered Morpho flash ⇒ atomic LiFi; unlevered may use intents. */
export function route(levered: boolean): RouteKind {
  return levered ? 'atomic' : 'intent';
}

export function yieldVaultFor(token: string): string | undefined {
  const t = token.toLowerCase();
  if (t === BASE_ASSETS.USDC.toLowerCase()) return YIELD_VAULTS.USDC;
  if (t === BASE_ASSETS.WETH.toLowerCase()) return YIELD_VAULTS.WETH;
  if (t === BASE_ASSETS.CBBTC.toLowerCase()) return YIELD_VAULTS.CBBTC;
  return undefined;
}

export function moonwellMarketFor(token: string): string | undefined {
  const t = token.toLowerCase();
  if (t === BASE_ASSETS.USDC.toLowerCase()) return MOONWELL_MARKETS.USDC;
  if (t === BASE_ASSETS.WETH.toLowerCase()) return MOONWELL_MARKETS.WETH;
  if (t === BASE_ASSETS.CBBTC.toLowerCase()) return MOONWELL_MARKETS.CBBTC;
  return undefined;
}
