#!/usr/bin/env python3
"""Regenerate src/venues/oracle-lanes.generated.ts from the dex-evm lane JSONs.

Inputs (SoT): dex-evm/deployments/arc-oracle-{v2,v3,v4}-lanes.json + the deployed oracle
addresses (5042002.deploy.v{2,3,4}[ref].json). Run from sdk/: python3 scripts/gen-oracle-lanes.py

Every generation deploys TWO instances off one lane layout - the PRIMARY every pool leg reads and
the REFERENCE that prices the non-base spokes - so each lane JSON emits two maps, one per address.
The pair is not a copy: `oracleLaneMap` joins on the address, and the two generations run side by
side during a cutover (V4 primary live while the V3 reference awaits its timelock round).
"""

import json
import os

DEX = os.path.join(os.path.dirname(__file__), "../../dex-evm/deployments")
OUT = os.path.join(os.path.dirname(__file__), "../src/venues/oracle-lanes.generated.ts")

# wire tag -> (lane JSON, deploy-record stem, lanes/slot, EIP-712 domain name)
GENERATIONS = [
    ("v2", "arc-oracle-v2-lanes.json", "v2", 8, "BTR ExternalOracleV2"),
    ("v3", "arc-oracle-v3-lanes.json", "v3", 10, "BTR ExternalOracleV3"),
    ("v5", "arc-oracle-v4-lanes.json", "v4", 8, "BTR ExternalOracleV4"),
]


def load(name):
    with open(os.path.join(DEX, name)) as f:
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


maps = []
for wire, lane_file, stem, per_slot, domain in GENERATIONS:
    lanes = load(lane_file)
    for role, suffix in (("primary", ""), ("reference", "ref")):
        rec = f"5042002.deploy.{stem}{suffix}.json"
        if not os.path.exists(os.path.join(DEX, rec)):
            continue
        maps.append(map_ts(wire, lanes, load(rec)["oracle"], per_slot, domain, role))

body = "\n".join(maps)

out = f"""// Oracle lane maps for the packed-slot push oracles (V2/V3/V4), per chain.
// GENERATED from dex-evm/deployments/arc-oracle-{{v2,v3,v4}}-lanes.json - do not hand-edit values.
// Regenerate: sdk/scripts/gen-oracle-lanes.py (reads the dex-evm lane JSONs).
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` governs the lane price decode (mantissa << (exp + bias)); it is per encode class up to
// V3 and PER FEED from V4 (bias = bitLength(mark1e18) - 32, which pins exp = 7 on every feed). It
// is corrected on-chain via setFeedExpBias, so a drifted bias means REGENERATING this file.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// Each generation appears TWICE, once per deployed instance (`role`): the primary every pool leg
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

/** The lane map addressing `oracle` on `chainId`, or null (V1 / unknown oracle has no lanes). */
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
print(f"wrote {OUT} ({len(out)} bytes)")
