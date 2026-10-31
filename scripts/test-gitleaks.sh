#!/usr/bin/env bash
# Guards .gitleaks.toml: 0x+64hex keys must be detected in every path, a bare 0x+40hex address must stay exempt.
set -euo pipefail
cd "$(dirname "$0")/.."
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
# retry until >=15 distinct digits: low-entropy randoms fall under the rule's entropy gate (flaky test)
hex() { local h; while :; do h=$(od -An -vtx1 -N"$1" /dev/urandom | tr -d ' \n'); [ "$1" -lt 20 ] || [ "$(fold -w1 <<<"$h" | sort -u | wc -l)" -ge 15 ] || continue; printf %s "$h"; return; done; }
scan() { gitleaks detect --no-git --no-banner --redact -c .gitleaks.toml -s "$1" >/dev/null 2>&1; }
# must be detected (scan fails): name, line [, relative file path]
must_detect() { local f=${3:-f.ts}; mkdir -p "$d/$1/$(dirname "$f")"; printf '%s\n' "$2" > "$d/$1/$f"; ! scan "$d/$1" || { echo "FAIL: $1 not detected" >&2; exit 1; }; }
must_pass() { mkdir "$d/$1"; printf '%s\n' "$2" > "$d/$1/f.ts"; scan "$d/$1" || { echo "FAIL: $1 flagged" >&2; exit 1; }; }
k=$(hex 32); a=$(hex 20)
must_detect key64 "const api_key = \"0x$k\""
must_detect env64 "PRIVATE_KEY=0x$k"
must_detect privateKey "const privateKey = \"0x$k\""
must_detect private_key "private_key = \"0x$k\""
must_detect addr_prefix_u "const api_key = \"_0x$a\""
must_detect addr_suffix_u "const api_key = \"0x${a}_\""
must_detect addr_in_run "const api_key = \"0x${a}$(hex 3)\""
must_detect addr_no0x "const api_key = \"$a\""
must_detect key_deployments "{\"privateKey\": \"0x$k\"}" deployments/x.json
must_detect secret_deployments "{\"secret\": \"0x$k\"}" deployments/x.json
must_detect key_env_example "PRIVATE_KEY=0x$k" .env.example
must_detect pk_env_example "pk=$k" .env.example
must_detect key_risk_toml "privateKey = \"0x$k\"" risk.mainnet.toml
must_detect pk_oracle_toml "pk = \"0x$k\"" oracle.base.toml
must_detect secret_fleet_toml "secret = \"0x$k\"" fleet.x.toml
must_detect key_ts_file "export const privateKey = '0x$k'" src/k.ts
must_detect key_literal "bytes32 constant deployerKey = hex\"$k\";" src/K.sol
must_detect mnemonic "mnemonic = \"alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima\"" cfg.toml
must_detect key_in_lock "{\"privateKey\": \"0x$k\"}" abis.lock.json
must_pass addr "const api_key = \"0x$a\""
echo "gitleaks allowlist ok"
