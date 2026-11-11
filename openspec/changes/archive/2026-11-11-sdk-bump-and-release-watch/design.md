# Design

## Context

See `proposal.md` — Why. Constraints found in the code:

- `openchamber-modelselect/package.json` pins an exact canary
  (`2.6.2-canary.20261106.9`); `bun.lock` is committed and renovate only touches
  GitHub Actions.
- `scripts/release-watch.js` already talks to `gh` and `npm` through one `sh()`
  helper, keeps state in `.opencode/.modelselect-cache/release-watch.json`
  (`opencode`, `openchamber`, `sdk` keys) and filters release bodies with a
  keyword list.
- The daily job runs inside `opencode-maintenance.yaml`, which also has an
  OpenCode step that can act on what the script reports.
- The SDK tarball is the artifact the extension compiles against and contains
  the three docs the proposals are written from.

## Goals / Non-Goals

**Goals:**

- The pin tracks the newest canary whose surface we intend to use.
- A new SDK role or contribution is visible the day it ships, with its name.
- No new runtime dependency and no network access beyond npm and `gh`.

**Non-Goals:**

- Automatic upgrades of the pin (a human decides when the code adopts a surface).
- Parsing the SDK's TypeScript for API changes; the docs are the contract.
- Watching stable OpenChamber releases beyond what the script already does.

## Decisions

**D1 — Pin `.11`, not `latest`.** The proposals in this batch compile against
roles and contributions that exist only in the canary line; `latest` (2.6.1)
would fail to parse them. `engines.openchamber` stays `>=2.6.2`, the first
version that carries the quota role the extension already declares.

**D2 — Diff the tarball, not GitHub raw files.** `npm pack @openchamber/sdk@<v>`
into a temp dir and read the three markdown files: that is exactly what a build
resolves, it needs no token, and it works for a version npm has but GitHub has
not yet merged into a tag. Alternative rejected: raw.githubusercontent on a
commit — requires resolving a sha back to the version.

**D3 — Compare headings, not prose.** Extract lines starting with `## ` (drop
the `# Spec Delta`-style top level), compare as sets, and report added and
removed headings per file. Prose reflows constantly; a new `## OpenCode access`
section is the signal that matters. Alternative rejected: full-text diff —
noisy enough that the report gets ignored.

**D4 — Snapshot per version, keep three.** `sdkDocs: { "<version>": { "GUEST_SERVICES.md": ["..."], ... } }`.
Three versions is enough for "what did the last two canaries add" and keeps the
state file small. The comparison baseline is the previous *stored* version, not
the previously reported one, so a skipped day still shows the accumulation.

**D5 — Reuse `sh()`, add nothing.** `npm pack`, `tar -xzf` and `rm -rf` are all
already available where the script runs; a tarball reader dependency would need
`mise install` changes and a lockfile the Python-based maintenance does not
have.

## Risks / Trade-offs

- **A canary bump can break the build** → the bump is done in this change with
  the four test files as the gate; later bumps stay manual.
- **`npm pack` in CI adds ~2 s per new version** → only on a version change.
- **Heading diff misses a changed sentence** inside an existing section → the
  release body and the human review of the proposal batch remain the second
  net; the script's job is discovery, not completeness.
- **State file growth** → bounded to three versions, D4.

## Migration Plan

1. Bump and rebuild; verify `bun run check` and the four test files.
2. Ship the script change separately if the bump needs to land first; the old
   state file is read as "no snapshot for this version" and the first run
   reports the full heading list (one-time noise, documented in the script
   header).
3. Rollback: revert the pin and the script; nothing persisted depends on the new
   `sdkDocs` key.

## Open Questions

- Whether the daily job should also grep the SDK tarball's `manifest.d.ts` for
  new constants (`OPENCHAMBER_*`). Deferrable; headings already surface a new
  role.
