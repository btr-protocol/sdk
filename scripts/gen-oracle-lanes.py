#!/usr/bin/env python3
"""Regenerate src/venues/oracle-lanes.generated.ts from the dex-evm lane records.

Inputs (SoT): dex-evm/deployments/<slug>-oracle-v<n>-lanes.json - the exact name the ceremony
writes (`OracleLaneDeployBase._lanesPath`, off `.chain.slug`) - plus that chain's deployed oracle
addresses (<chainId>.deploy.v<n>[ref].json). Run from sdk/: python3 scripts/gen-oracle-lanes.py

THE CHAIN LIST IS DATA, NOT A CONSTANT IN THIS FILE. The output is rewritten whole, so a hard-coded
default list is a script that silently DELETES every chain it does not happen to name. A bare run
takes every lane record present on disk - which is exactly the set of fleets that have been
deployed - so landing a second chain needs no edit here and cannot drop the first. An argument
FILTERS that set by chain id (for inspecting one fleet); a chain named with no lane record is an
error, never an empty output.

Every generation deploys TWO instances off one lane layout - the PRIMARY every pool leg reads and
the REFERENCE that prices the non-base spokes - so each lane record emits two maps, one per
address. The pair is not a copy: `oracleLaneMap` joins on the address, which is what lets both
instances of a generation, and two generations mid-cutover, coexist with no code change.
"""

import glob
import json
import os
import sys

DEX = os.path.join(os.path.dirname(__file__), "../../dex-evm/deployments")
OUT = os.path.join(os.path.dirname(__file__), "../src/venues/oracle-lanes.generated.ts")

# wire tag -> (deploy-record stem, lanes/slot, EIP-712 domain name). A generation earns a row only
# while some address a client can be pointed at still speaks it; V2/V3 were dropped when the last
# Arc leg was repointed off them (5042002.pools.json records V4 for both primary and reference).
GENERATIONS = [
    ("v5", "v4", 8, "BTR ExternalOracleV4"),
]


def lane_records(stem):
    """Every deployed chain's lane record for one generation, sorted so the output order is stable.
    The slug in the name is the ceremony's and nothing here needs to know it: each record states
    its own `chainId`, which is what the maps and the deploy-record names are keyed on."""
    return sorted(glob.glob(os.path.join(DEX, f"*-oracle-{stem}-lanes.json")))


def load(path):
    with open(path) as f:
        return json.load(f)


def feeds_ts(d):
    """Lane rows, ascending by globalIndex. A symbol that is a valid JS identifier is emitted
    UNQUOTED so the output is already what the repo formatter would produce - a generated file
    that a `biome check` wants to rewrite is a generated file someone will hand-edit."""
    rows = []
    for sym, f in sorted(d["feeds"].items(), key=lambda kv: kv[1]["globalIndex"]):
        ref = ", ref: true" if f.get("ref") else ""
        key = sym if sym.isidentifier() else f"'{sym}'"
        rows.append(
            f"      {key}: {{ globalIndex: {f['globalIndex']}, expBias: {f['expBias']}, cls: '{f['cls']}'{ref} }},"
        )
    return "\n".join(rows)


def map_ts(wire, lanes, addr, per_slot, domain, role):
    return f"""  {{
    chainId: {lanes['chainId']},
    wire: '{wire}',
    role: '{role}',
    oracle: '{addr}',
    lanesPerSlot: {per_slot},
    domainName: '{domain}',
    feeds: {{
{feeds_ts(lanes)}
    }},
  }},"""


want = set(sys.argv[1:])
seen = set()

maps = []
for wire, stem, per_slot, domain in GENERATIONS:
    by_chain = {}
    for path in lane_records(stem):
        lanes = load(path)
        chain = str(lanes["chainId"])
        # Two records claiming one chain would emit two maps for the same addresses, and the
        # `oracleLaneMap` lookup would silently answer with whichever sorted first.
        if chain in by_chain:
            raise SystemExit(
                f"{os.path.basename(path)} and {os.path.basename(by_chain[chain])} both declare chainId {chain}"
            )
        by_chain[chain] = path
        if want and chain not in want:
            continue
        seen.add(chain)
        for role, suffix in (("primary", ""), ("reference", "ref")):
            rec = os.path.join(DEX, f"{chain}.deploy.{stem}{suffix}.json")
            if not os.path.exists(rec):
                continue
            maps.append(map_ts(wire, lanes, load(rec)["oracle"], per_slot, domain, role))

# An unmatched filter would quietly rewrite the file with fewer chains than the operator asked for.
if want - seen:
    raise SystemExit(f"no lane record in {DEX} for chain(s) {', '.join(sorted(want - seen))}")
if not maps:
    raise SystemExit(f"no lane records in {DEX} - refusing to write an empty map table")

body = "\n".join(maps)

out = f"""// Oracle lane maps for the packed-slot push oracles, per chain.
// GENERATED from the dex-evm lane records (<slug>-oracle-v<n>-lanes.json) - never hand-edited.
// Regenerate: sdk/scripts/gen-oracle-lanes.py - it emits EVERY deployed chain, so a bare run is
// always the whole table; an optional chain-id argument only filters it for inspection.
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` governs the lane price decode (mantissa << (exp + bias)); it is per encode class up to
// V3 and PER FEED from V4 (bias = bitLength(mark1e18) - 32, which pins exp = 7 on every feed). It
// is corrected on-chain via setFeedExpBias, so a drifted bias means REGENERATING this file.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// A generation appears TWICE, once per deployed instance (`role`): the primary every pool leg
// reads, and the reference that prices non-base spokes. Generations overlap during a cutover, so
// more than one map can be live at a time - always join on the ADDRESS, never on the wire tag.

import type {{ Address }} from '../eth/types.js';

/** Wire generation. The tag is the BLOB version byte, not the contract's name:
 *  ExternalOracleV3 speaks wire 'v3' (blob version 4), ExternalOracleV4 speaks 'v5'. */
export type OracleWire = 'v2' | 'v3' | 'v5';

/** Which of a generation's two deployed instances a map addresses. */
export type OracleRole = 'primary' | 'reference';

export interface OracleLaneFeed {{
  /** slotId * lanesPerSlot + laneIdx; the address every wire record carries. */
  globalIndex: number;
  /** Decode bias: mark1e18 = mantissa << (exp + expBias). */
  expBias: number;
  /** Risk/encode class ('stable' | 'fx' | 'volatile' | 'equity'). */
  cls: string;
  /** Reference feed (USDC-USD denominator), not a spoke. */
  ref?: boolean;
}}

export interface OracleLaneMap {{
  chainId: number;
  wire: OracleWire;
  /** Primary (pool-facing) or reference (spoke-pricing) instance of this generation. */
  role: OracleRole;
  /** The oracle contract this map addresses. THE join key: pick the map whose oracle
   *  matches the venue record's `contracts.oracle` / `contracts.refOracle`, so a
   *  generation cutover needs no code change. */
  oracle: Address;
  /** 8 (V2, 28-bit lanes), 10 (V3, 22-bit lanes) or 8 (V4, 29-bit lanes). */
  lanesPerSlot: number;
  /** EIP-712 domain name the push quorum signs under. */
  domainName: string;
  /** Lane symbol -> lane addressing. Symbol maps to the on-chain feed name via {{@link oracleFeedName}}. */
  feeds: Record<string, OracleLaneFeed>;
}}

export const ORACLE_LANE_MAPS: readonly OracleLaneMap[] = [
{body}
];

/** Lane symbol -> the on-chain feed name (`feedIds` key in the venue record). */
export const oracleFeedName = (laneSymbol: string): string =>
  laneSymbol.includes('-') ? laneSymbol : `${{laneSymbol}}-USDC`;

/** The lane map addressing `oracle` on `chainId`, or null (a retired or unknown oracle has no
 *  lanes here - callers must treat null as "cannot decode", never as "no feeds"). */
export function oracleLaneMap(chainId: number, oracle: string): OracleLaneMap | null {{
  const key = oracle.toLowerCase();
  return (
    ORACLE_LANE_MAPS.find((m) => m.chainId === chainId && m.oracle.toLowerCase() === key) ?? null
  );
}}

/** globalIndex -> lane symbol, for joining decoded wire records back to feeds. */
export function laneSymbolByGi(map: OracleLaneMap): Map<number, string> {{
  const out = new Map<number, string>();
  for (const [sym, f] of Object.entries(map.feeds)) out.set(f.globalIndex, sym);
  return out;
}}
"""
with open(OUT, "w") as f:
    f.write(out)
print(f"wrote {OUT} ({len(out)} bytes, {len(maps)} maps: {', '.join(sorted(seen))})")
