# Proposal

## Why

The plugin resolves its Zen/Go probe token from an explicit `token` option, then
`OPENCODE_API_KEY`, then OpenCode's auth store (`opencode` / `opencode-go`).
In OpenChamber the server is spawned without the shell env, so the env var is
usually absent and users have no first-class way to set a key for Modeselect
itself; they must reuse the `opencode` provider key or export an env var. A
dedicated Modeselect provider credential (set via `opencode auth login
modeselect`) gives a single, obvious place for the key and takes precedence
over the ambient env var.

## What Changes

- Register a `modeselect` OpenCode integration with a `key` (and `env`)
  auth method, so `opencode auth login modeselect` stores a key in
  `auth.json` under `modeselect`.
- Add `modeselect` to the auth-store provider list in `plugin/src/shared/auth.js`
  and make a stored Modeselect key win over `OPENCODE_API_KEY`.
- Use the integration connection (when available) to resolve the key at runtime,
  falling back to the existing auth.json / env chain.
- **BREAKING**: none — existing `token` option and `opencode`/`opencode-go` keys
  keep working; precedence only changes when a Modeselect key is present.

## Capabilities

### New Capabilities

- `modeselect-provider-auth`: resolving the Zen/Go probe token from a Modeselect
  provider credential, its precedence over the env var, and registration of the
  `modeselect` integration.

### Modified Capabilities

(none)

## Impact

- `plugin/src/shared/auth.js` (provider list, resolution order, caching).
- `plugin/src/v2.js` (integration transform registration, token resolution).
- `plugin/test/auth.test.js` (precedence and new provider id).
- OpenCode integration list / `~/.local/share/opencode/auth.json`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.
