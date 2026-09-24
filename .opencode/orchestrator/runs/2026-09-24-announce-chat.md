# run: announce-chat   status: active
request: Show modelselect pick in chat (works in OpenChamber, minimal token cost) — acceptance: chat-visible announce of task/tier/model only on actual model switch per session, gated by new option default off, v1+v2, tests pass
base: feature/modelselect-plugin @ ae0d872b2c2997646bff7b550b401c13f9a8021c
| id | kind | status | complexity | model | session | worktree/branch | validated_commit | rounds | depends_on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| research-announce-channel | research | ready | normal | session-default | — | — | — | 0 | — |
| implement-announce | implementation | pending | normal | session-default | — | — | — | 0 | research-announce-channel |
| verify-announce | verification | pending | normal | session-default | — | — | — | 0 | implement-announce |
## Decisions
- 2026-09-24: single implementation task covering v1+v2+option+tests+docs (scopes overlap, so serialized not parallel) — keeps diff small per acceptance>small-diff rule
- 2026-09-24: keep `.opencode/.modelselect-cache/` on disk, ignore it via gitignore in implementation task — user decision
## Findings & risks
- Base has untracked `.opencode/.modelselect-cache/` (runtime cache, not user work); repo otherwise clean. Will be ignored by implement-announce.
- `tui.toast.show` is TUI-only, does not render in OpenChamber serve mode — needs chat/out-of-band channel (research).
- Any chat-rendered part becomes history and costs tokens by definition — announce must fire only on actual switch, terse format.
