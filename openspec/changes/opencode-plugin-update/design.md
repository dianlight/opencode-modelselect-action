# Design

## Context

See `proposal.md` for motivation. The SDK exposes `contributes.opencodePlugin`
as a folder inside the package, OpenCode `2.3.1` can update plugins from
Settings, and `2.4.0` can auto-update them. The panel talks to the service only
through `panel/src/api.js`; the service is the only owner of file I/O. Version
parity still has to be detected after an automatic update.

## Goals / Non-Goals

**Goals:**

- Give a deterministic matching/mismatching/missing verdict.
- Keep the Models tab functional in every state.

**Non-Goals:**

- Installing, updating or pinning plugins automatically.
- Changing routing logic in the plugin.

## Decisions

- Read the loaded version from the managed config through the service, not
  from the panel, preserving the existing I/O boundary.
- Compare exact version strings; no semver range interpretation in the first
  iteration, because plugin versions follow the package version.
- Render the verdict as a non-blocking badge in the Models tab, reusing the
  existing panel frame so schema and frame tests keep covering it.

Alternatives considered: a silent auto-update (rejected, it would override a
user choice) and hiding the Models tab on mismatch (rejected, it removes useful
data).

## Risks / Trade-offs

- Managed config layout may change → Mitigation: fail closed to "missing" and
  keep the tab usable rather than guessing a version.
- Exact-string comparison flags prerelease builds → Mitigation: show both
  strings so the user can judge, and document the expectation.

## Migration Plan

No data migration. Apply after `ship-plugin-inside-extension`, add tests,
archive.

## Open Questions

(none)
