# Commands reference — what each command does and calls

The 19 user-level slash commands at `~/.claude/commands/*.md`, grouped by phase. For each: purpose, tools available (frontmatter `allowed-tools`), slash commands it invokes (via `Skill`), subagents it spawns (via `Agent`), MCP servers it touches, and which other command(s) call it.

See also:
- `workflow-conventions.md` — the 6 conventions every command follows.
- `workflow-chains.md` — visual pipeline + typical flows.
- `pipeline-status.md` — rework/test/upgrade status per command.

---

## Phase 0 — Setup

### `/ticket-flow-init`
- **Purpose:** one-time per-repo setup — Linear scope label + `ticket-flow.json` + gitignore. Idempotent.
- **Tools:** Bash, Read, Write, mcp__linear
- **Calls slash:** —
- **Spawns:** —
- **MCP:** linear (create label, list teams/projects)
- **Called by:** humans (once per repo)

---

## Phase 1 — Create work

### `/plan`
- **Purpose:** idea → ticketable plan via multi-turn dialogue + codebase research; opens plan mode; stack-decision checkpoint; emits `docs/plans/<slug>.md`.
- **Tools:** Bash, Read, Write, Grep, Glob, EnterPlanMode, ExitPlanMode, AskUserQuestion, Agent
- **Calls slash:** `/research` (§5 Stack Decision, for net-new choices)
- **Spawns:** `Explore` subagent for broad codebase searches
- **MCP:** —
- **Called by:** humans

### `/plan-quick`
- **Purpose:** subagent-dispatched plan flavor — terse, no interactive turns. Plumbing variant of `/plan`.
- **Tools:** Bash, Read, Write, Grep, Glob
- **Calls slash:** —
- **Spawns:** —
- **MCP:** —
- **Called by:** `/triage-findings` (dispatched as N parallel `Agent` subagents)

### `/spawn-tickets`
- **Purpose:** ready plan → Linear project + tickets, with acceptance checklists and `blockedBy` dependencies. Commits + pushes plan to `<baseBranch>` atomically with the Linear writes.
- **Tools:** Bash, Read, Grep, Glob, mcp__linear
- **Calls slash:** —
- **Spawns:** —
- **MCP:** linear (create project + issues)
- **Called by:** `/audit-cycle` (per ready plan); humans

---

## Phase 2 — Build/land lifecycle

### `/next-ticket`
- **Purpose:** ingest the next ticket from the worktree's bound project — set up branch, In Progress, load context, hand off. Does NOT implement.
- **Tools:** Bash, Read, mcp__linear, EnterWorktree
- **Calls slash:** — (hands off to `/build` or interactive build)
- **Spawns:** —
- **MCP:** linear (get_issue, save_issue → In Progress, save_comment)
- **Called by:** humans

### `/resume-ticket`
- **Purpose:** pick up an In Progress ticket mid-build — find worktree, switch branch, reload context. Never changes Linear state.
- **Tools:** Bash, Read, mcp__linear, EnterWorktree, ExitWorktree
- **Calls slash:** —
- **Spawns:** —
- **MCP:** linear (list_issues, get_issue)
- **Called by:** humans

### `/research`
- **Purpose:** prior-art & industry-standards recon for a net-new solution — find the relevant standard(s) + existing implementations, make an explicit import/adapt/build-fresh call per candidate, cited. Focused build-time variant; reuses `/deep-research` for depth. Emits a `## Prior art & standards` brief.
- **Tools:** WebSearch, WebFetch, Read, Grep, Agent, Skill
- **Calls slash:** `/deep-research` (via `Skill`, only for depth on a thorny standard)
- **Spawns:** `general-purpose` subagent (broad/heavy web fetching when run standalone)
- **MCP:** —
- **Called by:** `/scope` (§5, auto-invoked for net-new tickets); `/plan` (§5 Stack Decision, for net-new choices); humans ad-hoc
- **Output:** a `## Prior art & standards` block — `/scope` pastes it into the build plan; `/plan` folds it into its Stack Decision

### `/scope`
- **Purpose:** validate an In Progress ticket against current code + produce a per-ticket build plan. Per-Acceptance-item validation, compile-check ticket-provided snippets (catches `next build`-class bugs `tsc` misses), writes `docs/plans/<ticket-id-lowercased>-build.md`. Full autonomy by default.
- **Tools:** Bash, Read, Edit, Write, Grep, Glob, mcp__linear, Agent, AskUserQuestion
- **Calls slash:** `/research` (§5, auto-invoked for net-new solutions)
- **Spawns:** `Explore` subagent (§1, broad codebase search when affected files non-obvious); `general-purpose` subagent (§5, Haiku-routed, for external-service-semantics + industry-standards research — net-new prior-art recon delegates to `/research`)
- **MCP:** linear (get_issue)
- **Called by:** humans (post `/next-ticket`, pre `/build`)
- **Output:** `docs/plans/<ticket-id-lowercased>-build.md` (committed; `/build` reads at its §1)

### `/build`
- **Purpose:** implement the active ticket end-to-end — follow `/scope` plan if present, code per Acceptance, verify, commit, push. Full autonomy by default; flag-controlled checkpoints.
- **Tools:** Bash, Read, Edit, Write, Grep, Glob, mcp__linear, Skill, Agent, AskUserQuestion
- **Calls slash:** `/verify-tests` (via `Skill` at §5)
- **Spawns:** ad-hoc (may use Agent for subtasks)
- **MCP:** linear (get_issue + sometimes list_issues for feature-mode ticket resolution)
- **Called by:** humans (post `/next-ticket`)

### `/verify-tests`
- **Purpose:** scoped pre-land test gate — tsc + vitest + playwright on what changed. ~0 tokens on green. Renamed from `/verify` to avoid built-in collision.
- **Tools:** Bash, Read, Edit, Glob, Grep, Write
- **Calls slash:** —
- **Spawns:** —
- **MCP:** —
- **Called by:** `/build` (via `Skill` at §5); humans ad-hoc
- **Known gap:** does NOT run `next build` — server/client boundary bugs (e.g. `next/headers` import poisoning client bundle) pass `tsc --noEmit` and only fail at the Netlify deploy check.

### `/land-ticket`
- **Purpose:** publish + close — open Linear-linked PR if needed → classify CI → analyze conflicts → migration scan → structured review (auto) → docs ripple scan (opt-in) → confirm gate → merge → docs append (opt-in) → cleanup → close.
- **Tools:** Bash, Read, Edit, Grep, Glob, mcp__linear, ExitWorktree
- **Calls slash:** `/review-pr` (spawned as `Agent` subagent at §4.5, literal execution)
- **Spawns:** `general-purpose` subagent (Opus or Haiku-routed by size tier) for the review at §4.5
- **MCP:** linear (get_issue, save_issue → Done, save_comment); gh CLI for PR ops
- **Called by:** humans (post `/build`)
- **Known issue:** §8.5 usage-stats helper aborts on stale `sessionId` after a context-resume (state.json's sessionId no longer points to the live JSONL).

---

## Phase 3 — Audit

### `/report-bug`
- **Purpose:** near-zero-friction front door for manually reporting a pipeline bug — one free-text note appended as a single entry to `pipeline/audit/errors.jsonl` via V-55's logger (manual mode). Tagged `activeCommand: report-bug` so the harvester distinguishes human reports from hook-caught errors and in-session self-reports. Forces zero decisions beyond the note (parity with `/capture`).
- **Tools:** Bash
- **Calls slash:** —
- **Spawns:** —
- **MCP:** —
- **Called by:** humans (and sessions noticing the pipeline misbehave)

### `/harvest-pipeline-bugs`
- **Purpose:** the single standing consumer of the `errors.jsonl` problem-sink — reads the log, routes/weights each entry by the `(tool, activeCommand)` pair (hook / human / review / self-report; no `source` field), clusters distinct problems, files **deduped** patch-tickets into the shared `bugs` bucket (every entry is pipeline-subject; the per-entry `origin` repo is triage context, not a routing key — V-88). Dedupes against open bucket tickets via a `harvest-key` so a recurring problem is never refiled. V-1 census = corroboration only.
- **Tools:** Bash, Read, Grep, mcp__linear
- **Calls slash:** — (names `/bulk-fix --project "bugs"` as the next step; doesn't invoke)
- **Spawns:** —
- **MCP:** linear (dedupe-list open bucket tickets, create patch-tickets)
- **Called by:** a daily local OS cron (`claude -p "/harvest-pipeline-bugs --yes"`, trigger); humans on demand

### `/periodic-review`
- **Purpose:** the standing weekly consumer of the pipeline's own measurement loop — runs `scorecard.mjs --aggregate --json` (which reads usage-stats + session reports + tool-fit + produced-review + gate friction), **adds the delivery review** the aggregate lacks (tickets completed using V in the window, from `usage-stats/`), emits a **durable dated actioned summary** (`pipeline/audit/periodic-review-<date>.md`), and routes each recommendation — **auto-files** pipeline/bug tickets, **proposes** craft-revisions — `review-mode: auto`. Consumes the aggregate; never re-implements it.
- **Tools:** Bash, Read, Grep, Write, mcp__linear
- **Calls slash:** — (names `/review-skill <subject>` for craft proposals + `/bulk-fix`/`/next-ticket` for filed tickets as next steps; doesn't invoke)
- **Spawns:** —
- **MCP:** linear (dedupe-list open destination tickets, file/update routed actions)
- **Called by:** a weekly local launchd agent (`claude -p "/periodic-review --yes"`, Monday 09:27, trigger); humans on demand

### `/sweep`
- **Purpose:** plan-first, resumable codebase audit — refresh per-folder CLAUDE.mds + emit reviewed findings doc. Documents + reports; never fixes code.
- **Tools:** Bash, Read, Write, Edit, Grep, Glob
- **Calls slash:** executes `/review-claude-md` and `/gen-claude-md` semantics inline (not via Skill) per directory
- **Spawns:** ad-hoc
- **MCP:** —
- **Called by:** `/audit-cycle`; humans

### `/audit-cycle`
- **Purpose:** orchestrate `/sweep` → `/triage-findings` → `/spawn-tickets` per ready plan. One command, three pause points.
- **Tools:** Bash, Read, Write, Edit, Grep, Glob, Agent, mcp__linear
- **Calls slash:** `/sweep`, `/triage-findings`, `/spawn-tickets` (reads + executes their .md literally)
- **Spawns:** ad-hoc
- **MCP:** linear (downstream phases)
- **Called by:** humans

### `/triage-findings`
- **Purpose:** post-sweep batch — auto-classify findings (auto-apply / standalone / cluster / defer / drop), chain `/bulk-fix`, dispatch `/plan-quick` subagents in parallel. One confirm gate.
- **Tools:** Bash, Read, Edit, Write, Agent, mcp__linear
- **Calls slash:** `/bulk-fix` (via `Skill` at step f, when auto-applies exist)
- **Spawns:** N parallel `Agent` subagents running `/plan-quick` (one per cluster, capped at 5)
- **MCP:** linear (bulk-create standalone tickets)
- **Called by:** `/audit-cycle`; `/audit-docs` (hand-off); humans

### `/bulk-fix`
- **Purpose:** bulk-execute standalone bucket tickets — auto-apply atomic findings, group into M coherent PRs, batch-review per group. Targets `<standaloneProject>` only.
- **Tools:** Bash, Read, Edit, Write, Grep, Glob, Agent, mcp__linear
- **Calls slash:** —
- **Spawns:** N `Agent` subagents per group (parallel, capped at 5; serialized beyond)
- **MCP:** linear (read ticket batch, post-merge close)
- **Called by:** `/triage-findings` (via `Skill`); humans

---

## Phase 4 — Docs (convention 6)

### `/audit-docs`
- **Purpose:** on-demand `docs/*.md` health check — freshness vs covered code, drift between doc claims and code, root-CLAUDE.md bloat, subsystem coverage gaps. Emits findings doc. Read-only.
- **Tools:** Bash, Read, Grep, Glob, Write
- **Calls slash:** — (hands off to `/triage-findings` via printed next-step, not invocation)
- **Spawns:** —
- **MCP:** —
- **Called by:** humans

### `/backfill-docs`
- **Purpose:** one-shot retrospective System-doc generation for repos adopting convention 6 with under-documented codebase. Plan-first, propose-vs-write per `/gen-claude-md` rules.
- **Tools:** Bash, Read, Write, Edit, Grep, Glob, Task
- **Calls slash:** — (mentions `/gen-claude-md` and `/review-claude-md` rules; doesn't invoke)
- **Spawns:** heavy subagent use (Haiku-routed for read-only inspections)
- **MCP:** —
- **Called by:** humans (once per repo when adopting convention 6)

### `/review-claude-md`
- **Purpose:** fact-root a directory's CLAUDE.md against actual source — verify every claim, judge accuracy/completeness/conciseness/AI-usefulness, emit PASS|NEEDS FIXES|REWRITE. Propose-only.
- **Tools:** Bash, Read, Grep, Glob
- **Calls slash:** —
- **Spawns:** —
- **MCP:** —
- **Called by:** `/sweep` (inline per-unit); humans ad-hoc

### `/gen-claude-md`
- **Purpose:** generate or update a per-folder CLAUDE.md, fact-rooted. Plan-first for recursive sweeps. Proposes diff before overwriting non-trivial existing.
- **Tools:** Bash, Read, Write, Grep, Glob
- **Calls slash:** —
- **Spawns:** —
- **MCP:** —
- **Called by:** `/sweep` (inline per-unit); humans ad-hoc

---

## Phase 5 — Review

### `/review-pr`
- **Purpose:** structured code review of one PR — acceptance vs diff, migrations, correctness, boundaries, security. Print-only by default; `--comment` posts to Linear after explicit gate.
- **Tools:** Bash, Read, Grep, Glob, mcp__linear
- **Calls slash:** —
- **Spawns:** —
- **MCP:** linear (save_comment when `--comment`)
- **Called by:** `/land-ticket` §4.5 (auto, via `Agent` subagent — print-only mode); humans ad-hoc

---

## Cross-cutting notes

- **Skill resolution:** when a command's body says "invoke X via the `Skill` tool," that's a real `Skill(skill: "X")` call. When it says "executes `/X` semantics inline" (e.g. `/audit-cycle` running `/sweep`), the orchestrator reads the .md and runs the steps in-process — no nested skill invocation.
- **Subagent routing:** `general-purpose` is the default. `Explore` for read-only codebase search. Haiku-routing per-call when documented (`/land-ticket` Tier B review, `/backfill-docs` read-only inspections, etc.) — see `~/.claude/memory/feedback_subagent_haiku_routing.md`.
- **MCP discipline:** every command using `mcp__linear` follows the discipline noted in each spec — `list_issues` is expensive (≤1.2KB × 50 default), so always pass `state` + tight `limit`; use `get_issue` for known IDs.
- **Plugins:** `sentry-mcp` is the only installed plugin. All other plugin commands (`code-review:*`, `claude-md-management:*`, etc.) were uninstalled 2026-05-28 as redundant.
- **`/verify` collision:** the user-level `/verify` was renamed to `/verify-tests` to disambiguate from Claude Code's built-in `/verify` (which runs the app). All callers updated.
- **`/scope` gap:** referenced by `/build` §2 but not yet implemented. Until it ships, `/build`'s scope-gate auto-relaxes to a warning.
