# Orchestrator learnings

- 2026-09-24: no `.opencode/orchestrator.md` model pools here → session-default model for all tasks; never pass explicit `model` to subagents.
- 2026-09-24: `tui.*` plugin hooks never render in OpenChamber (serve mode); v1 chat-visible channel is `ignored:true` text part (zero-token: skipped by `toModelMessages` + compaction, still rendered); v2 only `prompt`-hook edits render (~15 tok/turn), `context` edits never persist.
- 2026-09-24: v1 `chat.message` parts pushed after `await` need explicit `id`/`sessionID`/`messageID` (hook-timing crash, anomalyco/opencode#23440).
- 2026-09-24: review subagents here have no shell — orchestrator must run `node --test`/`node --check` itself for gate validation; treat reviewer test claims as unverified until then.
- 2026-09-24: untracked-but-ignored files (via untracked `.gitignore`) are clobber risks for implementers — put "extend, don't replace" explicitly in scope + check `git status` in base after merge.
- 2026-09-24: plugin tests run with `node --test plugin/test/` from repo root; `node --check` per touched file; 43 tests green is the current baseline.
- 2026-09-24: `.opencode/.modelselect-cache/` is runtime-generated; kept on disk, ignored via `.opencode/.gitignore`.
- 2026-09-24: task worktrees in `/private/var/folders/_n/6b7jwbns0d99ps9k6g54pqs00000gn/T/opencode/<name>` with `-b feature/<name>` from base SHA; remove worktree + delete branch right after merge.
- 2026-09-25: code-reviewer passed an OpenChamber manifest with keys at the wrong nesting level — orchestrator must validate manifest shape itself (assert contributes.* paths, not just node --check).
- 2026-09-25: rebasing stacked deliveries — cherry-pick only the top commit onto the rebased base instead of rebasing the whole stack (avoids replaying lower commits into conflicts).
