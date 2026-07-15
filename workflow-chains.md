# Workflow chains — command map

Quick reference for the core workflow commands. The 46 command files in `~/.claude/commands/` include the 18 documented below — the procedural chain (17 commands that chain end-to-end) plus the craft-led `/riff` divergent path; the rest are sub-agent helpers, the review/audit lenses, and the capture/report front-doors, each self-describing in its own file. Each command also prints its own "next step" at the end (convention 4), so memorization isn't required.

## The 18 core commands

| Command | Phase | Role |
|---|---|---|
| `/ticket-flow-init` | Setup (once per repo) | Detect settings, create scope label + bucket, write `ticket-flow.json`, gitignore managed worktree contents. Idempotent. |
| `/plan <idea>` | Create work | Frame → Stack Decision checkpoint → small vertical-slice manifest |
| `/spawn-tickets [plan]` | Create work | Plan → Linear project + tickets; commits + pushes plan to `<baseBranch>` atomically |
| `/next-ticket [PROJECT \| ISSUE-ID]` | Start work | Establish/use worktree (feature, standalone, or milestone mode), pick + In Progress |
| `/resume-ticket [ISSUE-ID]` | Resume | Pick up an In Progress ticket; no Linear state change |
| `/scope [--flags]` | Plan execution | Validate active ticket vs current code — per-Acceptance-item validation, compile-check any ticket-provided snippets (catches bundle-poisoning that tsc misses), write `docs/plans/<id>-build.md`. Full autonomy; surfaces `needs input:` on snippet compile-failure or unimplementable Acceptance items. |
| `/build [--flags]` | Execute work | Implement active ticket — follow per-ticket plan (`docs/plans/<id>-build.md`) if present, else require trivial. Code per Acceptance → `/verify-tests` → commit → push. Full autonomy; flags introduce checkpoints. Stops at preflight if non-trivial without a scope plan (override with `--force`). |
| `/fix-bug [ISSUE-ID]` | Execute work (bug route) | Repro-first path for a `route:fix-bug` ticket — ingest origin convo first (`/ingest-convo`) → reproduce (the oracle, 3 outcomes) → fix (repro-gated; keeps `/build §4.6` read-back + convention-8 no-fabrication) → prove repro gone → full `/land`. Replaces `/scope`+`/build` on the bug route; drops the scope plan + §3.5 thesis-check (`commands/fix-bug.md`; `docs/fix-bug-path-design.md`). |
| `/land-ticket [ISSUE-ID \| PR#]` | Finish work | Publish PR if needed → classify → conflict analysis → migration scan → **structured review (auto)** → **docs ripple scan (§4.7, opt-in)** → confirm gate → merge → **post-merge docs append (§6.5, opt-in)** → cleanup |
| `/review-pr [PR#]` | Review | Structured review; print-only by default. Auto-invoked inside `/land-ticket` step 4.5 |
| `/sweep [dir]` | Audit | Plan-first, resumable codebase audit → per-folder CLAUDE.mds + reviewed findings doc |
| `/triage-findings <doc>` | Post-audit batch | One interactive batch: select-pattern standalones (bulk-file to bucket) + 0-5 parallel `/plan` subagents for clusters |
| `/bulk-fix [--dry-run] [--priority] [--ids]` | Bulk execute | Auto-apply atomic standalone bucket tickets — group into M coherent PRs, one confirm per group, batch merge. Targets `<standaloneProject>` only. |
| `/audit-cycle [dir]` | Audit orchestrator | Chains `/sweep` → `/triage-findings` → `/spawn-tickets` per ready plan |
| `/review-claude-md [dir]` | Docs verify | Fact-roots CLAUDE.md against code; propose-only |
| `/gen-claude-md [dir]` | Docs author | Generate per-folder CLAUDE.md (write fresh; propose diff for non-trivial existing) |
| `/audit-docs [dir]` | Docs audit | On-demand health check for `docs/*.md`: freshness vs `covers`, drift, CLAUDE.md bloat, coverage gaps. Emits findings doc; hands off to `/triage-findings`. Read-only. |
| `/backfill-docs [dir]` | Docs author (one-shot) | Retrospective System-doc generation for repos adopting convention 6 with an existing under-documented codebase. Plan-first, Haiku-routed subagent reads. Updates `ticket-flow.json` `docs` block. |
| `/riff [topic]` | Divergent path (craft-led) | Loose, judgment-led session — explore/sketch/react/refine an idea by craft (`craft/`) instead of the fixed chain. Reach for it when the shape is unknown and the chain's gates would be ceremony; graduate to the chain to ship. |

## Two session paths (procedural vs craft-led)

The pipeline offers two ways to take on work — complementary, not rival.

- **Procedural chain** — `/next-ticket → [/scope] → /build → /land-ticket` (the flows below). For *known* work: a ticket exists or is easy to write, the acceptance is concrete, and you want the gates, the structured review, and a reviewable PR trail. This is the default, and most of this document. Chain entry is routed (V-220): `/next-ticket` §5 emits a recorded route — `build | fast | fix-bug | research` (`route:` label > bugs-bucket > small-rubric > `build`) — which `/go` and the downstream commands consume without re-deciding; `next-ticket.md` §5 is the single source. Route `fix-bug` runs **`/fix-bug`** (the repro-first path, `commands/fix-bug.md`) in place of `/scope`+`/build`; route `research` (V-223) runs the **inline investigate → finding doc → land** path (no command — driven inline by `/go`, drops `/scope`/thesis-check/`/build`/`/verify-tests`; `docs/research-route-path-design.md`); `build`/`fast` run the chain above.
- **Craft-led `/riff`** — a single loose session (`commands/riff.md`) that leans on the `craft/` register's judgment instead of a fixed step sequence. For *exploratory* work: the shape is unknown, you're sketching or prototyping to learn, and forcing it through the chain would mean inventing an acceptance for something you're still discovering — gates as ceremony rather than help.

**When to pick which:** do you have something concrete to verify the work against? Yes → run the chain. Still finding the shape → riff. The looseness is in the *procedure* only — `/riff` still holds conventions 8 (observed state over asserted) and 9 (smallest change), so it never becomes a path around the honesty substrate. **Rule of thumb: riff to discover, graduate to the chain to ship** — most features start as a riff and finish on the chain, because `/riff` exits by handing off to `/plan` or `/next-ticket`.

## Typical flows

### Feature work (multi-slice)
```
/plan "<idea>"                   # interactive: stack decision + manifest
/spawn-tickets [plan-path]       # creates Linear project + N tickets, commits plan to baseBranch
/next-ticket "<Project Name>"    # establishes worktree, picks first ticket, In Progress
  build (interactive — you + Claude)
/land-ticket                     # publish → review → confirm → merge → cleanup
  ↑ /resume-ticket [ID] if interrupted mid-build
  ↻ /next-ticket → build → /land-ticket loops for each ticket in the project
  ⤇ last ticket landed = worktree torn down + Linear project completed automatically
```

### Standalone fast-path (one-shot bug fix or tweak)
```
(create the issue in Linear under <standaloneProject>, label it <scopeLabel>)
/next-ticket <ISSUE-ID>          # standalone mode: per-ticket worktree, parallel-friendly
  build
/land-ticket                     # tears down per-ticket worktree on merge; bucket stays open
```
N in parallel: open N terminals, run `/next-ticket <ID-i>` in each.
An unlabeled small ticket here derives route `fast` (V-220): guaranteed `/scope` skip, `/verify-tests` skipped on a docs/test-only diff, review Tier A — while the diff-driven migration/`invariant`/security gates run regardless.

### Bulk-execute the standalone bucket (atomic mass fixes)
```
/bulk-fix [--dry-run]            # group N bucket tickets into M (~5-10) coherent PRs
                                 #   subagents auto-apply literal actions (`.maybeSingle()` swaps, dead-code removal, typo fixes, etc.)
                                 #   ambiguous findings → needs-eyes (skipped per-ticket, group continues)
                                 # one confirm per group at batch review → bulk merge approved groups
                                 # /land-ticket closes each ticket explicitly after merge (PR bodies carry no Closes magic-word — V-14)
```
Anything flagged `needs-eyes` stays as open bucket tickets — pick up manually via `/next-ticket <ID>` later.

### Codebase audit (find issues, batch-route them)
```
/audit-cycle [dir]               # one command, three pause points:
  Phase 1: /sweep semantics             (Phase A manifest gate → Phase B read pass)
  Phase 2: /triage-findings semantics   (interactive triage + confirm)
  Phase 3: /spawn-tickets per ready plan (one gate per plan — non-batchable)
```
Or run them separately:
```
/sweep [dir]
/triage-findings docs/plans/<slug>-findings.md
/spawn-tickets <plan-path>       # per ready plan
```

### Ad-hoc PR review
```
/review-pr [PR#]                 # print-only by default
/review-pr [PR#] --comment       # gates an explicit yes before posting to Linear
```
(Already auto-invoked inside `/land-ticket` step 4.5 — only run this directly for ad-hoc reviews of arbitrary PRs.)

### CLAUDE.md maintenance
```
/review-claude-md [dir]          # verify drift in an existing CLAUDE.md
/gen-claude-md [dir]             # author or refresh a per-folder CLAUDE.md
```
Both also auto-invoked by `/sweep`'s Phase B documentation lens.

### Docs maintenance (system docs — convention 6)
```
/audit-docs [dir]                # health check: freshness, drift, bloat, coverage → findings doc
/triage-findings <findings-doc>  # graduate selected findings to tickets
/backfill-docs [dir]             # one-shot retrospective: draft missing System docs (plan-first)
```
Steady state: `/land-ticket` §4.7 + §6.5 keep changelog appended, freshness headers updated, drift flagged at the merge confirm gate. `/audit-docs` for on-demand checks. `/backfill-docs` only when first adopting convention 6 in a repo that started without it.

Opt-in per repo via the `docs` block in `.claude/ticket-flow.json` — repos without the block get default (unhooked) behavior.

## Who calls who (command map)

```
/audit-cycle ─┬─→ /sweep ──┬─→ /review-claude-md   (per-folder, propose-only)
              │             └─→ /gen-claude-md     (per-folder, write or propose)
              ├─→ /triage-findings ──→ /plan       (via N parallel subagents, capped at 5)
              └─→ /spawn-tickets                   (per ready plan, sequential, per-plan gate)

/land-ticket ─→ /review-pr                          (auto step 4.5, print-only)
             ─→ docs ripple scan (§4.7)             (opt-in via cfg.docs)
             ─→ post-merge docs append (§6.5)       (opt-in via cfg.docs)

/scope ──────→ Explore subagent                     (§1, broad codebase search when affected files non-obvious)
/scope ──────→ general-purpose subagent             (§5, only when industry-standards research is signaled)

/build ──────→ /verify-tests                        (auto §5, scoped; ~0 tokens on green)
/build ←──────/scope's docs/plans/<id>-build.md    (read at §1 if present; gate enforced at §2)

/audit-docs ──→ /triage-findings                    (manual handoff after findings doc)

/backfill-docs ──→ updates cfg.docs                 (writes systemDocs[] block at Phase C)

/next-ticket → (interactive build) → /land-ticket
                                  ↑
                          /resume-ticket            (mid-build re-entry)
```

## Three worktree modes coexist per repo (convention 5)

Every resolver starts from the exact command-launch checkout: `sourceRoot = git rev-parse --show-toplevel`. Ordinary paths are `<sourceRoot>/.claude/worktrees/<unchanged deterministic basename>`; only an exact installed `~/.claude` source uses the legacy sibling fallback until V-376.

- **Feature mode** (target = a non-bucket project without `parallel`/`milestone-parallel`): one worktree per project, sequential tickets, project-wide In Progress guard. Basename `<repo>-wt-<project-slug>`. `/land-ticket` detaches and reuses it between tickets; the project's last ticket triggers worktree removal and project completion.
- **Standalone mode** (target = `standaloneProject` or a project carrying `parallel`): one worktree per ticket, parallel allowed, per-ticket guard. Basename `<repo>-wt-<issue-key>`. `/land-ticket` removes it immediately after that ticket merges; it never auto-completes the bucket/project.
- **Milestone mode** (project carries `milestone-parallel`, which wins over `parallel`): one worktree per milestone, parallel across milestones and sequential within each milestone. Basename `<repo>-wt-<project-slug>-<milestone-slug>`, with the project and milestone segments capped independently. `/land-ticket` reuses it until that milestone's last ticket, removes it then, and completes the project only after all project tickets are done.

`/next-ticket` auto-detects mode from config/project labels. Existing legacy siblings migrate outside-in only when Git registration and filesystem vacancy agree; a session already inside one defers migration, and conflicts stop. `/land-ticket` reads the helper-managed private binding to select lifecycle behavior, exits the worktree before removal, and never force-removes a dirty worktree.

## Where state lives

- **`~/.claude/commands/*.md`** — the 38 skill definitions (global).
- **`~/.claude/workflow-conventions.md`** — the 13 conventions every skill reads first.
- **`~/.claude/plans/*.md`** — plan artifacts for cross-project tooling work (no Linear, no repo). E.g. `docs-automation.md`.
- **`<sourceRoot>/.claude/ticket-flow.json`** — per-launch-checkout config (linearTeam, scopeLabel, baseBranch, requiredCheck, optional standaloneProject, **optional `docs` block** for convention 6). Committed.
- **`<sourceRoot>/.claude/worktrees/<basename>`** — ordinary ticket-flow linked worktree location. The basename is helper-owned and deterministic; nested contents are gitignored by the source checkout. Exact installed `~/.claude` source: sibling fallback only until V-376.
- **Linked-worktree private Git metadata `claude-ticket-flow.json`** — per-worktree binding resolved by `ticket-worktree.mjs` through `git -C <worktree> rev-parse --path-format=absolute --git-path claude-ticket-flow.json`; never `<worktree>/.claude/active-project.json`. Feature payload `{ linearProject, planSlug }`; standalone `{ mode: "standalone", linearIssue }`; milestone `{ mode: "milestone", linearProject, linearMilestone }`.
- **Linear** — single source of truth for ticket state. PR-merge does NOT change ticket state; `/land-ticket` §8 closes the ticket explicitly after acceptance. PR bodies carry no closing keyword (guarded by `pr-close-guard`) so a sibling reference can't cross-fire (V-14). **Marking a duplicate:** set `save_issue` `duplicateOf: <id>` — that call *creates* the duplicate relation and Linear then moves the issue to the Duplicate state. Never pass `state: "Duplicate"` (with or without `duplicateOf`) expecting the one call to create the relation: Linear rejects it with *"Missing duplicate relation — issues can only be moved to a duplicate state when a duplicate issue relation exists"* (V-95). The pipeline's normal way to collapse redundant work is `Canceled` (`align` kill) or dedupe-drop (`/harvest-pipeline-bugs` §4c never refiles), so a deliberate Linear Duplicate move is the rare exception — when you do it, establish the relation via `duplicateOf` first/instead.
- **`<repo>/docs/plans/`** — plan artifacts (convention 1), sweep plans + findings docs. Committed.
- **`<repo>/docs/{changelog,roadmap,postponed}.md`** — State docs (convention 6). `changelog` auto-appended by `/land-ticket` §6.5; others edited manually or via prompts.
- **`<repo>/docs/<system>.md`** — System docs (convention 6) with freshness headers (`> Last verified against code: ...`). Updated by `/land-ticket` §6.5 when PR touches their `covers` paths.

## See also

- `~/.claude/workflow-conventions.md` — the 13 conventions every skill follows (plan artifact · deviation log · acceptance checklist · pipeline continuity · project=feature=one worktree · documentation lifecycle · bash composition · observed-over-asserted state · stay on-ticket · craft register · confirm gates · model profile).
- Each skill's own description at `~/.claude/commands/<skill>.md` — full operational detail per command.
