---
description: Post-sweep batch — auto-classify findings into routes (auto-apply / standalone / cluster / defer / drop), chain /bulk-fix, dispatch /plan-quick subagents in parallel. One confirm gate, one execution, one report.
argument-hint: "<findings-doc-path>  (e.g. docs/plans/<slug>-findings.md)"
allowed-tools: Bash, Read, Edit, Write, Agent, mcp__linear
---

# /triage-findings — post-sweep batch processor

Use after `/sweep` to process a findings doc in one pass. **Auto-classifies each un-triaged finding** into a suggested route; user confirms en masse or overrides per-finding. Chains `/bulk-fix` automatically after filing so auto-applyable findings clear themselves without manual `/next-ticket`-ing.

Read `~/.claude/workflow-conventions.md` first.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`. Missing → `/ticket-flow-init`, STOP.
- Required: `linearTeam`, `scopeLabel`, **`standaloneProject`**.
- Optional: `cfg.docs.postponed` (path to `docs/postponed.md`) — required only if any finding gets the DEFER route. If absent and user picks DEFER, surface the missing config + ask (the findings stay un-routed otherwise).

## 1. Load + auto-classify

### 1a. Parse findings
- `$ARGUMENTS` = path to findings doc. Missing → ask, STOP.
- Read it. Parse each finding line as `[<sev>] <file:line> — <issue> → <suggested action>`. Group by unit headers (`### <unit path>`). Number findings **globally** (1..N).
- **Idempotent — skip + count any finding already annotated** `→ filed as <ID>`, `→ planned in <path>`, `→ deferred <date>`, or `→ dropped: <reason>`. These do NOT appear in the §2 triage UI on re-entry — only un-triaged findings do.

### 1b. Auto-classify each un-triaged finding into a suggested route
Pattern-match the suggested action; assign one of:

| Suggested route | Action-line patterns | Why |
|---|---|---|
| **AUTO-APPLY** | "Add a code comment" / "Add a comment", "Remove `X`" / "Delete line", "Drop `X` (dep)" / "Uninstall `X`", "Replace `X` with `Y`", "Swap `.X()` → `.Y()`", "Rename `X` → `Y`" (single identifier), "Wrap `X` in `try/catch`", "Add `Cache-Control` header `<value>`" | Mechanical, literal — `/bulk-fix`-eligible. |
| **STANDALONE** | "Extract" / "Refactor" / "Restructure" / "Split", "Decide between …", "Determine if …", "Either … or …", multi-paragraph actions, any ambiguity | Needs human judgment; ticketable but not auto-applyable. |
| **(no-suggest)** | findings without a clearly-parseable action | User picks at confirm. |

Auto-classify is **advisory** — the user can override every suggestion at the §2 step.

### 1c. Suggest clusters from unit themes
- For each unit with ≥3 findings AND a recurring theme in the issue text (same antipattern across files — e.g. "missing rate limit", "missing try/catch", "loose typing", "dead dep"): suggest a **CLUSTER** (`/plan-quick` dispatch) for those findings.
- Cluster suggestions are advisory and capped at 5 (the `/plan-quick` dispatch cap). The user accepts, splits, declines, or defines their own.

## 2. Triage — present classification + accept-or-override

Print findings grouped by sweep unit, with the suggested route inline:

```
N/T already triaged (filed M, planned P, deferred D, dropped X) — showing T un-triaged below.

### <unit path>
[1] [low] file.tsx:23 — issue → action  · suggested: AUTO-APPLY
[2] [med] file.tsx:45 — issue → action  · suggested: AUTO-APPLY
[3] [low] other.tsx:12 — issue → action  · suggested: STANDALONE

### <unit2 path>
[4] [med] x.ts:8 — issue → action  · suggested: STANDALONE
```

Then proposed clusters (if §1d found any):

```
Cluster suggestions (advisory):
- C1: [findings 12, 13, 14] — scope: "missing try/catch in API routes"
- C2: [findings 20, 22-25] — scope: "loose `as any` typing in widget config"
```

Then **one prompt** with the route legend + override syntax:

```
Routes:
  A) AUTO-APPLY (standalone + auto-chain /bulk-fix)
  S) STANDALONE (file as ticket, no auto-apply)
  C) CLUSTER (/plan-quick dispatch for a coordinated scope)
  D) DEFER (append to docs/postponed.md, don't file)
  X) DROP (annotate findings doc, exclude from THIS batch — does NOT silence re-sweeps)

Defaults: every finding takes its suggested route shown above.

Overrides (any combination, one per line):
- `accept all`                                — take every suggestion as-is.
- `accept atomics`                            — take AUTO-APPLY suggestions; ask per non-atomic.
- `<n>: <route>[: <reason>]`                  — override finding n (e.g. `5: defer`, `12: drop: false positive`).
- `cluster <list> as "<scope>"`               — define a cluster (e.g. `cluster 3,7-9 as "geocode rate-limit"`).
- `accept clusters`                           — take all suggested clusters; ungrouped findings keep their suggestions.
- `no-chain-bulk-fix`                         — file AUTO-APPLY tickets but skip auto-chaining `/bulk-fix`.
- Anything not overridden stays at its suggested route.
```

Resolve overrides into final per-finding routes. Print the resolved breakdown:
- AUTO-APPLY tickets: A_count (filed individually, then `/bulk-fix` chain)
- STANDALONE tickets: S_count
- Plan clusters: M (covering K findings)
- Deferred: D
- Dropped: P
- Skipped (un-routed): U  (these surface again on re-entry)

If a finding is assigned to two routes, surface the conflict and ask which wins.

## 3. Preview gate (mandatory)

For each ticket to file (AUTO-APPLY + STANDALONE): show title, priority, body excerpt, Acceptance count, route flag.
For each plan cluster: scope + finding refs.
For deferred: list findings + target `docs/postponed.md` path.
For dropped: list with reasons.

Restate the contract:
- *"AUTO-APPLY tickets bulk-create in `<standaloneProject>` AND automatically chain `/bulk-fix` after — most will auto-close within the same session (subject to `/bulk-fix`'s own per-group confirm gates). Skip the auto-chain via `no-chain-bulk-fix`."*
- *"STANDALONE tickets bulk-create in `<standaloneProject>` — pick them up via `/next-ticket <ID>` when ready."*
- *"Plans dispatch as parallel `/plan-quick` subagents — Stack auto-approves only when 'unchanged' is honest; real stack forks stop with `Status: stack-needs-review` for you to finish interactively via `/plan`. Plan files written but NOT committed (`/spawn-tickets` commits atomically per convention 1)."*
- *"Deferred items appended to `docs/postponed.md` under today's date — tracked, not actioned. If `cfg.docs.postponed` is unset, these stay un-routed and surface on re-entry."*
- *"Dropped items annotated in the findings doc with the reason — re-runs of `/sweep` will still flag the underlying code; drops are **not** silencers, just batch exclusions."*

**Confirm gate** — no Linear writes, no subagent dispatch, no file mutations until explicit go.

## 4. Execute (one batch on go)

### Step a — dispatch parallel /plan-quick subagents (if M > 0)
Use the `Agent` tool, **one subagent per plan cluster**, all in parallel (single tool-use block with M Agent invocations). Each subagent's brief — verbatim, substituting `<SCOPE>`, `<REPO_ROOT>`, `<FINDING_REFS>`, `<FINDINGS_DOC>`:

```
You are an executor running /plan-quick for ONE scope, dispatched in parallel by /triage-findings.

# Working dir
Absolute repo root: `<REPO_ROOT>`. Operate there.

# Scope
Run /plan-quick literally for this scope:

> <SCOPE>

(References findings <FINDING_REFS> in <FINDINGS_DOC>.)

# What to do
Read `~/.claude/workflow-conventions.md` and `~/.claude/commands/plan-quick.md`. Follow plan-quick.md literally.

# Stack Decision — special rule (parent is /triage-findings, no user available)
- If every stack-touching choice is honestly "unchanged" (no new dep, store, runtime, architectural seam vs the repo's baseline per CLAUDE.md / lockfile) → record `Stack: unchanged — builds on existing <X, Y>` and proceed to the Manifest.
- If ANY choice requires a real decision → write the plan with `Status: stack-needs-review`, include the partial Stack Decision table for that choice, add the section header `## Manifest (pending — stack must be settled first)`, then STOP. Do NOT decompose into a Manifest.
- The Manifest go/adjust checkpoint at plan-quick.md step 4: write `Status: ready` directly (parent skill's confirm gate covered the meta-decision that the scope is settled).

# Don't
- Don't commit. (`/spawn-tickets` commits the plan atomically per convention 1.)
- Don't push. Don't transition Linear state. Don't create the Linear project (that's `/spawn-tickets`'s job).

# Return (terse — only this reaches the parent)
1. Plan file path.
2. Status: `ready` | `stack-needs-review`.
3. If `ready`: Manifest part count + the one-line Stack call (the `Stack: unchanged — …` sentence).
4. If `stack-needs-review`: which Choice(s) need a human, one line each.
```

### Step b — bulk-create standalone tickets (if A_count + S_count > 0)
For each AUTO-APPLY or STANDALONE finding:
- `mcp__linear save_issue` with `team: <linearTeam>`, `project: <standaloneProject>`, `labels: [<scopeLabel>]`, `priority` (critical→1, high→2, med→3, low→4), `title` (≤80 chars, imperative, derived from the issue — strip `[sev]` and `file:line` prefixes), `description` = verbatim finding body + a one-item `## Acceptance` checklist derived from the suggested action.
- For AUTO-APPLY findings, the description's structured finding line (`[<sev>] <file:line> — <issue> → <action>`) is preserved verbatim so `/bulk-fix` §2's parser picks it up as auto-apply-eligible without any extra signal needed.
- After each success: append `  → filed as <ID>` to that finding's line in the findings doc. If any create fails: STOP and report — do not silently skip.

### Step c — annotate plan-referenced findings
For each finding referenced by a successful plan dispatch (ready or stack-needs-review), append `  → planned in <plan-path>` to its line in the findings doc.

### Step d — append deferred findings to postponed.md (if D > 0)
- Require `cfg.docs.postponed`. If unset, **skip + warn**: the deferred findings stay un-routed and will appear on re-entry.
- Append to `cfg.docs.postponed` under `## <today YYYY-MM-DD> — from /triage-findings <findings-doc>` (create the header section if absent). Each entry: `- **`<file:line>`** *(sev: <sev>, finding #<n>)*  — <issue>`.
- After append: annotate each deferred finding in the findings doc with `  → deferred <YYYY-MM-DD>`.
- Do NOT commit `postponed.md` here — keep it as a local edit; user commits as part of normal flow (convention 1's "spawn-tickets owns commits" rule only applies to plan files).

### Step e — annotate dropped findings (if P > 0)
For each dropped finding, append `  → dropped: <reason>` to its line in the findings doc.

### Step f — chain /bulk-fix (if A_count > 0 AND user did NOT pass `no-chain-bulk-fix`)
- Invoke the `bulk-fix` skill via the `Skill` tool with no args. `/bulk-fix` defaults to all `<scopeLabel>`-labelled, Todo/Backlog tickets in `<standaloneProject>` — exactly the set just filed.
- `/bulk-fix` has its own dry-run + confirm gates per group; those still fire. This chaining just removes the manual keystroke between filing and execution.
- If the user passed `--dry-run` to `/triage-findings`, also pass `--dry-run` through to the chained `/bulk-fix`.
- Print a one-line notice: `Chaining /bulk-fix on <A_count> auto-apply tickets…`.

## 5. Report + next step (convention 4)
- **AUTO-APPLY tickets filed**: A_count (IDs grouped by severity). Bucket URL.
- **STANDALONE tickets filed**: S_count (IDs grouped by severity). Bucket URL.
- **/bulk-fix chained**: yes/no. If yes: the per-group results bubble up from `/bulk-fix`'s own §8 report.
- **Plans READY**: list `<path> · <part-count> parts · <stack call>`. Suggest `/spawn-tickets <path>` per plan.
- **Plans NEEDS REVIEW**: list `<path> · choices needing decision: <one-line>`. Suggest interactive `/plan "<scope>"` per plan.
- **Deferred**: D findings appended to `cfg.docs.postponed` under today's date.
- **Dropped**: P findings annotated.
- **Skipped (un-routed)**: U findings (re-run shows these — idempotent).
- **Next step**: `/spawn-tickets <plan>` per ready plan; `/next-ticket <STANDALONE-ID>` to start a STANDALONE manually. Auto-apply tickets clear via the chained `/bulk-fix`; if any went `needs-eyes`, they're listed in `/bulk-fix`'s report and you pick up via `/next-ticket <ID>`.

## Hard rules
- **Never auto-execute** (no Linear writes, no `/bulk-fix` chain, no subagent dispatch, no `postponed.md` append, no findings doc annotation) without the §3 confirm gate.
- Never widen standalone creation beyond `<standaloneProject>`.
- Severity → priority is fixed: critical=1 Urgent, high=2 High, med=3 Medium, low=4 Low.
- Plan subagents capped at 5. Beyond that it's a classification problem, not a parallelism problem.
- A plan subagent that can't honestly say "Stack: unchanged" must stop with `Status: stack-needs-review` — never bypass.
- Never auto-commit a plan file (convention 1: `/spawn-tickets` owns commits).
- Never auto-fire `/spawn-tickets` — per-plan user confirm.
- `/bulk-fix` chaining respects `/bulk-fix`'s own confirm gates — never bypass them.
- DROP is not a silencer. Re-runs of `/sweep` will still flag the same `file:line` if the underlying code hasn't changed — drops only exclude the finding from THIS triage batch.
- Auto-classify is advisory. The user can override every suggestion.
- Idempotent on re-run: findings annotated `→ filed as <ID>` / `→ planned in <path>` / `→ deferred <date>` / `→ dropped: <reason>` are filtered out of the §2 UI; only un-triaged ones surface.
- One findings doc per invocation. One parallel batch.
