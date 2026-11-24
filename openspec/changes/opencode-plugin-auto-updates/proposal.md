# Proposal

## Why

OpenCode 2.4.0 lets plugins auto-update: when a plugin is written as
`name@latest`, `name@^range`, `name@~range`, or with a semver range, OpenCode
checks on startup and every 24 hours, installs a newer matching version, and
reloads it. A new version that fails to load keeps the previous one running. This
removes the manual `opencode plugin update` step needed for the modelselect
plugin and gives better automatic rollout.

## What Changes

- Switch the modelselect plugin to a versioned spec (`name@latest` or a semver
  range) in the managed config, so OpenCode keeps it current.
- Verify the plugin survives OpenCode 2.4.0 auto-update: a newer version that
  fails to load must keep the previous one running.
- Document the auto-update behavior and how to pin a specific version.

## Out of Scope

- Auto-updating a bare npm spec (`name`) or an already pinned version.
- Auto-updating git branches or commit hashes.
- Changing how the modelselect plugin version is chosen.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.
- Note: the package itself currently ships `@openchamber/sdk` `2.7.3` with `engines.openchamber` `>=2.7.1`; confirm the 2.8.0 floor is intentional.

## Capabilities

### New Capabilities

- `opencode-plugin-auto-updates`: modelselect plugin stays current via OpenCode's auto-update.

### Modified Capabilities

- `opencode-plugin-update`: auto-updates replace manual update steps when the
  plugin spec is versioned.

## Impact

- `openchamber-modelselect/package.json`, README.

## Safe to Revert

Switch the plugin back to a bare name or pinned version to disable auto-updates.
