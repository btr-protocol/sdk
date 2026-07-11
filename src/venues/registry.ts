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
import { isZeroAddress, ZERO_ADDRESS } from '../eth/index.js';

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

/** Static venue pools (BTR + Curve + Wombat + Fluid). LiteCL discovered at quote time. */
export function staticVenuePools(): VenuePool[] {
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

/** Stable + volatile pairs for UniV2 factory lookup. */
export function uniV2PairCandidates(): { a: Address; b: Address }[] {
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
