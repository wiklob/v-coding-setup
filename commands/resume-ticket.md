---
description: Resume an In Progress ticket — find it, switch to its branch in its project worktree, reload context, hand off to interactive build. Never changes Linear state.
argument-hint: "[ISSUE-ID]  (omit to auto-pick — fails if multiple In Progress)"
allowed-tools: Bash, Read, mcp__linear, EnterWorktree, ExitWorktree
---

# /resume-ticket — pick back up where you left off

Use this when an In Progress ticket already exists (session interrupted mid-build, day continued). It does NOT ingest new tickets, create branches, or transition Linear state — `/next-ticket` does that. Read `~/.claude/workflow-conventions.md` first and follow it.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; this exact command-launch checkout is the explicit `sourceRoot` whenever this invocation resolves a worktree path. Never substitute the common Git directory or the first worktree-list row. Read `$root/.claude/ticket-flow.json`; missing → `/ticket-flow-init`, STOP. Use `linearTeam`, `scopeLabel`, `baseBranch`.
- Determine whether `$root` is a linked worktree by comparing its absolute `--git-dir` and `--git-common-dir`. If linked, run `node ~/.claude/bin/ticket-worktree.mjs migrate-binding --worktree "$root"` before any binding presence/read, then `node ~/.claude/bin/ticket-worktree.mjs binding-status --worktree "$root"`; malformed/conflicting legacy state hard-STOPs. `private` → read with `node ~/.claude/bin/ticket-worktree.mjs read-binding --worktree "$root"`; `none` → treat as unbound. Do not call binding commands on the primary checkout, and never access the legacy checkout marker directly.

## 1. Find the In Progress ticket
- **If the helper returned a binding for the launch worktree:** scope the lookup to it — feature/milestone bindings use `project: <binding.linearProject>`; standalone binding names `binding.linearIssue` directly (verify that issue). Never infer binding presence from a checkout file.
- **Else** (cwd is primary / unbound): list across the team — every project, `label: <scopeLabel>`, `state: In Progress`, `assignee: me`. Useful when you don't remember which project you were in.
- `$ARGUMENTS` = ISSUE-ID → take that one (verify: In Progress, assignee me, carries `<scopeLabel>`; if not, say why and STOP — don't silently coerce).
- 0 hits → "nothing to resume; try `/next-ticket`." STOP.
- 1 hit → use it.
- 2+ hits → list (`id · title · project · updatedAt`), ask which. Never auto-pick across multiple.

## 2. Resolve the worktree (mode-aware — convention 5 + worktree-mode eligibility)
Determine mode from the ticket's parent project (convention 5's worktree-mode eligibility — read the parent project's Linear labels, precedence `milestone-parallel` > `parallel` > none):
- Parent project = `cfg.standaloneProject` → **standalone mode** (no extra call).
- Else: one `mcp__linear get_project` on the parent → labels include `milestone-parallel` → **milestone mode** (bound milestone = the ticket's own `projectMilestone`); else labels include `parallel` → **standalone mode**; otherwise → **feature mode**.

Resolve the path without reimplementing the basename/sanitizer:
- **Already bound launch worktree:** `WT_ABS="$root"`. Verify the helper-returned binding matches the ticket (standalone → `linearIssue`; feature → parent `linearProject`; milestone → parent `linearProject` + ticket `projectMilestone.id`). If this is an already-entered legacy sibling, keep using it and defer path migration — never move the current cwd. Drift → STOP.
- **Unbound launch checkout:** call the installed helper with the explicit launch `sourceRoot="$root"`:
  - Standalone: `node ~/.claude/bin/ticket-worktree.mjs resolve --root "$root" --mode standalone --issue "<ISSUE-ID>"`.
  - Feature: `node ~/.claude/bin/ticket-worktree.mjs resolve --root "$root" --mode feature --project "<project-slug>"`.
  - Milestone: `node ~/.claude/bin/ticket-worktree.mjs resolve --root "$root" --mode milestone --project "<project-slug>" --milestone "<milestone-name>"`.
  Read the JSON in-context and capture `managedPath`, `legacyPath`, `preferredPath`, and `layout`. This preserves the exact existing Linear project/issue/milestone basename semantics.
- Classify both returned paths in `git -C "$root" worktree list --porcelain` plus the filesystem. Both registered, or registration/occupancy on both paths, is a conflict → hard STOP. For ordinary repos: managed registered only → use it; legacy registered only → managed must be absent from registration and disk, then run `node ~/.claude/bin/ticket-worktree.mjs move-legacy --root "$root" --legacy "<legacyPath>" --managed "<managedPath>"` and use its returned path (`moved` normally; `deferred-current-worktree` keeps legacy). For the exact `~/.claude` source, use the legacy sibling and do not migrate. Neither registered → STOP and tell the user to run `/next-ticket <ISSUE-ID>` (standalone/milestone) or `/next-ticket <project>` (feature) to re-establish; `/resume-ticket` never creates.
- **Switch the session into `WT_ABS`:** `EnterWorktree(path: "$WT_ABS")`. Required before further file operations; if already there, call `ExitWorktree(action: "keep")` first, then re-enter.
- After entering, run `node ~/.claude/bin/ticket-worktree.mjs migrate-binding --worktree "$WT_ABS"`, then `node ~/.claude/bin/ticket-worktree.mjs read-binding --worktree "$WT_ABS"`; conflicts/malformed state hard-STOP. Verify the returned binding matches the ticket as above. No direct checkout-marker read.

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
