# Design

## Context

See `proposal.md` — Why. Constraints found in the code:

- `service/src/view.js` is a pure builder: parsed state in, `{ rows }` out, with
  a documented row order and the switch appended last so the cap cannot drop it.
- The status contract allows `controls` in the answer (the same shape
  `setStatusControls` takes) and a `POST { id, value }` for a switch's `on`/`off`;
  the service already routes `routing-sync` through that path.
- `line.icon` is a Remixicon kebab name; an unknown one is dropped by the host —
  which means a typo is silent, not fatal.
- `content.chart` takes ≤120 values, oldest first, with `unit` and `step`
  seconds for the hover label; `step` is the poll interval.
- The service is restarted freely (ten idle minutes); anything kept in memory
  starts empty.

## Goals / Non-Goals

**Goals:**

- Free the switch from the row budget and make it reachable while collapsed.
- A predictable, testable answer at any data volume.
- Visible history for the one number that moves daily.

**Non-Goals:**

- Persisting the sparkline across restarts (a ring buffer on disk would be a new
  file with its own lifetime for a cosmetic gain).
- A new row for anything (the budget is the constraint).
- Changing what the quotas mean or where they come from.

## Decisions

**D1 — Header control, not row.** Move `routing-sync` into `controls` with
`{ kind: 'switch', id: 'routing-sync', label: 'Auto-update router', checked }`.
The host posts `on`/`off` to the same path, which the service already validates;
the `POST` handler does not change, only the renderer. Alternative rejected:
keep the row and hide it under a "more" expansion — the contract has no such
container.

**D2 — Priority as data, not as `if` order.** A `ROW_PRIORITY` array in
`view.js` (`pick` group first: Task, Tier, Model, Think; then Jev, Source,
Updated; then Go window; then budgets; then notes) and a single trim step. A
test builds an oversized input and asserts the tail is dropped. Alternative
rejected: ad-hoc appends — the current bug class, where a new row quietly
displaces the switch.

**D3 — Icons from a frozen map.** `ROW_ICONS` maps row ids to Remixicon names;
the builder looks the name up and omits the field when absent. A test asserts
every emitted icon is in the map's values and that the map's values are all
valid Remixicon names (a small allowlist copied from the host docs).

**D4 — Sparkline in a ring buffer owned by the service, read by the builder.**
A module-level `Map<cacheDir, number[]>` capped at 120, appended once per answer
after the quota snapshot is parsed. `view.js` stays pure: the series is passed
in. Alternative rejected: re-deriving history from `usage-limits.json` — the
plugin overwrites it, so it carries no history.

**D5 — Schema check in the test, not in the request path.** A production
`zod` validation on every 2 s answer is wasted work; the test imports
`guestStatusViewSchema` from `@openchamber/sdk/schemas` and validates the
built answer for a matrix of states. A malformed answer then fails CI.

**D6 — Polling stays at 2 s.** The manifest interval is the host's contract and
changes only on reinstall; the win comes from answering out of the snapshot
(`adopt-opencode-role`), not from stretching the interval.

## Risks / Trade-offs

- **A user who never opens the section** → no sparkline; harmless.
- **The switch in `controls` on an older host** → the contract is the one the
  extension already requires (2.6.1+); a host that drops `controls` loses the
  switch, which the README lists as the one visible dependency.
- **Losing a row that a user relied on** → the drop order is documented and
  tests name what goes first; nothing that carries the pick is ever dropped.
- **Icon churn** → a frozen map with a test, per D3.

## Migration Plan

1. Ship the builder and the trim in one release; the rendered section is
   identical at low volume.
2. Move the switch to `controls`; verify toggling from a collapsed section.
3. Rollback: the row renderer is a small diff; reverting restores the last-row
   switch.

## Open Questions

- Whether the Go window should also chart the weekly window. Deferrable; one
  chart per row is the contract's limit anyway.
