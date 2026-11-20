# Design

## Context

See `proposal.md` for motivation. Stable `2.7.3` bundles OpenCode `2.3.2`; the
canary with the same content is `2.7.4-canary.20261120.26`. This change is a
verification pass over a third-party runtime, not a behavior change to the
extension.

## Goals / Non-Goals

**Goals:**

- Produce a recorded, test-backed verdict for each `2.3.1`/`2.3.2` change that
  touches plugin or action code.
- Keep verification deterministic through the sim harness.

**Non-Goals:**

- Auditing the OpenChamber SDK surface itself.
- Introducing new model-selection behavior.

## Decisions

- Verify through `sim/` with pinned fixtures rather than live OpenCode: the
  harness is deterministic and CI already runs `npm run sim`.
- Treat the structured `read` result and Code Mode tool renames as the two
  potentially breaking items; every other `2.3.1`/`2.3.2` item gets a
  pass/fail row with evidence.
- Keep the compatibility matrix as documentation, not a runtime gate.

Alternatives considered: live smoke tests against a moving OpenCode release
(rejected, not reproducible) and relying on the archived `2.3.0` verdict
(rejected, the tool surface changed).

## Risks / Trade-offs

- Pinned fixtures can drift from a later `2.3.x` patch → Mitigation: re-run the
  audit whenever the bundled OpenCode version changes.
- A silent parser regression could pass the sim but fail at runtime →
  Mitigation: assert explicitly on the structured result shape in the fixture.

## Migration Plan

No migration. Apply, run the sim, update the matrix, archive.

## Open Questions

(none)
