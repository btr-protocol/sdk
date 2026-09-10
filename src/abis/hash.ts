/** Content hash of an ABI — the one rule, used by the build script and by the runtime fetch.
 *
 *  The old build-time "integrity" check was a tautology: it recomputed `keccak(pinnedSignature)`
 *  and compared it to the constant it had just hashed, so it only ever proved that keccak works.
 *  What it never checked is that the payload the backend served is the payload this SDK was
 *  reviewed against — a hostile `/v1/abis/Pool` carrying the required signatures plus altered
 *  outputs, altered mutability, or extra entries passed it unchanged.
 *
 *  So the pin is over CONTENT. Entries are normalised (only the fields that change how a call
 *  encodes or a return decodes survive) and sorted by canonical signature, so a re-ordered or
 *  re-annotated but semantically identical ABI keeps its hash while any behavioural change breaks
 *  it. `abis.lock.json` holds the pins; `bun run fetch-abis` refuses anything that misses them.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type Param = { name?: unknown; type?: unknown; components?: unknown; indexed?: unknown };
type Entry = {
  type?: unknown;
  name?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  stateMutability?: unknown;
  anonymous?: unknown;
};

const params = (v: unknown): unknown[] =>
  Array.isArray(v)
    ? v.map((p) => {
        const q = p as Param;
        return {
          n: typeof q.name === 'string' ? q.name : '',
          t: String(q.type ?? ''),
          i: q.indexed === true ? 1 : 0,
          c: q.components === undefined ? null : params(q.components),
        };
      })
    : [];

/** Canonical signature, tuples expanded — the sort key, and what makes ordering irrelevant. */
function sig(e: Entry): string {
  const flat = (v: unknown): string =>
    Array.isArray(v)
      ? v
          .map((p) => {
            const q = p as Param;
            const t = String(q.type ?? '');
            return t.startsWith('tuple') ? `(${flat(q.components)})${t.slice(5)}` : t;
          })
          .join(',')
      : '';
  return `${String(e.type ?? '')}:${String(e.name ?? '')}(${flat(e.inputs)})`;
}

/** Normalised, order-independent content hash of an ABI. */
export function abiHash(abi: readonly unknown[]): `0x${string}` {
  const rows = abi
    .map((raw) => {
      const e = raw as Entry;
      return {
        k: sig(e),
        v: {
          t: String(e.type ?? ''),
          n: typeof e.name === 'string' ? e.name : '',
          i: params(e.inputs),
          o: params(e.outputs),
          m: typeof e.stateMutability === 'string' ? e.stateMutability : '',
          a: e.anonymous === true ? 1 : 0,
        },
      };
    })
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((r) => r.v);
  return `0x${bytesToHex(keccak_256(new TextEncoder().encode(JSON.stringify(rows))))}`;
}
