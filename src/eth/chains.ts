/**
 * Chain Configuration - Canonical Source of Truth for CHAIN METADATA
 * (RPC URLs, explorers, native currency, icons).
 *
 * Deployment facts (contracts, pools, feeds) live in `back`'s registry parsed
 * from `dex-evm/deployments/`; keepers name chains by id in fleet TOMLs only.
 * This file is the single source of truth for chain metadata.
 * The frontend imports from here - do not duplicate in front/.
 */

import { CHAIN_RPCS } from './rpcs.generated';
import type { Address } from './types';

export type { Address } from './types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

const rpcs = (id: number): readonly string[] => CHAIN_RPCS[id] ?? [];

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChainConfig {
  id: number;
  name: string;
  /** Glyph file stem, when it is not the slugged name. Never a path: the renderer owns the
   *  directory and the extension, so one slug serves `/networks/<slug>.svg`, its `-mono` mask
   *  and the rasterised `<slug>.webp` pair. */
  iconSlug?: string;
  /** The chain's top RPCs from the one list (`CHAIN_RPCS`): what `wallet_addEthereumChain` hands the
   *  wallet and what the browser's residual reads hit. Empty when no endpoint passed the last
   *  refresh (an unlaunched chain): the wallet prompt then has nothing to offer. */
  rpcUrls: readonly string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrls?: readonly string[];
  wrappedNative?: Address;
  /** An ERC-20 whose `balanceOf` IS the account's gas balance, viewed at that token's decimals.
   *  Distinct from `wrappedNative`: a wrapper holds a SEPARATE balance you top up on purpose, while
   *  this is the very money the next transaction's fee is taken from. Arc's USDC (`0x3600…`) is the
   *  6-decimal ERC-20 view of the same 18-decimal native balance, and it is also a pool asset, so
   *  spending "all of it" leaves nothing to mine the spend, and `transferFrom` reverts by exactly
   *  the fee. Any surface that offers a MAX on this token MUST reserve gas first. */
  nativeErc20?: Address;
  multicall3?: Address;
  testnet?: boolean;
}

/** Testnet name markers. A testnet has no mark of its own, it wears its mainnet's, so the slug
 *  drops these: "Polygon Amoy Testnet" → polygon. Applied only when `testnet` is set, so a
 *  mainnet whose name happens to carry one of these words keeps its own slug. */
const TESTNET_TOKENS = /\b(testnet|sepolia|amoy|fuji|chapel|holesky|goerli|mumbai)\b/gi;

/**
 * THE glyph file stem for a chain: `bnb-chain` for "BNB Chain".
 *
 * Every icon a chain has is built from this ONE derivation: the SVG path, the `-mono` mask and
 * the rasterised WebP pair `scripts/raster-icons.ts` writes. A caller that slugs a chain name
 * itself is a fork of this waiting to drift.
 */
export function chainIconSlug(chainId: number): string {
  const chain = CHAINS[chainId];
  if (!chain) return 'unknown';
  if (chain.iconSlug) return chain.iconSlug;
  // Auto-compute from name: "BNB Chain" → "bnb-chain"
  const name = chain.testnet ? chain.name.replace(TESTNET_TOKENS, ' ') : chain.name;
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

/** The chain's SVG. Kept for the mask/`<img>` surfaces; raster consumers go through the glyph. */
export function getChainIcon(chainId: number): string {
  return `/networks/${chainIconSlug(chainId)}.svg`;
}

/**
 * The MASKED variant of a chain's glyph: a solid-fill SVG meant to be drawn through a CSS mask
 * and recoloured (`MaskIcon` + `--icon-tint-primary`).
 *
 * It stays an SVG and is deliberately absent from the raster pipeline: a WebP cannot be tinted
 * to `currentColor`. Here rather than at the two call sites that used to spell the `-mono` suffix
 * themselves, so the naming rule lives with the naming rule it mirrors.
 */
export function getChainMonoIcon(chainId: number): string {
  return getChainIcon(chainId).replace(/\.svg$/, '-mono.svg');
}

// ─────────────────────────────────────────────────────────────
// Chain Configurations
// ─────────────────────────────────────────────────────────────

/** The chains BTR serves or will, plus local Anvil. RPC URLs are NOT listed here: `rpcs.generated.ts`
 *  carries each chain's top rows of dex-evm `deployments/chains.json` (`scripts/gen-rpcs.ts`), the one
 *  RPC list. Adding a chain = a row here for its metadata and a refresh of that list. */
export const CHAINS: Record<number, ChainConfig> = {
  1: {
    id: 1,
    name: 'Ethereum',
    rpcUrls: rpcs(1),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    multicall3: MULTICALL3_ADDRESS,
  },

  56: {
    id: 56,
    name: 'BNB Chain',
    rpcUrls: rpcs(56),
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrls: ['https://bscscan.com'],
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    multicall3: MULTICALL3_ADDRESS,
  },

  137: {
    id: 137,
    name: 'Polygon',
    rpcUrls: rpcs(137),
    nativeCurrency: { name: 'Polygon', symbol: 'POL', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    multicall3: MULTICALL3_ADDRESS,
  },

  143: {
    id: 143,
    name: 'Monad',
    rpcUrls: rpcs(143),
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    blockExplorerUrls: ['https://monadvision.com', 'https://monadscan.com'],
    wrappedNative: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
    multicall3: MULTICALL3_ADDRESS,
  },

  196: {
    id: 196,
    name: 'X Layer',
    // OKX's Polygon-CDK zkEVM. Gas is OKB, not ETH: quoting a fee in ETH here is a ~1e3 error.
    rpcUrls: rpcs(196),
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
    blockExplorerUrls: ['https://www.oklink.com/x-layer'],
    wrappedNative: '0xe538905cf8410324e03A5A23C1c177a474D59b2b',
    multicall3: MULTICALL3_ADDRESS,
  },

  999: {
    id: 999,
    name: 'HyperEVM',
    iconSlug: 'hyperevm',
    rpcUrls: rpcs(999),
    nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 },
    blockExplorerUrls: ['https://hyperevmscan.io'],
    wrappedNative: '0x5555555555555555555555555555555555555555',
    multicall3: MULTICALL3_ADDRESS,
  },

  4663: {
    id: 4663,
    name: 'Robinhood Chain',
    // The slug would be `robinhood-chain`; the asset is `robinhood`.
    iconSlug: 'robinhood',
    rpcUrls: rpcs(4663),
    // Arbitrum Orbit L2, ETH gas. No WETH predeploy at 0x42..06 (verified: no code), and no
    // wrapped native is pinned until one is confirmed on-chain.
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
    multicall3: MULTICALL3_ADDRESS,
  },

  5042: {
    id: 5042,
    name: 'Arc',
    iconSlug: 'arc',
    // Chainlist lists mainnet endpoints and several answered eth_chainId 5042 when last probed
    // (2026-10-02). Reachable is not deployed: a `pending` deployment is never selectable.
    rpcUrls: rpcs(5042),
    // Native gas is USDC at 18 decimals; the ERC-20 view at 0x3600… reports 6 for the SAME
    // balance (verified on-chain: eth_getBalance/1e18 == balanceOf/1e6). Mixing the two
    // interfaces in one accounting path is a 1e12 error.
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    // No wrapped native on Arc, so no `wrappedNative`. 0x3600… is Circle's FiatToken ERC-20
    // view of native USDC, NOT a WETH9: its bytecode has no deposit()/withdraw(uint256), and
    // 0x4200…0006 has no code. Pools initialize with wnative=address(0).
  },

  5042002: {
    id: 5042002,
    name: 'Arc Testnet',
    // Order lives in chains.json, not here: blockdaemon leads because it takes the 20k-block
    // eth_getLogs span the admin safety scan sends; rpc.testnet.arc.network caps it near 10k.
    // Never reintroduce invented hosts (rpc.testnet.arc.io, rpc.drpc.testnet.arc.io).
    rpcUrls: rpcs(5042002),
    // See 5042: native is 18 decimals, the ERC-20 view of the same balance is 6.
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    blockExplorerUrls: ['https://testnet.arcscan.app'],
    // No `wrappedNative`: 0x3600… is the ERC-20 USDC view (6d) and the pool base, not a
    // WETH9. No deposit()/withdraw(uint256) in its bytecode; pools use wnative=address(0).
    // It IS the gas balance though, which is a different claim and a live footgun - see
    // `nativeErc20`. Four stablePool deposits reverted TransferFromFailed() on 2026-08 (e.g.
    // 0xbaceb5a8…, 0x706d7a3a…) because MAX seeded the whole USDC balance and the tx's own fee
    // came out of it first: short by exactly gasUsed × gasPrice, then each retry chased the
    // receding balance.
    nativeErc20: '0x3600000000000000000000000000000000000000',
    testnet: true,
  },

  8453: {
    id: 8453,
    name: 'Base',
    rpcUrls: rpcs(8453),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
    wrappedNative: '0x4200000000000000000000000000000000000006',
    multicall3: MULTICALL3_ADDRESS,
  },

  42161: {
    id: 42161,
    name: 'Arbitrum One',
    iconSlug: 'arbitrum',
    rpcUrls: rpcs(42161),
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://arbiscan.io'],
    wrappedNative: '0x82aF49447d8a07e3bd95bd0d56f35241523fbab1',
    multicall3: MULTICALL3_ADDRESS,
  },

  43114: {
    id: 43114,
    name: 'Avalanche C-Chain',
    iconSlug: 'avalanche',
    rpcUrls: rpcs(43114),
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://snowtrace.io'],
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    multicall3: MULTICALL3_ADDRESS,
  },

  31337: {
    id: 31337,
    name: 'Anvil',
    iconSlug: 'anvil',
    rpcUrls: ['http://localhost:8545'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    testnet: true,
  },
};

/**
 * Get chain config by ID
 */
export function getChain(id: number): ChainConfig | undefined {
  return CHAINS[id];
}

/**
 * Get all RPC URLs for chain
 */
export function getAllRpcs(chainId: number): readonly string[] {
  return CHAINS[chainId]?.rpcUrls ?? [];
}

/**
 * Get block explorer URL for chain
 */
export function getExplorerUrl(chainId: number): string | undefined {
  return CHAINS[chainId]?.blockExplorerUrls?.[0];
}

/**
 * Get block explorer URL for a transaction hash on the given chain.
 */
export function getExplorerTxUrl(chainId: number, hash: string): string | undefined {
  const base = getExplorerUrl(chainId);
  if (!base || !hash) return undefined;
  return `${base.replace(/\/$/, '')}/tx/${hash}`;
}

/**
 * Get block explorer URL for an account or token contract address.
 */
export function getExplorerAddressUrl(
  chainId: number,
  address: string,
  kind: 'address' | 'token' = 'address',
): string | undefined {
  const base = getExplorerUrl(chainId);
  if (!base || !address) return undefined;
  return `${base.replace(/\/$/, '')}/${kind}/${address}`;
}

/**
 * Get multicall3 address for chain
 */
export function getMulticall3(chainId: number): Address {
  return CHAINS[chainId]?.multicall3 ?? MULTICALL3_ADDRESS;
}

// ─────────────────────────────────────────────────────────────
// Simplified Chain Info (for UI components)
// ─────────────────────────────────────────────────────────────

export interface ChainInfo {
  id: number;
  name: string;
  icon: string;
  nativeSymbol: string;
}
