---
description: Bulk-execute standalone bucket tickets — auto-apply atomic findings, group into M coherent PRs, one batch-review per group. Targets a registered standalone bucket (default: the primary standaloneProject; --project picks another). Dry-run flag supported.
argument-hint: "[--project <bucket>] [--dry-run] [--priority low,med,high,critical] [--ids ID1,ID2,...]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, mcp__linear
---

# /bulk-fix — bulk-execute standalone bucket tickets

Use this when you have many small atomic tickets in a standalone bucket `<bucket>` (e.g. from `/triage-findings` after a `/sweep`, or `/harvest-pipeline-bugs` filing into `bugs`) and you'd rather batch-execute them than work through each via `/next-ticket → build → /land-ticket`. Auto-applies the change described in each ticket, groups them into coherent PRs, gives you one confirm per group.

**Targets a registered standalone bucket — never feature projects.** Read `~/.claude/workflow-conventions.md` first.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`. Missing → `/ticket-flow-init`, STOP.
- Required fields: `linearTeam`, `scopeLabel`, `baseBranch`, **`standaloneProject`**. If `standaloneProject` is unset → STOP, tell user to set it (the bucket is the input source). `requiredCheck` is **optional** — when the repo omits it (e.g. a no-CI repo like `~/.claude` itself), the per-commit required-check step (§4) is skipped rather than run on an empty check.
- **Resolve the target bucket `<bucket>`** (the multi-bucket extension):
  - No `--project` → `<bucket>` = `cfg.standaloneProject` (the primary; unchanged default behavior).
  - `--project <name>` → `<bucket>` = `<name>`, which **must** be a member of `cfg.standaloneProjects` (the registered-bucket list) — or equal `cfg.standaloneProject` when no list is set. A `--project` naming an unregistered project → STOP (`--project "<name>" is not a registered standalone bucket; registered: <cfg.standaloneProjects | cfg.standaloneProject>`). This guard is what keeps `/bulk-fix` from ever operating on a feature project.
  - Everywhere below, `<bucket>` is the resolved target — it replaces the old single `<standaloneProject>` reference.

## 1. Select tickets
Pull from `<bucket>` via `mcp__linear list_issues`:
- `state` in `[Todo, Backlog]` (Done/Canceled excluded; In Progress excluded — user is working those manually).
- `label: <scopeLabel>`.
- Exclude any with unresolved `blockedBy`.

Apply optional filters from `$ARGUMENTS`:
- `--priority` → comma-separated list of priorities to keep (e.g. `--priority low,med`).
- `--ids` → explicit ticket IDs only.
- `--dry-run` → run through step 3 (group + show planned diffs), then STOP without executing.

0 eligible after filter → STOP, report what's filtered out and why.

## 2. Parse + classify auto-apply eligibility
For each candidate ticket: parse description for the structured finding body. Tickets created by `/triage-findings` have:
- `[<sev>] <file:line> — <issue> → <suggested action>` (verbatim from sweep)
- `## Acceptance` with the action verified-met item.

Tickets WITHOUT this structure (manually created, no `file:line` cite) → mark `needs-eyes` from the start (not eligible for auto-apply). Surface them at step 3 so the user sees they're out of scope.

> **Harvest patch-tickets (`bugs`) classify `needs-eyes` by design** — they carry Problem / Evidence / Fix-sketch / `harvest-key`, deliberately no `[<sev>] <file:line> → <action>` line; the fix is a judgment call, not a mechanical edit. `/bulk-fix --project "bugs"` gives them grouping + the per-group review gate (§3, §5), not auto-apply; the fix is made in the per-group subagent or via `/next-ticket <ID>`.

## 3. Group + confirm gate
Propose groups using heuristic (default; user can override at confirm):
- Same file → same group.
- Same recurring pattern across files (e.g. all `.maybeSingle()` swaps, all `console.log` removals) → same group.
- Same priority + same sweep unit (P10, P12, etc.) → fallback grouping.

Aim for ~5-10 groups for a typical batch. Each gets a slug (e.g. `console-log-cleanup`, `maybesingle-swaps`, `loose-typing`).

**Confirm gate (mandatory):** print proposed groups with their tickets + a one-line note per finding (`<file:line> — <action>`). User can: accept, regroup, split, merge, drop tickets. Print ineligible (`needs-eyes`-from-start) tickets separately so user knows they're out of scope. No subagent dispatch until explicit go.

If `--dry-run`: for each group, also print the would-be diff per finding (subagent reads source + computes change without committing). Skip steps 4-7.

**End the dry-run with a SHORT next step.** `/bulk-fix` is **idempotent over its inputs** — same Backlog + same `<scopeLabel>` + same classification rules → same split next run. So the next step is just:

> Dry-run complete. Re-run `/bulk-fix` to execute.

**Never enumerate the auto-apply IDs as a `--ids` flag list.** A 40-ID comma-separated command is unusable and redundant with state already in Linear. If the user wants to *permanently exclude* the needs-eyes tickets from future runs, the right move is to change their Linear state/label (e.g. move them out of Backlog, or remove `<scopeLabel>`) — not to re-paste IDs. Tell them that if they ask how to lock those out. END.

## 4. Dispatch (parallel subagents, capped at 5)
Spawn one `Agent` subagent per group, **in parallel** (single tool-use block with N invocations, max 5; serialize remaining groups if more than 5). Each subagent's brief — verbatim, substituting `<GROUP_SLUG>`, `<REPO_ROOT>`, `<BASE_BRANCH>`, `<REQUIRED_CHECK>`, `<TICKETS_JSON>`:

```
You are an executor running bulk auto-apply for ONE group of standalone bucket tickets.

# Working dir
Create a transient worktree:
  git -C "<REPO_ROOT>" worktree add "../<repo-basename-sanitized>-wt-bulkfix-<GROUP_SLUG>" origin/<BASE_BRANCH>
cd into it. Bootstrap deps (`npm ci` if package-lock.json, else `npm install`, or repo's documented equivalent — REQUIRED to avoid the bare-npx-tsc false-green trap per workflow-conventions.md convention 5).

# Branch
git switch -c bulk/<GROUP_SLUG>

# Tickets (ordered: by file path, then by line number)
<TICKETS_JSON>  — array of { id, description (full ticket body with file:line + action), priority }

# Per ticket
1. Re-read the source at the ticket's cited file:line. **Verify the context matches the finding's claim** — code may have drifted since the sweep. If file moved, line off by more than a few, or the cited code no longer exists: flag `needs-eyes` (reason: "source drifted"), skip, continue.
2. Apply the change LITERALLY per the suggested action. Confident-OK actions: delete a line, swap `.single()` → `.maybeSingle()`, fix a string typo, remove dead code/dep, update a comment, swap `as any` for a typed shape that's already declared elsewhere in the file. Actions requiring real judgment ("extract this helper", "refactor that", "decide between A and B"): flag `needs-eyes`, skip.
3. Run the repo's required check (`<REQUIRED_CHECK>`) locally on the working tree. If it fails after this commit's changes: `git checkout -- .` to revert this ticket's edits, flag `needs-eyes` (reason: "required-check regression"), continue with the next ticket.
4. **Migration safeguard:** if the ticket's action would create/modify `supabase/migrations/*` or any DB schema file: abort that ticket immediately → `needs-eyes` (reason: "migration — needs /land-ticket gate"). Migrations never go through bulk-fix.
5. Stage the change. Commit with title = one-line action (imperative, ≤72 chars) and body containing a **non-closing** ref `Part of <TICKET-ID>` (never `Closes/Fixes/Resolves` — Linear scans commit messages too and would auto-close on merge, cross-firing any in-flight bucket ticket). The ticket is closed explicitly in §6 after merge. One commit per ticket.

# After all tickets processed
- If ≥1 commit landed: push branch (`git push -u origin bulk/<GROUP_SLUG>`), open PR with `gh pr create --base <BASE_BRANCH>`. Title: `bulk: <group description>`. Body: a **non-closing** `Part of <ID>` line per committed ticket + a "Skipped (needs-eyes)" section listing each skipped ticket + reason. Run `pr-close-guard --body-file <body-file>` on the body before `gh pr create` and abort on non-zero — no closing keyword may reach the PR (the committed tickets are closed explicitly in §6).
- If 0 commits landed (entire group went needs-eyes): destroy the worktree (`git worktree remove`), don't open a PR, return needs-eyes list only.

# Don't
- Don't transition Linear state during the per-ticket subagent run (steps 1–5). The explicit close happens once, in §6, after the group's PR actually merges (no magic-word auto-close).
- Don't widen scope. Apply the literal action; "delete line 33" means delete only line 33.
- Don't push without all tickets processed first.

# Return (terse — only this reaches parent)
1. Group slug, branch name, PR URL (or "no PR — all skipped").
2. Tickets committed (IDs).
3. Tickets skipped (IDs + reason per — one-line each).
4. Worktree path (if still alive).
```

## 5. Batch review (one confirm per group, non-batchable)
After all subagents return, print:
- Per group: PR URL, commit count, files changed, tickets-committed (IDs), tickets-skipped (IDs + reasons).
- All `needs-eyes` tickets across groups in one summary block so user sees the total leftover.

**One confirm per group**, in sequence. For each PR: show its `gh pr diff --stat` + commit list; ask approve/deny. **Non-batchable** — don't ask "approve all at once"; per-group judgment is the win. User attends each PR, decides.

## 6. Merge approved groups (sequential)
For each approved group's PR, sequentially:
- Verify `<requiredCheck>` is green (`pr-health <n>` shows the check rollup; poll if pending).
- `gh pr merge <n> --merge` (**no `--delete-branch`** — it fails when `main` is checked out in another worktree, though the merge itself lands; branch teardown is explicit at the worktree-removal step below).
- **Close the group's committed tickets explicitly** — merge transitions nothing (no closing keyword in the PR): for each committed ticket `mcp__linear save_issue` state Done with a one-line summary comment. This is the sole close path.
- Remove the transient worktree, then delete its now-free branch — **order matters:** git refuses to `branch -D` a branch still checked out in a worktree, so remove the worktree first. As discrete calls: `git worktree remove ../<repo>-wt-bulkfix-<GROUP_SLUG>`, then `git branch -D <group head-branch>` (local), then `git push origin --delete <group head-branch>` (remote — what `--delete-branch` used to do). Run the branch ops from the main checkout.

For denied groups: leave the PR open + worktree intact. User can attend manually later.

## 7. Annotate needs-eyes tickets in Linear
For each `needs-eyes` ticket (across all groups + the up-front ineligible ones): `mcp__linear save_comment` with the skip reason. A future `/next-ticket <ID>` pickup gets the context.

## 8. Report + next step (convention 4)
- Groups created (count) + PRs merged + PRs denied.
- Tickets landed (count + IDs). Tickets `needs-eyes` (count + IDs + reasons).
- **Next step**: for needs-eyes leftovers — `/next-ticket <ID>` to pick any up manually (standalone-mode per-ticket worktree); for denied PRs — review on GitHub, fix manually, merge yourself.

## Hard rules
- Targets the resolved `<bucket>` — a registered standalone bucket (`cfg.standaloneProject` by default, or a `--project`-named member of `cfg.standaloneProjects`). Never operates on feature projects; a `--project` naming an unregistered project STOPs.
- Never auto-merges without per-group user approval at step 5. **Non-batchable** confirms.
- Never widens a ticket's scope; subagent applies literal actions only. Any ambiguity → `needs-eyes`.
- Per-commit `<requiredCheck>` validation; required-check regression on a single commit → that ticket goes `needs-eyes`, others in the group continue.
- **Migrations** never go through bulk-fix — any migration touch → immediate `needs-eyes` (migrations need `/land-ticket`'s explicit confirm gate per `migration-safety.md`).
- Never auto-revert a bad commit on `<baseBranch>` — if something slips review and breaks main, the user reverts manually.
- Capped at 5 concurrent subagents; serialize remaining groups beyond that.
- Idempotent: re-running filters out Done tickets via state check; partial-run resumes from remaining open tickets.
- `--dry-run` is the safe default for first use on a new findings batch — validates grouping + planned diffs without commits or PRs.
