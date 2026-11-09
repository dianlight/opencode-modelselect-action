# Proposal

## Why

The canary mirrors releases to R2 and shows release notes in About ("updates:
mirror releases to R2 and show release notes in About"). This project's
git-installable distribution has no release-notes surface, so a user who updates
cannot see what changed without leaving the app.

## What Changes

- Surface the project's CHANGELOG/release notes in the extension's About/panel.
- Consume the R2 mirror for update checks where the host supports it.
- Document the path in the README.

## Capabilities

### New Capabilities

- `release-notes-surface`: how release notes are shown and where they come from.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/panel/src/*`, `README.md`, release automation.
- Could fold into `git-installable-extension`.
- Depends on `sdk-bump-to-2-7-1`.
