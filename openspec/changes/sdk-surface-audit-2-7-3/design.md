# Design

## Context

See `proposal.md` for motivation. The canary SDK tarball and the `2.7.3` tarball
are byte-identical except for `package.json`, so `2.7.3` is the authoritative
surface to audit against. The extension pins SDK `2.7.2` and declares an
`openchamber` engine floor of `>=2.7.1`.

## Goals / Non-Goals

**Goals:**

- Produce a dated matrix of SDK surface rows used by the extension and the
  minimum host version for each.
- Turn "stable floor names a published tag" into an automated maintenance check.

**Non-Goals:**

- Changing the pinned SDK version or rewriting the extension.

## Decisions

- Compare published tarballs instead of a git checkout: it is what consumers
  install and avoids the stale `canary` tag on the OpenChamber repository.
- Treat `DOCUMENTATION.md` invariants as the behavior contract and dist files
  as supporting evidence.
- Implement the tag check in the maintenance script so it runs in CI rather
  than as a one-off script.

Alternatives considered: a runtime capability probe (rejected, cannot prove
absence of a surface) and trusting the changelog alone (rejected, it omits
invariants).

## Risks / Trade-offs

- A future release can add an invariant without a docs change → Mitigation:
  re-run the audit on every release watch.
- Published tag discovery depends on the GitHub API → Mitigation: reuse the
  maintenance script's existing GitHub fetch and fail soft on network errors.

## Migration Plan

No code migration. Apply, run the audit, raise floors if required, archive.

## Open Questions

(none)
