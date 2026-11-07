# Design

## Context

See `proposal.md` — Why.

Constraints found while reading the code:

- OpenChamber's installer reads `package.json` at the repository root of a git
  install; there is no subdirectory parameter for git sources (`?path=` install
  links are chat-only, per the extension-authoring change in OpenChamber PR
  6379).
- This monorepo's root is not an extension: it holds the Go action, the OpenCode
  plugin, `core/`, and `data/`. The extension lives in `openchamber-modelselect/`
  and imports `core/*.js` through `../..`, so it cannot simply be moved.
- The extension's built artifacts are committed (`panel/main.js`,
  `service/main.js`); the host never compiles anything.
- `openchamber-guest-bundle` writes both bundles from `panel/src/` and
  `service/src/`, and `openchamber-guest-check` validates the manifest and the
  entries it names.

## Goals / Non-Goals

**Goals:**

- A git URL that a user can paste into Settings → Extensions, with a working
  Update button afterwards.
- One source of truth for the code: the published tree is generated, never
  edited.
- Publish only what the host needs, so the update download stays small.

**Non-Goals:**

- Publishing the OpenCode plugin or the Go action (they are not extensions).
- npm publishing, or a second copy of the extension's source.
- Auto-updating folder installs — OpenChamber does not support that.

## Decisions

**D1 — Dedicated distribution repository `dianlight/openchamber-modelselect`
with a generated root package.** The publish step copies `panel/`, `service/`,
`package.json` (rewritten with the release version) and `README.md` into a
checkout of that repository and pushes. Alternatives: (a) an orphan `dist`
branch of this monorepo — OpenChamber would install from a branch URL
(`…#dist`), which works but pins users to a branch name and leaks the whole
repo's history into the install root; (b) moving the extension to its own repo
outright — breaks the `core/` imports that the plugin and the panel share.

**D2 — Build, check, then publish; never publish from a dirty cache.** The step
runs `bun install`, `bun run build`, `bun run check`, `bun run test` in
`openchamber-modelselect/`, then copies. A failure stops before the push, so a
published tree always matches a green run.

**D3 — Version is bumped by the existing release flow.** `package.json` version
in this repo is the source; the publish step uses it verbatim. The changelog
entry for that version names the extension change. No independent version
sequence in the distribution repository.

**D4 — Trigger on the extension's release, not on every commit.** The publish
job runs in `opencode-maintenance.yaml` (or a small dedicated workflow) when the
`openchamber-modelselect/**` files changed since the published version, and the
committed bundle diff is part of the release commit. Hourly churn would produce
update prompts users cannot act on.

**D5 — The README documents both paths.** Git URL for users (update prompt), the
folder for development (no prompt, replace by hand), and the
`openchamber://extensions/install?url=…` link as a button.

## Risks / Trade-offs

- **Two repositories can drift** (someone hand-edits the distribution repo) →
  the publish step always overwrites the whole tree and fails on a non-fast-forward
  push; the repository's README says it is generated.
- **A secret with push access is a new credential** → a fine-grained PAT limited
  to the distribution repository, stored as `GH_PAT_DIST`; the workflow never
  prints it.
- **Users on OpenChamber < 2.6.1** never see an update prompt → the README keeps
  the folder/ZIP instructions as the fallback.
- **A broken release cannot be withdrawn** once users update → the next release
  must be a fast revert-and-publish; the update keeps approvals, so a manifest
  regression is still recoverable.

## Migration Plan

1. Create the distribution repository, empty with a README that points back here.
2. Add the publish step behind a manual `workflow_dispatch` input first, run it
   once, verify an install from the URL and an update after a version bump.
3. Enable it on release; keep the folder instructions in the README.
4. Rollback: delete the distribution repository's last commit or revert the
   extension version; OpenChamber then offers the older published version on the
   next check.

## Open Questions

- Whether the distribution repository should carry the source too (for
  reviewers) or only the built files. The spec allows either; the publish step
  starts with built files only.
