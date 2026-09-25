# run: openchamber-extension   status: active
request: OpenChamber extension (work status section) showing modelselect session stats + on/off/auto mode switch — acceptance: status section shows task/tier/model/jev/go-zen per session, error when plugin missing, mode switch honored by plugin v1+v2, tests pass
base: feature/modelselect-plugin @ 12cfcd7
| id | kind | status | complexity | model | session | worktree/branch | validated_commit | rounds | depends_on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| research-auto-detect | research | pending | normal | session-default | — | — | — | 0 | — |
| implement-plugin-status | implementation | pending | normal | session-default | — | — | — | 0 | research-auto-detect |
| implement-extension | implementation | pending | normal | session-default | — | — | — | 0 | implement-plugin-status |
| verify-e2e | verification | pending | normal | session-default | — | — | — | 0 | implement-extension |
## Decisions
- 2026-09-25: 4-task serial chain (research → plugin status+mode → extension UI → verify); extension serialized after plugin so it builds against the real status-file contract, not a guessed one (rejected: parallel with orchestrator-dictated schema)
- 2026-09-25: rubber-duck unavailable (free-tier execution error) — self-review substituted: risks are Auto-model-ref detection, managed-server config path, 320px status clamp
## Findings & risks
- Extension sandbox sees only open-project files + declared filesystem patterns; needs plugin-written status JSON under <project>/.opencode/.modelselect-cache/
- OpenChamber managed server ignores global opencode.json — install check must cover managed config path
- No model pools configured → session-default model everywhere, no explicit model param
