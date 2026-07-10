---
description: Resume an In Progress ticket — find it, switch to its branch in its project worktree, reload context, hand off to interactive build. Never changes Linear state.
argument-hint: "[ISSUE-ID]  (omit to auto-pick — fails if multiple In Progress)"
allowed-tools: Bash, Read, mcp__linear, EnterWorktree, ExitWorktree
---

# /resume-ticket — pick back up where you left off

Use this when an In Progress ticket already exists (session interrupted mid-build, day continued). It does NOT ingest new tickets, create branches, or transition Linear state — `/next-ticket` does that. Read `~/.claude/workflow-conventions.md` first and follow it.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`; missing → `/ticket-flow-init`, STOP. Use `linearTeam`, `scopeLabel`, `baseBranch`.

## 1. Find the In Progress ticket
- **If cwd is a project worktree** (`.claude/active-project.json` present): `mcp__linear list_issues` with `team: <linearTeam>`, `project: <bound>`, `label: <scopeLabel>`, `state: In Progress`, `assignee: me`.
- **Else** (cwd is main / unbound): list across the team — every project, `label: <scopeLabel>`, `state: In Progress`, `assignee: me`. Useful when you don't remember which project you were in.
- `$ARGUMENTS` = ISSUE-ID → take that one (verify: In Progress, assignee me, carries `<scopeLabel>`; if not, say why and STOP — don't silently coerce).
- 0 hits → "nothing to resume; try `/next-ticket`." STOP.
- 1 hit → use it.
- 2+ hits → list (`id · title · project · updatedAt`), ask which. Never auto-pick across multiple.

## 2. Resolve the worktree (mode-aware — convention 5 + worktree-mode eligibility)
Determine mode + worktree path from the ticket's parent project (convention 5's worktree-mode eligibility — read the parent project's Linear labels, precedence `milestone-parallel` > `parallel` > none):
- Parent project = `cfg.standaloneProject` → **standalone mode** (no extra call).
- Else: one `mcp__linear get_project` on the parent → labels include `milestone-parallel` → **milestone mode** (bound milestone = the ticket's own `projectMilestone`); else labels include `parallel` → **standalone mode**; otherwise → **feature mode**.

Path by mode:
- Standalone: `../<repo-basename-sanitized>-wt-<issue-key-lowercased>` (e.g. `../trashart-wt-art-3`).
- Feature: `../<repo-basename-sanitized>-wt-<project-slug-sanitized>` (sanitization rule per convention 5).
- Milestone: `../<repo-basename-sanitized>-wt-<project-slug-sanitized>-<milestone-slug-sanitized>` — both halves sanitized + capped 40 **independently** per convention 5 (the same derivation `/next-ticket` §1.C uses); the milestone name comes from the ticket's `projectMilestone`.

Verify the path exists in `git worktree list`.
- **Missing**: STOP and tell the user to run `/next-ticket <ISSUE-ID>` (standalone or milestone) or `/next-ticket <project>` (feature) to re-establish — re-establishment is `/next-ticket`'s job, not this skill's.
- **Present:** `cd` to it. Verify the worktree's `.claude/active-project.json` binding matches the ticket: standalone → `linearIssue` = the ticket; feature → `linearProject` = the ticket's parent project; milestone → `linearMilestone` = the ticket's `projectMilestone.id` (and `linearProject` = its parent project). Drift → STOP, surface, don't paper over.
- **Switch the session into the worktree:** `EnterWorktree(path: "<wt-path>")`. **Required before any further file ops** — in bg sessions the harness's bg-isolation guard prompts on every Edit/Write/Bash with side-effects until the session is "inside" an isolated worktree, regardless of permission allows. Safe in foreground sessions (just changes cwd). If already in this worktree, `EnterWorktree` errors with "already in a worktree" → call `ExitWorktree(action: "keep")` first, then re-enter.

## 3. Switch to the ticket branch
- Branch name = the issue's Linear `gitBranchName` (verbatim — that's the auto-link).
- If already on it → fine. Else: working tree must be clean (uncommitted work on a different branch belongs to a different ticket — STOP and ask). `git fetch origin <baseBranch>`; if the branch exists locally, `git switch <gitBranchName>`; if only on origin, `git switch <gitBranchName>` (sets up tracking); if it exists nowhere, STOP — an In Progress ticket without a branch suggests an earlier crash, surface it to the user (don't recreate without explicit go).

## 4. Reload context, hand off — STOP
Print, in this order, terse:
- Ticket id + title + link; the issue's `## Acceptance` checklist (as-is — convention 3).
- Recent commits on this branch: `git log --oneline origin/<baseBranch>..HEAD`.
- Files touched so far: `git diff --name-only origin/<baseBranch>..HEAD` (and any uncommitted: `git status --short`).
- **Build plan check:** if `$WT_ABS/docs/plans/<ticket-id-lowercased>-build.md` exists, note "build plan from `/scope` ready at `<path>` — `/build` will follow it." If absent, note "no `/scope` plan yet."
- One-line "you were last working on …" if obvious from the latest commit / dirty files.

Then: **do NOT implement** and **do NOT change Linear state** (the ticket is already In Progress — leave it alone).

**End — next step:** `/build` (autonomous — picks up the build plan if present) → `/land-ticket` when acceptance is met. For non-trivial tickets without a `/scope` plan, run `/scope` first (or `/build --force`). If a prior `/build` was checkpoint-stopped (`--stop-after-implement`, `--no-push`, etc.), re-run `/build` to continue. If something looks off (wrong branch, drift), name the specific check that failed.

## Hard rules
- Never changes Linear state — resume is a no-op from Linear's POV.
- Never auto-picks across multiple In Progress hits — always list and ask.
- Never recreates a torn-down worktree — that's `/next-ticket`'s job.
- One ticket per invocation.
