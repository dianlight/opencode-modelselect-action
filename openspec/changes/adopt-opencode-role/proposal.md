# Proposal

## Why

The Work Status section lost every live session fact when it moved from an
iframe to a host-rendered answer: the source contract carries only
`?directory=` and `?locale=`, so the service reads `status-*.json` files from
the project cache instead of asking the server what is actually running. The
canary release `2.6.2-canary.20261107.11` adds a read-only `opencode` service
role (`service.provides: ["opencode"]`) that hands an approved service a
loopback OpenCode connection: sessions, messages, projects and the live event
stream. It is the difference between inferring state from files this project
guesses at and reading it from the process that owns it.

## What Changes

- Add `"opencode"` to `contributes.service.provides` next to `"quota"`, so the
  approval dialog gains its own row for host OpenCode reads (the `opencode`
  capability is implicit and cannot be listed in `contributes.capabilities`).
- Read `OPENCHAMBER_OPENCODE_URL` and reuse `OPENCHAMBER_SERVICE_TOKEN` in
  `openchamber-modelselect/service/src/main.js`; no `@opencode/client`
  dependency, plain `fetch`, so the Node bundle stays dependency-free.
- Replace "newest `status-*.json` in the project" as the source of truth for
  session identity with `GET /api/session` (filtered by the project directory)
  and `GET /api/session/active`, keeping the file scan as the fallback when the
  role is not granted or the host is older.
- Keep an in-memory snapshot refreshed from `GET /api/event` (SSE) while the
  section or the panel is shown, so a `/status` answer no longer costs a
  directory scan plus JSON parses every two seconds.
- Report the degradation honestly: when the environment variables are absent,
  the section keeps working from the files and never claims a live reading.
- Update the README (approval text, what is read, what is never read) and the
  extension's `filesystem`/capability documentation.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Capabilities

### New Capabilities

- `host-opencode-access`: how the extension reads the host OpenCode (connection,
  allowed reads, event-driven freshness, degradation, privacy of the token).

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (`service.provides`,
  `engines.openchamber`, `@openchamber/sdk` version), rebuilt
  `service/main.js`.
- `openchamber-modelselect/service/src/main.js`, `store.js`, `view.js` and
  their tests.
- `openchamber-modelselect/README.md` (permission text, states).
- Requires an extension update that asks the user to approve the new
  capability; existing approvals do not carry over.
- No change to routing: the OpenCode plugin remains the only component that
  picks a model, and the service keeps read-only access.
- Depends on `sdk-bump-and-release-watch` for the pinned SDK that knows the
  role.
