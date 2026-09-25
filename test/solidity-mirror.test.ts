/** `src/abis/solidity.generated.ts` against the Solidity it claims to mirror.
 *
 *  The mirror is now GENERATED — `scripts/gen-constants.ts` writes it from `dex-evm/abi/constants.json`,
 *  which `dex-evm/tools/consts.py` emits from the declaring sources. That closes the drift at the
 *  source, but not the loop: a clone with no `dex-evm` sibling keeps the COMMITTED file, so the
 *  committed file is still what a build compiles against and still has to be checked.
 *
 *  So this re-parses the declaring `.sol` independently of the generator and asserts the committed
 *  mirror agrees. An ordinal is exactly the kind of value that moves silently (`OpType` is grouped
 *  by timelock tier, so a member added to a group shifts every ordinal after it) and a wrong one
 *  sends a governance op to the wrong lever, or reads a halt bit that is not the halt bit.
 *  FAILS when the siblings are absent rather than skipping: a skip made the absence of the check
 *  indistinguishable from the check passing, which is how the mirror drifted in the first place.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as M from '../src/abis/solidity.generated';
import { MAX_INTERIOR_SWING_PBPS } from '../src/amm/aimm';
import { V6_MAX_SOURCE_AGE_SECS, V6_SOURCE_TS_FUTURE_SKEW_SECS } from '../src/oracle/wire';
import { MARK_WORD_V4 } from '../src/pool/layout.v4.generated';

const DEX = join(import.meta.dir, '..', '..', 'dex-evm');
const SHARED = join(import.meta.dir, '..', '..', 'shared');
// HARD, not `describe.if`: this file exists to prove the committed mirror still matches the
// Solidity, and a skip proved the opposite of what a green run looked like. CI clones both
// siblings (pinned, see .github/workflows/test.yml); a local run without them is not a run.
if (!existsSync(DEX) || !existsSync(SHARED)) {
  throw new Error(
    'solidity-mirror.test.ts needs the sibling ../dex-evm and ../shared checkouts — ' +
      'clone them beside this repo (CI pins and clones both)',
  );
}

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
  // `\w+` would swallow the `_` in `HALT_ANCHOR_BIT`; numeric separators are stripped per token.
  const toks = expr
    .replace(/\/\/[^\n]*/g, '')
    .trim()
    .match(/<<|\||&|\(|\)|0x[\da-fA-F]+|\d[\d_]*|\w+/g);
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

describe('solidity.generated.ts mirrors the declaring sources', () => {
  const poolConsts = () => constants(src(join(DEX, 'src', 'libraries', 'PoolConstantsLib.sol')));
  const pricingConsts = () => constants(src(join(DEX, 'src', 'libraries', 'PricingLib.sol')));

  test('OpType ordinals match IPool.sol', () => {
    const members = enumMembers(src(join(DEX, 'src', 'interfaces', 'IPool.sol')), 'OpType');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.OpType });
  });

  test('BatchOp ordinals match IAdmin.sol', () => {
    const members = enumMembers(src(join(DEX, 'src', 'interfaces', 'IAdmin.sol')), 'BatchOp');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.BatchOp });
  });

  test('Resource ordinals match shared ErrLib.sol', () => {
    const members = enumMembers(src(join(SHARED, 'evm', 'src', 'ErrLib.sol')), 'Resource');
    expect(Object.fromEntries(members.map((n, i) => [n, i]))).toEqual({ ...M.Resource });
  });

  test('Tier ordinals match shared ConstantsLib.sol', () => {
    const members = enumMembers(src(join(SHARED, 'evm', 'src', 'ConstantsLib.sol')), 'Tier');
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
      'HALT_BIT',
      'HALT_ANCHOR_BIT',
      'HALT_MASK',
      'HALT_SETTABLE_MASK',
      'SWAP_ENABLED_BIT',
      'LIABILITY_SWAP_ENABLED_BIT',
      'FLASH_ENABLED_BIT',
      'TOKEN_EXOTIC_BIT',
      'DEPOSIT_GATED_BIT',
      'SWAP_GATED_BIT',
      'ENABLE_MASK',
      'GATE_MASK',
      'KNOWN_FLAGS_MASK',
      'FEED_HALT_BIT',
      'MAX_CONFIDENCE_HALT_BPS',
      'MAX_DISPERSION_PBPS',
      'INDEX_REASON_DONATE',
      'INDEX_REASON_YIELD',
      'INDEX_REASON_WRITEDOWN',
      'INDEX_REASON_FEE',
      'ORACLE_MODE_EXTERNAL',
      'ORACLE_MODE_INTERNAL',
      'QUOTE_UNIT_ANCHOR',
      'QUOTE_UNIT_UOA',
      'HOOK_PRE_OUTFLOW',
      'HOOK_FLAGS_MASK',
    ] as const) {
      expect([k, c.get(k)]).toEqual([k, M[k]]);
    }
  });

  test('perms lanes match shared ConstantsLib.sol', () => {
    const c = constants(src(join(SHARED, 'evm', 'src', 'ConstantsLib.sol')));
    for (const k of ['PERM_KEEPER', 'PERM_GUARDIAN', 'PERM_RISK_STEWARD'] as const) {
      expect([k, c.get(k)]).toEqual([k, M[k]]);
    }
  });

  test('staleness constants match PricingLib.sol', () => {
    const c = pricingConsts();
    expect(c.get('STALE_Z')).toBe(M.STALE_Z);
    expect(c.get('MAX_STALE_GRACE_SECS')).toBe(M.MAX_STALE_GRACE_SECS);
  });

  test('wire-v6 srcSecs bounds match MarkStore.sol', () => {
    const c = constants(src(join(DEX, 'src', 'oracles', 'MarkStore.sol')));
    expect(c.get('MAX_SOURCE_AGE_SECS')).toBe(V6_MAX_SOURCE_AGE_SECS);
    expect(c.get('FUTURE_SKEW_SECS')).toBe(V6_SOURCE_TS_FUTURE_SKEW_SECS);
  });

  test('MAX_INTERIOR_SWING_PBPS is the PricingLib.sol derivation at AnchorTreeLib.MAX_DEPTH', () => {
    const pricing = src(join(DEX, 'src', 'libraries', 'PricingLib.sol'));
    expect(pricing).toContain(
      'MAX_INTERIOR_SWING_PBPS =\n    (2 * FENCE_BUDGET_PBPS * SC.PBPS) / (2 * SC.PBPS + FENCE_BUDGET_PBPS);',
    );
    const tree = src(join(DEX, 'src', 'libraries', 'AnchorTreeLib.sol'));
    const depth = Number(/MAX_DEPTH = (\d+);/.exec(tree)?.[1]);
    const budget = Math.floor(65_535 / (2 * depth + 1 - 3)); // uint16.max / MAX_INTERIOR_LEGS
    const P = 1_000_000;
    expect(MAX_INTERIOR_SWING_PBPS).toBe(Math.floor((2 * budget * P) / (2 * P + budget)));
  });

  // The source holds the v4 codec; v3's `MARK_WORD` is frozen.
  test('MARK_WORD_V4 offsets match MarkWordLib.sol', () => {
    const c = constants(src(join(DEX, 'src', 'libraries', 'MarkWordLib.sol')));
    for (const [k, v] of Object.entries(MARK_WORD_V4)) expect([k, c.get(k)]).toEqual([k, v]);
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
