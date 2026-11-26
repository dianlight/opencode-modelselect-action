# Design

## Context

See `proposal.md` for motivation. The `github-action-v2` action already accepts
a `websearch` input and writes its parsed JSON value into both generated
`opencode.json` files. The maintenance workflow currently passes `false`, so
the coverage-fix agent has no Web Search tool. `opencode run` is non-interactive
and cancels question inputs; Web Search's first use asks for a provider when
none is configured, which made the previous dispatched run exit 1.

## Goals / Non-Goals

**Goals:**

- Let the maintenance coverage-fix agent perform Web Search without any
  interactive provider prompt.
- Keep the failure mode explicit when no provider key is configured.
- Verify the behavior in the sim harness and a real dispatched workflow run.

**Non-Goals:**

- Change model selection, plugin routing or the extension UI.
- Provision provider accounts or rotate secrets.
- Enable Web Search in other workflows.

## Decisions

- **Use the existing `websearch` input instead of adding another action input.**
  The input already accepts `false` or a provider object such as
  `{"provider":"exa"}`, so enabling search is a workflow configuration change.
  Alternative considered: a new boolean input plus implicit provider selection —
  rejected because implicit selection is what triggers the question.
- **Configure a fixed provider in the maintenance workflow.** Pick one provider
  (for example Exa) via `websearch: '{"provider":"exa"}'` and expose its API key
  to the OpenCode step from a repository secret (`EXA_API_KEY` for Exa). Setting
  the provider skips the first-use selection prompt. Alternative considered:
  `{"provider":"random"}` — rejected because it can still need credentials and
  yields non-deterministic behavior in an unattended audit.
- **Preserve the disabled fallback.** If the provider secret is not configured,
  keep `websearch: "false"` so the agent stays green and uses direct source
  fetches. A conditional workflow expression selects between the provider
  object and `false` based on the secret. Alternative considered: always fail
  when the secret is missing — rejected because it would regress the currently
  green maintenance job for forks and repos without the secret.

## Risks / Trade-offs

- A missing or invalid provider key can make Web Search fail at call time.
  → Keep the disabled fallback and document the required secret in the workflow.
- Provider pricing/rate limits affect the maintenance run.
  → Use the narrow coverage-fix step only; leave the audit script unchanged.
- A provider name change in OpenCode could invalidate the configured object.
  → Sim scenario asserts the parsed config, and the dispatched run verifies the
    real CLI accepts it.

## Migration Plan

1. Add the chosen provider API key as a repository secret.
2. Change the workflow's `websearch` input to the provider object when the key
   exists, otherwise keep `false`.
3. Add a sim scenario for the provider-object config and dispatch the workflow
   to verify a green run with Web Search available.
4. Rollback: restore `websearch: "false"` in the workflow; no code rollback is
   needed because the action input already supports both values.

@247@