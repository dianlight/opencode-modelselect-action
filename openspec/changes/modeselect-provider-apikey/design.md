# Design

## Context

Token resolution lives in `plugin/src/shared/auth.js` (`resolveToken`,
`readAuthToken`). The integration surface is `ctx.integration` in
`plugin/src/v2.js`, following the same guard pattern used for
`ctx.provider` and `ctx.command`. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Make a Modeselect provider key win over `OPENCODE_API_KEY`.
- Keep the existing chain (option, env, opencode/opencode-go) intact.
- Register the integration only when the host supports it.

**Non-Goals:**
- No OpenChamber UI changes (per user decision).
- No changes to the `token`/`jevToken` plugin options or the managed config.

## Decisions

- **D1 — Provider id `modeselect`.** Matches the virtual provider id already
  used by the plugin; single name across auth store and integration.
- **D2 — Precedence order.** option → modeselect auth key → env →
  opencode/opencode-go. Modeselect key beats env but loses to an explicit option.
- **D3 — Auth cache.** Reuse the existing memoized `readAuthToken`; add
  `modeselect` first in `PROVIDER_IDS`. `resolveToken` checks the cached auth
  result's source before consulting env.
- **D4 — Integration registration.** Guarded by `ctx.integration?.transform`.
  Register `key` and `env` methods. If the integration does not yet exist, call
  `editor.add` first (best-effort, wrapped in try/catch). Registration failure
  is non-fatal; token resolution still works from auth.json/env.
- **D5 — Runtime resolution.** Continue reading auth.json directly rather than
  calling `ctx.integration.connection.resolve`, to keep the zero-dependency,
  synchronous path used by tests. Integration registration only enables
  `opencode auth login modeselect`.

## Risks / Trade-offs

- [Integration `add` signature may differ by host version] → wrapped in
  try/catch; worst case the integration is not registered and users store the
  key manually in auth.json.
- [Cached auth read goes stale when key is added] → existing `clearAuthCache()`
  covers this; documented in spec.

## Migration Plan

1. Update `auth.js` provider list and `resolveToken` ordering.
2. Add integration transform block in `v2.js`.
3. Update tests for new precedence and provider id.

## Open Questions

(none)
