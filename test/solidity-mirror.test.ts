/** `src/abis/solidity.generated.ts` against the Solidity it claims to mirror.
 *
 *  The file's own header says solc keeps neither enum ordinals nor internal constants in the ABI,
 *  "so both are parsed out of the declaring `.sol` file" — but nothing in this repo parses
 *  anything: the mirror is hand-maintained under a GENERATED banner. An ordinal is exactly the
 *  kind of value that moves silently (`OpType` is grouped by timelock tier, so a member added to
 *  a group shifts every ordinal after it) and a wrong one sends a governance op to the wrong
 *  lever, or reads a halt bit that is not the halt bit.
 *
 *  So this is the parser the header promised, run as an assertion instead of a codegen step: the
 *  declaring files stay the single source of truth and the mirror has to agree with them. It reads
 *  the sibling `../dex-evm` and `../shared` checkouts and skips — loudly — when they are absent,
 *  the same posture `fetch-abis.ts` takes for `../back/abis` in a Docker/SDK_REF build.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as M from '../src/abis/solidity.generated';

const DEX = join(import.meta.dir, '..', '..', 'dex-evm');
const SHARED = join(import.meta.dir, '..', '..', 'shared');
const have = existsSync(DEX) && existsSync(SHARED);

const src = (p: string) => readFileSync(p, 'utf8');

/** Members of `enum <name>`, in declaration order — which IS the ordinal order. */
function enumMembers(code: string, name: string): string[] {
  const m = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(code);
  if (!m) throw new Error(`enum ${name} not found`);
  return m[1]
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `uintN internal constant NAME = <expr>;` — expressions are integer literals, shifts and
 *  bit-ors of constants declared earlier, which is all the mirrored ones use. */
function constants(code: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /(?:u?int\d*)\s+(?:internal|private|public)\s+constant\s+(\w+)\s*=\s*([^;]+);/g;
  for (const m of code.matchAll(re)) {
    const v = evaluate(m[2], out);
    if (v !== undefined) out.set(m[1], v);
  }
  return out;
}

/** Tiny integer evaluator: decimal literals (with `_` separators), identifiers already resolved,
 *  `<<`, `|`, `&`, parentheses. Anything else yields undefined and the constant is skipped. */
function evaluate(expr: string, env: Map<string, number>): number | undefined {
  // `\w+` would swallow the `_` in `HALT_RISK_BIT`; numeric separators are stripped per token.
  const toks = expr
    .replace(/\/\/[^\n]*/g, '')
    .trim()
    .match(/<<|\||&|\(|\)|\d[\d_]*|\w+/g);
  if (!toks) return undefined;
  let i = 0;
  const peek = () => toks[i];
  const or = (): number | undefined => {
    let l = and();
    while (l !== undefined && peek() === '|') {
      i++;
      const r = and();
      if (r === undefined) return undefined;
      l |= r;
    }
    return l;
  };
  const and = (): number | undefined => {
    let l = shift();
    while (l !== undefined && peek() === '&') {
      i++;
      const r = shift();
      if (r === undefined) return undefined;
      l &= r;
    }
    return l;
  };
  const shift = (): number | undefined => {
    let l = atom();
    while (l !== undefined && peek() === '<<') {
      i++;
      const r = atom();
      if (r === undefined) return undefined;
      l <<= r;
    }
    return l;
  };
  const atom = (): number | undefined => {
    const t = toks[i++];
    if (t === '(') {
      const v = or();
      if (toks[i++] !== ')') return undefined;
      return v;
    }
    if (t === undefined) return undefined;
    if (/^\d/.test(t)) return Number(t.replace(/_/g, ''));
    return env.get(t);
  };
  const v = or();
  return i === toks.length ? v : undefined;
}

describe.if(have)('solidity.generated.ts mirrors the declaring sources', () => {
  const poolConsts = () => constants(src(join(DEX, 'src', 'libraries', 'PoolConstantsLib.sol')));
  const pricingConsts = () => constants(src(join(DEX, 'src', 'libraries', 'Pricing.sol')));

  test('OpType ordinals match IPool.sol', () => {
    const members = enumMembers(src(join(DEX, 'src', 'interfaces', 'IPool.sol')), 'OpType');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.OpType });
  });

  test('BatchOp ordinals match IAdmin.sol', () => {
    const members = enumMembers(src(join(DEX, 'src', 'interfaces', 'IAdmin.sol')), 'BatchOp');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.BatchOp });
  });

  test('Resource ordinals match shared Errors.sol', () => {
    const members = enumMembers(src(join(SHARED, 'evm', 'src', 'Errors.sol')), 'Resource');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.Resource });
  });

  test('Tier ordinals match shared Constants.sol', () => {
    const members = enumMembers(src(join(SHARED, 'evm', 'src', 'Constants.sol')), 'Tier');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.Tier });
  });

  test('Role ordinals match shared AccessControl.sol', () => {
    const members = enumMembers(
      src(join(SHARED, 'evm', 'src', 'access', 'AccessControl.sol')),
      'Role',
    );
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.Role });
  });

  test('pool flag bits and masks match PoolConstantsLib.sol', () => {
    const c = poolConsts();
    // HALT_MASK is the one that decides whether a leg is tradeable and HALT_SETTABLE_MASK what
    // `setHalt` may clear (the anchor latch is outside it); both are derived on chain from the
    // bits, so they are derived here too rather than copied.
    for (const k of [
      'HALT_RISK_BIT',
      'HALT_GUARDIAN_BIT',
      'HALT_ANCHOR_BIT',
      'HALT_MASK',
      'HALT_SETTABLE_MASK',
      'SWAP_ENABLED_BIT',
      'LIABILITY_SWAP_ENABLED_BIT',
      'FLASH_ENABLED_BIT',
      'FEED_HALT_BIT',
      'MAX_CONFIDENCE_HALT_BPS',
      'MAX_DISPERSION_PBPS',
      'HOOK_PRE_OUTFLOW',
      'HOOK_POST_INFLOW',
    ] as const) {
      expect([k, c.get(k)]).toEqual([k, M[k]]);
    }
  });

  test('staleness constants match Pricing.sol', () => {
    const c = pricingConsts();
    expect(c.get('STALE_Z')).toBe(M.STALE_Z);
    expect(c.get('STALE_GRACE_CAP_SECS')).toBe(M.STALE_GRACE_CAP_SECS);
  });

  test('POOL_SCOPED_OPS is exactly what Admin._keyOf keys without a subject', () => {
    // `_keyOf` returns the subject-free key for these three and only these three; any other op
    // cancelled with `subject = 0` computes a key nothing was queued under.
    const admin = src(join(DEX, 'src', 'Admin.sol'));
    const body = /_keyOf\([^)]*\)[^{]*\{([\s\S]*?)\n {2}\}/.exec(admin)?.[1] ?? '';
    const named = [...body.matchAll(/OpType\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(
      new Set(
        M.POOL_SCOPED_OPS.map(
          (o) => Object.entries(M.OpType).find(([, v]) => v === o)?.[0] as string,
        ),
      ),
    );
  });
});

test.if(!have)('sibling contract checkouts absent — mirror parity NOT verified', () => {
  expect(have).toBe(false);
});
