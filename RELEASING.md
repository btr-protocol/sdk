# Releasing @btr-protocol/sdk

Owner-only. Nothing here runs in CI. Version bump rule: patch = fixes, minor = features or any
breaking change while 0.x, major once 1.0. Keep these in lockstep: `package.json` version,
`jsr.json` version, `server.json` version (top-level and `packages[0].version`), CHANGELOG heading.

1. On a clean `main`: `git fetch --prune && git status` (clean, not behind).
2. Move CHANGELOG `Unreleased` to `## X.Y.Z - date`; bump the four version fields above.
3. `bun install && bun run fetch-abis && bun run check`
4. `npm pack --dry-run` (generated `src/abis/Pool.ts`, `Admin.ts` must be listed).
5. Commit `chore(release): vX.Y.Z`, push, then signed tag: `git tag -s vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
6. npm (2FA prompt): `npm publish --access public`
7. JSR: `bunx jsr publish` (browser auth; add `--allow-slow-types` until slow types are fixed).
8. MCP registry (after npm is live, the registry verifies `mcpName` in the published package):
   `mcp-publisher login github && mcp-publisher publish` (installs: `brew install mcp-publisher`).
9. Verify: `npm view @btr-protocol/sdk version`, `bunx jsr info @btr-protocol/sdk` (or jsr.io page), registry search for `io.github.btr-protocol/btr-mcp`.
