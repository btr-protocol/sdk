// The read-only operation table behind the `btr` CLI and the BTR MCP server: one name, one
// parameter schema, one SDK call per operation. Both front-ends render from this table, so a
// command and its tool can never drift. No operation signs, holds a key, or builds a transaction.

import { depthAsync } from '../amm/aimm.js';
import type { DepthRequestWire } from '../amm/aimm.js';
import { getApiRoot } from '../api.js';
import { type Slippage, chainQuote, chainRoute } from '../chain/quote.js';
import { DEPLOYED_VENUES } from '../venues/deployments.generated.js';
import { BTR_CHAINS, chainVenue, defaultChainId } from '../venues/registry.js';
import {
  fetchAssetPools,
  fetchChains,
  fetchMarks,
  fetchOhlc,
  fetchPools,
  fetchPrice,
  fetchVenues,
} from './api.js';

type Scalar = 'string' | 'integer' | 'number' | 'boolean';

export interface OpParam {
  type: Scalar | 'array' | 'object';
  description: string;
  /** Element type of an `array` param. */
  items?: { type: Scalar };
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
}

export interface Op {
  name: string;
  description: string;
  params: Record<string, OpParam>;
  required: readonly string[];
  /** CLI positional order; a trailing `array` param takes every remaining positional. */
  positional?: readonly string[];
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** A caller error (bad argument), as opposed to an API or transport failure. */
export class UsageError extends Error {
  override name = 'UsageError';
}

const chainIdParam: OpParam = {
  type: 'integer',
  description: 'EVM chain id. Default: the SDK default chain (first live chain in the registry).',
  minimum: 1,
};

const slippageParams: Record<string, OpParam> = {
  slippagePct: {
    type: 'number',
    description:
      'Spread-mode tolerance: percent of the served spread the floor may give up (server clamps to 10..300). Default 50.',
  },
  slippagePbps: {
    type: 'integer',
    description:
      'Relative-mode tolerance in pbps (1e-6). Overrides slippagePct; 5000 = 0.5%. Range 100..999000.',
    minimum: 100,
    maximum: 999_000,
  },
  maxTolPbps: {
    type: 'integer',
    description: 'Spread mode only: absolute ceiling on the tolerance in pbps. Default 10000 (1%).',
    minimum: 100,
    maximum: 999_000,
  },
};

const chainOf = (a: Record<string, unknown>): number =>
  (a.chainId as number | undefined) ?? defaultChainId();

function slippageOf(a: Record<string, unknown>): Slippage {
  if (a.slippagePbps !== undefined) return { mode: 'relative', pbps: a.slippagePbps as number };
  return {
    mode: 'spread',
    pct: (a.slippagePct as number | undefined) ?? 50,
    ...(a.maxTolPbps !== undefined ? { maxTolPbps: a.maxTolPbps as number } : {}),
  };
}

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** A token address, or a symbol / token key resolved through the SDK registry for `chainId`. */
export function resolveToken(chainId: number, token: string): string {
  if (ADDR.test(token)) return token;
  const v = chainVenue(chainId);
  const want = token.toUpperCase();
  const byKey = Object.keys(v.tokens).filter((k) => k.toUpperCase() === want);
  const keys = byKey.length
    ? byKey
    : Object.keys(v.tokens).filter((k) => v.symbols[k]?.toUpperCase() === want);
  if (keys.length === 1) return v.tokens[keys[0]!]!;
  if (keys.length > 1) {
    throw new UsageError(`token ${token} is ambiguous on chain ${chainId}: ${keys.join(', ')}`);
  }
  throw new UsageError(
    `unknown token ${token} on chain ${chainId}; known: ${Object.keys(v.tokens).join(', ')}`,
  );
}

const RAW_AMOUNT = /^([1-9]\d*|0x0*[1-9a-fA-F][0-9a-fA-F]*)$/;

/** A positive base-unit amount (decimal or 0x) as the `0x` hex the chain endpoints take. */
export function rawAmount(s: string): string {
  if (!RAW_AMOUNT.test(s) || BigInt(s) >= 1n << 256n) {
    throw new UsageError(`amount ${s} must be a positive integer in token base units (< 2^256)`);
  }
  return `0x${BigInt(s).toString(16)}`;
}

export const OPS: readonly Op[] = [
  {
    name: 'chains',
    description: 'Chains the BTR API serves, with default/live flags (GET /v1/chains).',
    params: {},
    required: [],
    run: () => fetchChains(),
  },
  {
    name: 'venues',
    description:
      "The API's deployment registry per chain (GET /v1/venues): contracts, tokens, feeds, pools, and on current backs all_contracts, libraries and superseded generations.",
    params: { chainId: { ...chainIdParam, description: 'Only this chain. Default: every chain.' } },
    required: [],
    positional: ['chainId'],
    run: async (a) => {
      const all = await fetchVenues();
      if (a.chainId === undefined) return all;
      const v = all[String(a.chainId)];
      if (!v) throw new UsageError(`chain ${a.chainId} not in /v1/venues: ${Object.keys(all)}`);
      return v;
    },
  },
  {
    name: 'registry',
    description:
      "The SDK's committed deployment records (offline, no request): every contract, library and role address, tokens, pools, and every generation under versions with status current or superseded.",
    params: { chainId: { ...chainIdParam, description: 'Only this chain. Default: every chain.' } },
    required: [],
    positional: ['chainId'],
    run: async (a) =>
      a.chainId === undefined
        ? { chains: BTR_CHAINS, venues: DEPLOYED_VENUES }
        : chainVenue(a.chainId as number),
  },
  {
    name: 'pools',
    description:
      'Deployed pools: tag, address and symbol roster (GET /v1/pools); with detail, spokes and LP receipts (GET /v1/assets/pools).',
    params: {
      chainId: chainIdParam,
      detail: { type: 'boolean', description: 'Spokes and LP receipts (/v1/assets/pools).' },
    },
    required: [],
    run: (a) =>
      a.detail
        ? fetchAssetPools(a.chainId as number | undefined)
        : fetchPools(a.chainId as number | undefined),
  },
  {
    name: 'quote',
    description:
      "One pool's on-chain swap quote at 1-64 exact-in sizes, with the server's minimum-out floor (POST /v1/chain/quote). Tokens by address or registry symbol; amounts in base units.",
    params: {
      chainId: chainIdParam,
      tokenIn: { type: 'string', description: 'Input token: address or symbol (USDC).' },
      tokenOut: { type: 'string', description: 'Output token: address or symbol (WETH).' },
      amounts: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exact-in sizes in integer base units, decimal or 0x (1000000 = 1 USDC), 1 to 64 of them.',
      },
      pool: { type: 'string', description: 'Pool address. Default: the server picks.' },
      ...slippageParams,
    },
    required: ['tokenIn', 'tokenOut', 'amounts'],
    positional: ['tokenIn', 'tokenOut', 'amounts'],
    run: (a) => {
      const chain = chainOf(a);
      const amounts = (a.amounts as string[]).map(rawAmount);
      if (amounts.length < 1 || amounts.length > 64) {
        throw new UsageError(`amounts takes 1 to 64 sizes, got ${amounts.length}`);
      }
      return chainQuote({
        chain_id: chain,
        token_in: resolveToken(chain, a.tokenIn as string),
        token_out: resolveToken(chain, a.tokenOut as string),
        amounts_in: amounts,
        ...(a.pool !== undefined ? { pool: a.pool as string } : {}),
        slippage: slippageOf(a),
      });
    },
  },
  {
    name: 'route',
    description:
      'Best exact-in itinerary across pools, priced on chain, with end-to-end floors (POST /v1/chain/route). Tokens by address or registry symbol; amount in base units.',
    params: {
      chainId: chainIdParam,
      tokenIn: { type: 'string', description: 'Input token: address or symbol.' },
      tokenOut: { type: 'string', description: 'Output token: address or symbol.' },
      amountIn: {
        type: 'string',
        description: 'Exact-in size in integer base units, decimal or 0x.',
      },
      maxHops: {
        type: 'integer',
        description: 'Longest itinerary, 1 or 2.',
        minimum: 1,
        maximum: 2,
      },
      ...slippageParams,
    },
    required: ['tokenIn', 'tokenOut', 'amountIn'],
    positional: ['tokenIn', 'tokenOut', 'amountIn'],
    run: (a) => {
      const chain = chainOf(a);
      return chainRoute({
        chain_id: chain,
        token_in: resolveToken(chain, a.tokenIn as string),
        token_out: resolveToken(chain, a.tokenOut as string),
        amount_in: rawAmount(a.amountIn as string),
        ...(a.maxHops !== undefined ? { max_hops: a.maxHops as number } : {}),
        slippage: slippageOf(a),
      });
    },
  },
  {
    name: 'depth',
    description:
      'Depth ladder across caller-supplied pool states (POST /v1/depth, a stateless kernel): request = {pools: NamedPoolWire[], from, to, step?}.',
    params: {
      request: {
        type: 'object',
        description: 'The /v1/depth body: {pools, from, to, step?, samples?, max_hops?}.',
      },
    },
    required: ['request'],
    positional: ['request'],
    run: (a) => {
      const r = a.request as Partial<DepthRequestWire>;
      if (!Array.isArray(r.pools) || typeof r.from !== 'string' || typeof r.to !== 'string') {
        throw new UsageError('depth request needs pools (array), from and to (strings)');
      }
      return depthAsync(r as DepthRequestWire, `${getApiRoot()}/v1`);
    },
  },
  {
    name: 'marks',
    description:
      'Market marks. With symbols, the latest bid/mid/ask per symbol (GET /v1/md/price/{sym}); without, every provider ticker (GET /v1/md/tickers, large), optionally filtered by status.',
    params: {
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pair symbols, e.g. BTC-USDC.',
      },
      status: {
        type: 'string',
        enum: ['fresh', 'stale', 'dead'],
        description: 'Ticker list only: keep rows with this status.',
      },
    },
    required: [],
    positional: ['symbols'],
    run: async (a) => {
      const syms = a.symbols as string[] | undefined;
      if (syms?.length) {
        const prices = await Promise.all(syms.map((s) => fetchPrice(s)));
        return Object.fromEntries(syms.map((s, i) => [s, prices[i]]));
      }
      const rows = await fetchMarks();
      return a.status === undefined ? rows : rows.filter((r) => r.status === a.status);
    },
  },
  {
    name: 'ohlc',
    description: 'OHLC bars for one symbol on a tf-second grid (GET /v1/md/ohlc/{sym}).',
    params: {
      symbol: { type: 'string', description: 'Pair symbol, e.g. BTC-USDC.' },
      tf: { type: 'integer', description: 'Bar width in seconds. Default 3600.', minimum: 1 },
      from: { type: 'integer', description: 'Window start, epoch ms.' },
      to: { type: 'integer', description: 'Window end, epoch ms.' },
      limit: { type: 'integer', description: 'Most bars to return.', minimum: 1 },
    },
    required: ['symbol'],
    positional: ['symbol'],
    run: (a) =>
      fetchOhlc(a.symbol as string, {
        tf: (a.tf as number | undefined) ?? 3600,
        from: a.from as number | undefined,
        to: a.to as number | undefined,
        limit: a.limit as number | undefined,
      }),
  },
];

export const opByName = (name: string): Op | undefined => OPS.find((o) => o.name === name);

/** JSON Schema of an operation's arguments (the MCP tool `inputSchema`). */
export function opInputSchema(op: Op): Record<string, unknown> {
  return {
    type: 'object',
    properties: op.params,
    required: [...op.required],
    additionalProperties: false,
  };
}

function scalar(name: string, type: Scalar, raw: unknown, fromText: boolean): unknown {
  let v = raw;
  if (fromText && typeof raw === 'string') {
    if (type === 'boolean') {
      if (raw === 'true' || raw === '') return true;
      if (raw === 'false') return false;
    } else if (type === 'integer' || type === 'number') {
      const n = raw.trim() === '' ? Number.NaN : Number(raw);
      if (Number.isFinite(n)) v = n;
    }
  }
  const ok =
    type === 'integer'
      ? Number.isSafeInteger(v)
      : type === 'number'
        ? typeof v === 'number' && Number.isFinite(v)
        : type === 'boolean'
          ? typeof v === 'boolean'
          : typeof v === 'string';
  if (!ok) throw new UsageError(`${name} must be a${type === 'integer' ? 'n' : ''} ${type}`);
  return v;
}

/**
 * Validate (and with `fromText`, coerce from CLI strings) an argument object against `op`.
 * Unknown keys and missing required keys are refused; numbers are checked against their bounds.
 */
export function checkArgs(
  op: Op,
  input: Record<string, unknown>,
  fromText = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(input)) {
    const p = op.params[k];
    if (!p) throw new UsageError(`${op.name}: unknown argument ${k}`);
    if (raw === undefined) continue;
    let v: unknown;
    if (p.type === 'array') {
      const list = fromText && typeof raw === 'string' ? raw.split(',') : raw;
      if (!Array.isArray(list)) throw new UsageError(`${k} must be an array`);
      v = list.map((x, i) => scalar(`${k}[${i}]`, p.items?.type ?? 'string', x, fromText));
    } else if (p.type === 'object') {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new UsageError(`${k} must be an object`);
      }
      v = raw;
    } else {
      v = scalar(k, p.type, raw, fromText);
    }
    if (typeof v === 'number') {
      if (p.minimum !== undefined && v < p.minimum)
        throw new UsageError(`${k} must be >= ${p.minimum}`);
      if (p.maximum !== undefined && v > p.maximum)
        throw new UsageError(`${k} must be <= ${p.maximum}`);
    }
    if (p.enum && !p.enum.includes(v as string)) {
      throw new UsageError(`${k} must be one of ${p.enum.join(', ')}`);
    }
    out[k] = v;
  }
  for (const k of op.required) {
    if (out[k] === undefined) throw new UsageError(`${op.name}: missing ${k}`);
  }
  return out;
}

/** Validate then run: the single entry point both front-ends call. */
export function runOp(op: Op, input: Record<string, unknown>, fromText = false): Promise<unknown> {
  return Promise.resolve().then(() => op.run(checkArgs(op, input, fromText)));
}
