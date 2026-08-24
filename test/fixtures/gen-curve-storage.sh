#!/usr/bin/env bash
# Regenerate `curve-storage.json` — the packed NUQuartic.Curve storage words that
# `test/curve-storage.test.ts` checks `readCurve` against.
#
#   sdk/test/fixtures/gen-curve-storage.sh          # dex + shared at HEAD
#   DEX_REF=<rev> SHARED_REF=<rev> …/gen-curve-storage.sh
#
# Reproducible by construction: the dex and shared trees are `git archive`d into a scratch
# directory at an exact revision, so the fixture is a function of (DEX_REF, SHARED_REF,
# CurveStorageDump.t.sol) alone and never of anyone's working tree. Nothing is written into the
# dex or shared checkouts — a stale `dex-evm/out` or an in-flight edit there cannot reach it.
# The revision that produced the committed fixture is recorded in its `_note` field; re-run this
# and diff whenever NUQuartic's packing or `readCurve` changes.
#
# Requires: forge (foundry), a sibling `dex` and `shared` checkout.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
btr=$(cd "$here/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

DEX_REF=${DEX_REF:-HEAD}
SHARED_REF=${SHARED_REF:-HEAD}
rev=$(git -C "$btr/dex" rev-parse --short "$DEX_REF")

mkdir -p "$work/dex" "$work/shared"
git -C "$btr/dex" archive "$DEX_REF" | tar -x -C "$work/dex"
git -C "$btr/shared" archive "$SHARED_REF" | tar -x -C "$work/shared"

mkdir -p "$work/dex-evm/test/sdkgen"
cp "$here/CurveStorageDump.t.sol" "$work/dex-evm/test/sdkgen/"

cd "$work/dex-evm"
DEX_REV="$rev" forge test --match-path 'test/sdkgen/*' >/dev/null
cp curve-storage.json "$here/curve-storage.json"
echo "wrote $here/curve-storage.json from dex $rev"
