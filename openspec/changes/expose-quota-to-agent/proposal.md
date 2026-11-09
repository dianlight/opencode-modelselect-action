# Proposal

## Why

OpenChamber 2.7.0 lets an agent check provider limits and reset times (Agent usage
tool). This project already collects Go/Console budget data in `usage-limits.json`
and exposes it through the quota provider, but an agent cannot read it; it has to
wait for the host's own provider list, which does not include modelselect's
blended view.

## What Changes

- Expose a `quota.read` agent tool (through Code Mode, per the canary) that returns
  the same payload as `POST /quota`, so the agent can check limits before routing.
- Gate it behind the existing `quota` role; no new approval.
- Document the tool in the README and the extension card.

## Capabilities

### New Capabilities

- `agent-tool-quota`: what the tool returns and when the agent may call it.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js` (new route or agent-tool handler),
  manifest, tests.
- Rebuilt `service/main.js`; no new permission.
- Depends on `adopt-opencode-role` and `sdk-bump-to-2-7-1`.
