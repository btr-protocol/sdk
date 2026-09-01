#!/usr/bin/env bun
/**
 * Decode a live wire-v5 blob and report its exponent distribution.
 *
 * Exists because a claim about production encoding should be re-derivable, not
 * quoted from someone's terminal. The article states that every price entry in a
 * live v5 blob normalizes to exponent 7 — that is the per-feed expBias centring
 * working, and it is what gives every feed 256x upward / 128x downward headroom
 * before `encode_lane` runs out of exponent. Run this to check it still holds.
 *
 *   ssh nxrates.com 'sudo k0s kubectl -n nxr port-forward deploy/nxr-signer-arc-0 18099:40004' &
 *   curl -s 'http://127.0.0.1:18099/v1/quote/signed?domain=arc-v4&version=5' \
 *     | bun scripts/decode-live-v5.ts
 *
 * The ENTRY COUNT varies run to run — a feed whose mark is unavailable is
 * excluded from the blob, so do not pin it. The exponent invariant is the claim.
 */
import { decodeBlobV5 } from '../src/oracle/wire';

const raw = await Bun.stdin.text();
const blob = (JSON.parse(raw).blob ?? raw.trim()) as `0x${string}`;
const d = decodeBlobV5(blob);
const exps = d.prices.map((p) => (p.lane >>> 25) & 0xf);
const uniq = [...new Set(exps)].sort((a, b) => a - b);

console.log(`version    ${(d as unknown as { version: number }).version}`);
console.log(`seq        ${d.seq}`);
console.log(`prices     ${d.prices.length}  sigmas ${d.sigmas.length}  confs ${d.confs.length}`);
console.log(`gi         ${d.prices.map((p) => p.gi).join(',')}`);
console.log(`exponents  ${uniq.join(',')}${uniq.length === 1 && uniq[0] === 7 ? '   <- all centred at 7' : '   <- NOT all 7'}`);
if (uniq.length !== 1 || uniq[0] !== 7) process.exitCode = 1;
