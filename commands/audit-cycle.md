---
description: Orchestrate the audit chain — /sweep → /triage-findings → /spawn-tickets per ready plan. One command, three natural pause points (per-phase confirms), no re-typing between phases.
argument-hint: "[target-dir]  (defaults to repo root; same as /sweep)"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, mcp__linear
---

# /audit-cycle — orchestrated audit chain

Sequence `/sweep` → `/triage-findings` → `/spawn-tickets` (per ready plan) in one continuous flow. Each underlying skill's gates remain — this orchestrator just removes the manual re-typing between phases. Read `~/.claude/workflow-conventions.md` first.

## Start check (soft)
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` if given, else `$root`. Resolve absolute.
- If cwd has `.claude/active-project.json` (you're inside a project worktree): warn — auditing usually runs from the main worktree on `<baseBranch>`. Ask whether to proceed here or `cd` to main first. Don't hard-block.
- Read `<root>/.claude/ticket-flow.json`; missing → `/ticket-flow-init`, STOP.

## Resumability detect (idempotent re-entry)
Before starting Phase 1, check for partial state from a prior `/audit-cycle` on this target:
- No `docs/plans/<slug>-sweep.md` for this target → fresh run, start at Phase 1.
- `<slug>-sweep.md` exists, `Status` ≠ `done` → resume Phase 1 (sweep skill handles its own resume from the first unchecked Manifest part).
- `<slug>-sweep.md` `Status: done` + `<slug>-findings.md` exists, no `→ filed as` / `→ planned in` annotations → ask: resume at Phase 2?
- Findings doc has annotations + ready plan files exist that haven't been spawned (no `## Tickets` section) → ask: resume at Phase 3?

Confirm where to resume before doing anything; don't silently re-do.

## Phase 1 — /sweep
Read `~/.claude/commands/sweep.md` and execute it literally for the target. **Honor its Phase A confirm gate** (manifest sign-off) — do not auto-approve. On completion you have:
- `docs/plans/<slug>-sweep.md` (`Status: done`)
- `docs/plans/<slug>-findings.md` (final findings + severity summary)
- Possibly authored CLAUDE.md files / proposed CLAUDE.md diffs pending approval

### Phase-1 pause point (mandatory)
Print:
- Findings doc path + severity counts (critical / high / med / low).
- Top 3-5 highest-severity items.
- Any CLAUDE.md proposed-diff approvals still pending (these are owned by `/sweep`, not this orchestrator — `/audit-cycle` only surfaces them).

Ask explicitly: **proceed to Phase 2 (`/triage-findings`)?**
- **No** → STOP cleanly. The sweep artifacts are durable; user can run `/triage-findings <findings-doc>` whenever.
- **Yes** → Phase 2.

If `/sweep` produced **zero findings**: skip Phase 2 and Phase 3, jump to the final report.

## Phase 2 — /triage-findings
Read `~/.claude/commands/triage-findings.md` and execute it literally on `docs/plans/<slug>-findings.md`. **Honor its interactive triage prompt + step-3 confirm gate** — those represent the user's classification + execution authorization. On completion you have:
- N standalones filed in `<standaloneProject>` (each annotated `→ filed as <ID>` in the findings doc).
- M plan files at `docs/plans/<plan-slug>.md` (each `Status: ready` or `Status: stack-needs-review`).
- Plan-referenced findings annotated `→ planned in <plan-path>`.

### Phase-2 pause point (mandatory)
Print:
- Standalones created (count + IDs grouped by priority, bucket URL).
- Plans READY (paths + Manifest part counts + Stack call).
- Plans NEEDS REVIEW (paths + which Choice(s) need interactive finishing).
- Skipped findings count.

Ask explicitly: **proceed to Phase 3 (`/spawn-tickets` per ready plan)?**
- **No** → STOP cleanly. Plans are local files; user can run `/spawn-tickets <path>` per plan whenever, and `/plan "<scope>"` to finish any stack-needs-review ones interactively.
- **Yes** → Phase 3.

If Phase 2 produced **zero ready plans** (all standalones, or all plans need-review): skip Phase 3, jump to the final report.

## Phase 3 — /spawn-tickets (sequential, per ready plan)
For each plan file with `Status: ready` (skipping `stack-needs-review` ones), in stable order (creation time / alphabetical):
- Read `~/.claude/commands/spawn-tickets.md` and execute it literally for that plan path.
- **Honor each invocation's preview + step-2 confirm gate independently.** Each plan deserves its own slice-review before becoming a Linear project — this gate is non-batchable; do NOT ask one mega-yes for all plans.
- On approval: spawn-tickets commits + pushes the plan to `<baseBranch>` atomically with the Linear writes (per convention 1).
- If the user denies at a plan's gate: skip that plan (it stays as a ready file; user can spawn later). Continue with the next ready plan.

Do NOT auto-fire `/next-ticket` after spawn-tickets — picking up work is a separate discrete action that the user chooses per-project / per-terminal.

## 4. Final report + next step (convention 4)
- **Sweep**: target, units swept, findings count by severity.
- **Triage**: standalones created (IDs), plans ready / needs-review (paths), skipped count.
- **Spawned**: Linear projects created + per-project ticket counts + URLs. Denied-at-gate plans (still available as files).
- **Pending human work**:
  - Stack-needs-review plans: `/plan "<scope>"` to finish each interactively.
  - CLAUDE.md proposed diffs still un-approved.
  - Standalones in bucket waiting to be picked.
- **Next step**:
  - For spawned feature projects: `/next-ticket <Project-Name>` (from main worktree) to start its first ticket.
  - For standalones: `/next-ticket <STANDALONE-ID>` (from main worktree) to start any of them in parallel.
  - For stack-needs-review plans: `/plan "<scope>"` interactively, then `/spawn-tickets <path>`.

## Hard rules
- Never skip the underlying skills' gates — each phase's skill owns its own confirm gates; `/audit-cycle` only adds the one "proceed?" between phases.
- Per-plan spawn-tickets gates in Phase 3 are non-batchable — each plan = its own user yes/no.
- Skip plans with `Status: stack-needs-review` in Phase 3 — they need interactive `/plan` to settle first.
- Do not auto-commit anything the underlying skills wouldn't commit on their own. `/sweep` and `/triage-findings` don't commit; `/spawn-tickets` does (atomically with its Linear write per convention 1).
- Don't auto-fire `/next-ticket` / `/land-ticket` at the end — those are separate discrete actions per terminal/worktree.
- Idempotent re-entry: detect partial state, ask where to resume, never silently re-execute completed phases.
- Single target per invocation. If the user wants to audit multiple subtrees, run `/audit-cycle` once per target.
