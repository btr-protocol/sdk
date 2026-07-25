// Venue registry + minimal incumbent ABIs for Chapel multi-venue quoting.
// Addresses live in ./chapel.ts (static copy of deploy JSONs).

import type { Abi, Address } from '../eth/index.js';
import {
  CHAPEL_BTR,
  CHAPEL_CURVE,
  CHAPEL_FLUID,
  CHAPEL_UNI_V4,
  CHAPEL_STABLES,
  CHAPEL_TOKENS,
  CHAPEL_VOLATILES,
  CHAPEL_WOMBAT,
  CHAPEL_WOMBAT_TOKENS,
} from './chapel.js';
import {
  SEPOLIA_BTR,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_REF_MARKS_USD,
  SEPOLIA_STABLE_SYMBOLS,
  SEPOLIA_TOKENS,
  SEPOLIA_VOLATILE_SYMBOLS,
} from './sepolia.js';
import { CHAPEL_CHAIN_ID } from './chapel.js';
import { refMarksUsd as chapelRefMarksUsd } from './chapel-usd.js';
import { isZeroAddress, ZERO_ADDRESS, keccak256, type Hex } from '../eth/index.js';
import { sepoliaFeedId } from './sepolia.js';

export type VenueKind = 'btr' | 'curve' | 'uniV2' | 'rangeCl' | 'wombat' | 'fluid';

export interface VenuePool {
  venue: VenueKind;
  tag: string;
  address: Address;
  /** Known tokens (when static); UniV2/Fluid may omit until discovered. */
  tokens?: Address[];
  /** Curve coin indices parallel to `tokens`. */
  coinIndices?: number[];
  fee?: number;
}

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

export const CURVE_ABI: Abi = [
  {
    type: 'function', name: 'get_dy', stateMutability: 'view',
    inputs: [
      { name: 'i', type: 'int128' },
      { name: 'j', type: 'int128' },
      { name: 'dx', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'exchange', stateMutability: 'nonpayable',
    inputs: [
      { name: 'i', type: 'int128' },
      { name: 'j', type: 'int128' },
      { name: 'dx', type: 'uint256' },
      { name: 'min_dy', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'coins', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'balances', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'adminFee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

/** Uniswap V2 pair (vendored). */
export const UNIV2_PAIR_ABI: Abi = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function', name: 'getReserves', stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    type: 'function', name: 'swap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
];

export const UNIV2_FACTORY_ABI: Abi = [
  {
    type: 'function', name: 'getPair', stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pair', type: 'address' }],
  },
];

/** @deprecated — LiteCL removed; kept for transitional imports */
export const LITE_CL_ABI = UNIV2_PAIR_ABI;
export const LITE_CL_FACTORY_ABI = UNIV2_FACTORY_ABI;

export const WOMBAT_ABI: Abi = [
  {
    type: 'function', name: 'quote', stateMutability: 'view',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'swap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
      { name: 'to_', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'cash', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

export const FLUID_ABI: Abi = [
  {
    type: 'function', name: 'quote', stateMutability: 'view',
    inputs: [
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'swap', stateMutability: 'nonpayable',
    inputs: [
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'reserve0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'reserve1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

export const eqAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const hasToken = (tokens: readonly Address[] | undefined, t: Address): boolean =>
  !!tokens?.some((x) => eqAddr(x, t));

// ── Active chain selection ────────────────────────────────────────────────────
// The venue router is single-chain per process. A daemon calls setVenueChain()
// once at boot; every quote/exec selector below reads the active context.
// Default is Sepolia: it is the only deployed venue (Chapel retired 2026-07-25), and
// a caller that forgets setVenueChain() must not silently transact against Chapel
// addresses. Chapel branches below are kept only until the last 97 caller is gone.

let ACTIVE_CHAIN = SEPOLIA_CHAIN_ID;

/** Select the venue chain (11155111 = Sepolia, 97 = Chapel). Call once at boot. */
export function setVenueChain(chainId: number): void {
  ACTIVE_CHAIN = chainId;
}

export function activeChainId(): number {
  return ACTIVE_CHAIN;
}

const symAddrs = (syms: readonly string[]): Address[] =>
  syms.map((s) => SEPOLIA_TOKENS[s]!).filter(Boolean);

/** Sepolia has NO incumbents: venue set = the two BTR cores. Token lists gate
 *  which pool quotes a pair, so dual-listed USDC/USDT quote BOTH pools and the
 *  router picks the better price (best-route across pools). */
function sepoliaVenuePools(): VenuePool[] {
  return [
    { venue: 'btr', tag: 'btr-stable', address: SEPOLIA_BTR.stablePool, tokens: symAddrs(SEPOLIA_STABLE_SYMBOLS) },
    { venue: 'btr', tag: 'btr-volatile', address: SEPOLIA_BTR.volatilePool, tokens: symAddrs(SEPOLIA_VOLATILE_SYMBOLS) },
  ];
}

/** USDC base of the active chain (USDC-hub numeraire). */
export function activeUsdc(): Address {
  return ACTIVE_CHAIN === SEPOLIA_CHAIN_ID ? SEPOLIA_TOKENS['USDC']! : CHAPEL_TOKENS.usdc;
}

/** ExternalOracle address of the active chain. */
export function activeOracle(): Address {
  return ACTIVE_CHAIN === SEPOLIA_CHAIN_ID ? SEPOLIA_BTR.oracle : CHAPEL_BTR.oracle;
}

/** Static USD ref marks (fallback while live oracle is down / stale). */
export function activeRefMarksUsd(): Record<string, number> {
  return ACTIVE_CHAIN === SEPOLIA_CHAIN_ID ? { ...SEPOLIA_REF_MARKS_USD } : chapelRefMarksUsd();
}

/** ExternalOracle getFeed key for a symbol. Chapel derives keccak(asset‖base);
 *  Sepolia uses the registered Pyth-style feedId. null when unknown. */
export function activeFeedId(symbol: string, token: Address): Hex | null {
  if (ACTIVE_CHAIN === SEPOLIA_CHAIN_ID) return sepoliaFeedId(symbol);
  const base = CHAPEL_TOKENS.usdc;
  const packed = `0x${token.slice(2).toLowerCase()}${base.slice(2).toLowerCase()}` as Hex;
  return keccak256(packed);
}

/** Static venue pools for the active chain. Chapel = BTR + Curve + Wombat + Fluid
 *  (+ UniV2 discovered at quote time); Sepolia = BTR cores only. */
export function staticVenuePools(): VenuePool[] {
  if (ACTIVE_CHAIN === SEPOLIA_CHAIN_ID) return sepoliaVenuePools();
  const out: VenuePool[] = [
    {
      venue: 'btr',
      tag: 'btr-stable',
      address: CHAPEL_BTR.stablePool,
      tokens: [...CHAPEL_STABLES],
    },
    {
      venue: 'btr',
      tag: 'btr-volatile',
      address: CHAPEL_BTR.volatilePool,
      tokens: [
        CHAPEL_TOKENS.usdc,
        CHAPEL_TOKENS.usdt,
        CHAPEL_TOKENS.btcb,
        CHAPEL_TOKENS.eth,
        CHAPEL_TOKENS.wbnb,
        CHAPEL_TOKENS.cake,
        CHAPEL_TOKENS.xaut,
      ],
    },
    {
      venue: 'wombat',
      tag: 'wombat',
      address: CHAPEL_WOMBAT,
      tokens: [...CHAPEL_WOMBAT_TOKENS],
    },
  ];

  for (const c of CHAPEL_CURVE) {
    if (isZeroAddress(c.address) || c.address === ZERO_ADDRESS) continue;
    out.push({
      venue: 'curve',
      tag: c.tag,
      address: c.address,
      tokens: [...c.coins],
      coinIndices: c.coins.map((_, i) => i),
    });
  }

  for (const p of [...CHAPEL_UNI_V4.volatilePools, ...CHAPEL_UNI_V4.stablePools]) {
    out.push({
      venue: 'rangeCl',
      tag: p.tag,
      address: p.address,
      tokens: [...p.tokens],
      fee: p.fee,
    });
  }

  for (let i = 0; i < CHAPEL_FLUID.pools.length; i++) {
    out.push({
      venue: 'fluid',
      tag: `fluid-${i}`,
      address: CHAPEL_FLUID.pools[i],
    });
  }

  return out;
}

/** Stable + volatile pairs for UniV2 factory lookup. Sepolia has no incumbents. */
export function uniV2PairCandidates(): { a: Address; b: Address }[] {
  if (ACTIVE_CHAIN === SEPOLIA_CHAIN_ID) return [];
  const toks = [...new Set([...CHAPEL_STABLES, ...CHAPEL_VOLATILES])];
  const pairs: { a: Address; b: Address }[] = [];
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      pairs.push({ a: toks[i], b: toks[j] });
    }
  }
  return pairs;
}

/** @deprecated */
export function liteClPairCandidates(): { a: Address; b: Address; fee: number }[] {
  return uniV2PairCandidates().map((p) => ({ ...p, fee: 3000 }));
}

/** Official UniswapV2Library.getAmountOut */
export function uniV2GetAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}
