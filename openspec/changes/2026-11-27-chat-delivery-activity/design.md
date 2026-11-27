# Design

## Context

See proposal.md - Why. The host now ships delivery surfaces (composer delivery,
background job events, reply replacement) both on the daily canary
(`2.8.2-canary.20261127.33`, built on OpenCode `2.4.2`) and as of stable OpenChamber
`2.8.1` (2026-11-26).

## Goals / Non-Goals

**Goals:**

- Consume delivery/activity events instead of inferring delivery state locally.

**Non-Goals:**

- Redesigning the Work Status row layout.

## Decisions

- **Decision**: adopt the host delivery events as the source of truth for
  delivery state, and keep local heuristics only as a fallback for hosts that do
  not emit the events yet.
- **Decision**: surface wake/replacement info via the existing session action and
  Work Status surfaces rather than a new surface.

## Risks / Trade-offs

- [Risk] Host event schema drift between canary and stable -> Mitigation: keep the
  delta spec minimal and re-audit on sdk-surface-audit changes.

## Migration Plan

- Bump `@openchamber/sdk` to `>=2.8.1`, ship regenerated bundles.

## Open Questions

- None blocking.
