# Design

## Context

See `proposal.md` for motivation. `buildView(snap)` is a pure module that turns
a project snapshot into a `GuestStatusView`; `service/src/main.js` already reads
the query string on `GET /status` but currently ignores `locale`. The host
contract is unchanged and the view is validated on every read.

## Goals / Non-Goals

**Goals:**

- Make every user-facing string in the view selectable by locale.
- Preserve the strict schema contract and data fidelity.

**Non-Goals:**

- Localizing the panel or background action.
- Shipping translation tooling beyond a static table lookup.

## Decisions

- Pass `locale` through the snapshot rather than importing request state into
  the pure view module: this keeps `buildView` testable without a process.
- Store messages in a table keyed by locale, falling back to English at lookup
  time; no locale negotiation or region fallback in the first iteration.
- Localize only literal chrome strings. Status fields, ids and formatted values
  remain data and are never translated.
- Reuse the existing `cut()` clamp so translation length cannot break
  `guestStatusViewSchema`.

Alternatives considered: a runtime i18n library (rejected, adds a dependency
to a zero-dependency bundle) and letting the host translate the view (rejected,
the host only renders it).

## Risks / Trade-offs

- Partial translations can mix languages → Mitigation: a locale table is
  all-or-nothing; a missing key falls back to that locale's English value.
- The schema's field limits may clip long translations → Mitigation: assert
  limits in the view tests for each table.

## Migration Plan

No data migration. Apply, add the tables, verify the view tests, archive.

## Open Questions

(none)
