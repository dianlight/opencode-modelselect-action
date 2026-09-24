# run: announce-chat   status: done
request: Show modelselect pick in chat (works in OpenChamber, minimal token cost) — acceptance: chat-visible announce of task/tier/model only on actual model switch per session, gated by new option default off, v1+v2, tests pass
base: feature/modelselect-plugin @ ae0d872b2c2997646bff7b550b401c13f9a8021c
| id | kind | status | complexity | model | session | worktree/branch | validated_commit | rounds | depends_on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| research-announce-channel | research | validated | normal | session-default | ses_f2de684ceffeLfM9wAcsaiy4hJ | — | — | 0 | — |
| implement-announce | implementation | validated | normal | session-default | ses_f2de1fdb8ffePc7t8yTlr76L2J | /private/var/folders/_n/6b7jwbns0d99ps9k6g54pqs00000gn/T/opencode/modelselect-announce / feature/modelselect-announce | b1e857c861d53e4dd7b4f43ef63909af0138135a | 1 | research-announce-channel |
| verify-announce | verification | revalidated | normal | session-default | ses_f2ddc74c1ffeyBJND9gdcBBRfN | /private/var/folders/_n/6b7jwbns0d99ps9k6g54pqs00000gn/T/opencode/modelselect-verify / verify/announce | — | 0 | implement-announce |
## Decisions
- 2026-09-24: single implementation task covering v1+v2+option+tests+docs (scopes overlap, so serialized not parallel) — keeps diff small per acceptance>small-diff rule
- 2026-09-24: keep `.opencode/.modelselect-cache/` on disk, ignore it via gitignore in implementation task — user decision
- 2026-09-24: reviewer could not execute tests (no shell in review session) — orchestrator ran `node --test` directly in delivery worktree: 43/43 green at 5d6d160; independent verify task confirmed same on snapshot
- 2026-09-24: integration regression (implementer clobbered untracked `.opencode/.gitignore`) caught at merge review → rework round 1, replacement validated_commit b1e857c, dependent revalidated (one cascade, 43/43 at new SHA)
- 2026-09-24: e2e on integration commit 950567a PASS (both hosts driven live w/ seeded cache, dedup + off-gating confirmed)
## Findings & risks
- Base has untracked `.opencode/.modelselect-cache/` (runtime cache, not user work); repo otherwise clean. Will be ignored by implement-announce.
- `tui.toast.show` is TUI-only, does not render in OpenChamber serve mode — needs chat/out-of-band channel (research).
- Any chat-rendered part becomes history and costs tokens by definition — announce must fire only on actual switch, terse format.
