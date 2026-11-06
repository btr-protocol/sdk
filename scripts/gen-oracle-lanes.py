#!/usr/bin/env python3
"""Regenerate src/venues/oracle-lanes.generated.ts from the dex-evm lane records.

Inputs (SoT): dex-evm/deployments/<slug>.manifest.json (`oracle.wire`, asset classes) plus that
chain's mark-store record <chainId>.deploy.json. Run from sdk/: python3 scripts/gen-oracle-lanes.py

THE CHAIN LIST IS DATA, NOT A CONSTANT IN THIS FILE. The output is rewritten whole, so a hard-coded
default list is a script that silently DELETES every chain it does not happen to name. A bare run
takes every non-scaffold record present on disk - the set of fleets that have been deployed - so landing a second chain needs no edit here and cannot drop the first. An argument
FILTERS that set by chain id (for inspecting one fleet); a chain named with no lane record is an
error, never an empty output.

One store serves two tiers - PRIMARY every pool leg reads, REFERENCE pricing the non-base spokes -
each signed under its own verifyingContract, so each record emits two maps, one per address.
`oracleLaneMap` joins on the address, so two generations mid-cutover coexist with no code change.
"""

import glob
import json
import os
import sys

# BTR_DEX_EVM overrides the sibling dex-evm checkout (e.g. a worktree at another ref).
DEX = os.path.join(os.environ.get("BTR_DEX_EVM") or os.path.join(os.path.dirname(__file__), "../../dex-evm"), "deployments")
OUT = os.path.join(os.path.dirname(__file__), "../src/venues/oracle-lanes.generated.ts")

def load(path):
    with open(path) as f:
        return json.load(f)


def checksum(addr):
    """EIP-55. pycryptodome is only needed for wire 9, whose address comes from a lowercase table."""
    from Crypto.Hash import keccak

    a = addr.lower().removeprefix("0x")
    h = keccak.new(digest_bits=256, data=a.encode()).hexdigest()
    return "0x" + "".join(c.upper() if int(h[i], 16) >= 8 else c for i, c in enumerate(a))


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
seen9 = set()

maps = []
# Wire 8 (MarkStoreP8, 4 lanes per tier word): the chain's `<chainId>.deploy.json` carries `feeds`
# (sym -> globalIndex) and both tiers' EIP-712 verifyingContracts; the manifest carries the class.
# The lane exponent is absolute, so every expBias is 0. A scaffold record (zero oracle) is skipped.
for path in sorted(glob.glob(os.path.join(DEX, "*.manifest.json"))):
    m = load(path)
    if m.get("oracle", {}).get("wire") != 8:
        continue
    chain = str(m["chain"]["id"])
    if want and chain not in want:
        continue
    rec_path = os.path.join(DEX, f"{chain}.deploy.json")
    rec = load(rec_path) if os.path.exists(rec_path) else {}
    if int(rec.get("oracle") or "0x0", 16) == 0:
        continue
    if chain in seen:
        raise SystemExit(f"two wire-8 manifests declare chainId {chain}")
    seen.add(chain)
    assets = m["assets"]
    feeds = {
        sym: {"globalIndex": f["globalIndex"], "expBias": 0, "cls": assets[sym]["cls"], "ref": assets[sym].get("ref")}
        for sym, f in rec["feeds"].items()
    }
    lanes = {"chainId": m["chain"]["id"], "feeds": feeds}
    for role, key in (("primary", "verifierP"), ("reference", "verifierR")):
        if int(rec.get(key) or "0x0", 16) == 0:
            raise SystemExit(f"{os.path.basename(rec_path)}: live oracle but no {key}")
        maps.append(map_ts("v8", lanes, rec[key], 4, "BTR ExternalOracleV4", role))

# Wire 9 (MarkStoreP8 "wire 3", pool v2): same 4 x 56-bit lanes, absolute exponent. The lanes are the
# manifest's own `assets.<sym>.lane.gi` (a pending manifest has no deploy record yet), one tier only
# (the store has no reference tier), and the EIP-712 verifyingContract is the fleet's PoolFactory, a
# CREATE3 address known before deploy: deployments/create3-addresses.json `<create3Prefix>PoolFactory`.
# Pending manifests (deployments/pending/) are included: the lane map must exist before the deploy.
c3_path = os.path.join(DEX, "create3-addresses.json")
# ponytail: allowlist grows per reviewed v2 launch; add chain after review
WIRE9_REVIEWED = {143}
for path in sorted(glob.glob(os.path.join(DEX, "*.manifest.json")) + glob.glob(os.path.join(DEX, "pending", "*.manifest.json"))):
    m = load(path)
    if m.get("oracle", {}).get("wire") != 9:
        continue
    chain = str(m["chain"]["id"])
    if m["chain"].get("class") == "local" or (want and chain not in want) or m["chain"]["id"] not in WIRE9_REVIEWED:
        continue
    key = ("v9", path)
    if key in seen9:
        raise SystemExit(f"{path} listed twice")
    seen9.add(key)
    seen.add(chain)
    c3 = load(c3_path)["contracts"][m["chain"].get("create3Prefix", "") + "PoolFactory"]
    addr = c3.get(m["chain"]["create3Fleet"])
    if not addr:
        raise SystemExit(f"{path}: no {m['chain']['create3Fleet']} address for {m['chain'].get('create3Prefix', '')}PoolFactory in create3-addresses.json")
    feeds = {
        sym: {"globalIndex": a["lane"]["gi"], "expBias": 0, "cls": a["cls"], "ref": a.get("ref")}
        for sym, a in m["assets"].items()
        if isinstance(a, dict) and a.get("lane")
    }
    gis = sorted(f["globalIndex"] for f in feeds.values())
    if gis != list(range(len(gis))):
        raise SystemExit(f"{path}: lane map not dense 0..{len(gis) - 1}: {gis}")
    maps.append(map_ts("v9", {"chainId": m["chain"]["id"], "feeds": feeds}, checksum(addr), 4, "BTR ExternalOracleV4", "primary"))

# An unmatched filter would quietly rewrite the file with fewer chains than the operator asked for.
if want - seen:
    raise SystemExit(f"no live wire-8/9 record in {DEX} for chain(s) {', '.join(sorted(want - seen))}")
if not maps:
    raise SystemExit(f"no live wire-8/9 records in {DEX} - refusing to write an empty map table")

body = "\n".join(maps)

out = f"""// Oracle lane maps for the packed-slot push oracles, per chain.
// GENERATED from dex-evm/deployments (<slug>.manifest.json + <chainId>.deploy.json) - never hand-edited.
// Regenerate: sdk/scripts/gen-oracle-lanes.py - it emits EVERY deployed chain, so a bare run is
// always the whole table; an optional chain-id argument only filters it for inspection.
//
// A feed is addressed by its globalIndex: slotId = gi / lanesPerSlot, lane = gi % lanesPerSlot.
// `expBias` is 0 on wires 8 and 9: the lane exponent is absolute.
// Lane symbol -> on-chain feed name: `<SYM>-USDC` for every spoke, `USDC-USD` for the reference.
//
// A chain appears TWICE, once per tier verifyingContract (`role`): the primary every pool leg
// reads, and the reference that prices non-base spokes. Generations overlap during a cutover, so
// more than one map can be live at a time - always join on the ADDRESS, never on the wire tag.

import type {{ Address }} from '../eth/types.js';

/** Wire generation. The tag is the BLOB version byte, not the contract's name:
 *  ExternalOracleV3 speaks wire 'v3' (blob version 4), ExternalOracleV4 'v5', ExternalOracleV5 'v6',
 *  MarkStoreP8 'v8' (wire 2) and 'v9' (wire 3, pool v2; verifyingContract = the PoolFactory). */
export type OracleWire = 'v2' | 'v3' | 'v5' | 'v6' | 'v8' | 'v9';

/** Which of a generation's two deployed instances a map addresses. */
export type OracleRole = 'primary' | 'reference';

export interface OracleLaneFeed {{
  /** slotId * lanesPerSlot + laneIdx; the address every wire record carries. */
  globalIndex: number;
  /** Decode bias: mark1e18 = mantissa << (exp + expBias). */
  expBias: number;
  /** Risk/encode class ('stable' | 'fx' | 'volatile' | 'equity'; wire 9 uses the store's class names: 'alt' | 'major' | 'gold'). */
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
  /** 8 (V2, 28-bit lanes), 10 (V3, 22-bit lanes), 8 (V4, 29-bit lanes) or 4 (V5 32-bit, P8 56-bit lanes). */
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
