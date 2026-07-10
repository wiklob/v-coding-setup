# Workflow Conventions (shared substrate)

Global conventions every ticket-flow / documentation / sweep / planning skill follows. A skill that does multi-step generative or mutating work **reads this file first** and obeys these conventions. They exist so long processes stay inspectable, resumable, and honest.

---

## 1. Plan Artifact — plan before you act

Any process that will touch many files, generate docs, decompose work, or sweep a codebase MUST write a plan **before** doing the work, then execute it **part-by-part** (never one-shot).

- **Location:** `docs/plans/<slug>.md` in the repo (committed — non-secret, lets a teammate or a future session resume). `<slug>` is kebab-case and descriptive (`document-stage-3`, `s2-cleanup-sweep`, `feed-system-plan`).
- **Structure:**
  ```
  # Plan: <title>
  Status: planning | ready | in-progress | done | stack-needs-review
  Shape: slices | procedure | mixed       (default: slices)
  Created: <YYYY-MM-DD>  ·  Source: <idea / ticket / sweep that spawned this>

  ## Goal
  One paragraph: what done looks like, why.

  ## Scope
  In: …   Out: … (explicit non-goals prevent scope creep)

  ## Manifest (ordered, checkable)
  - [ ] P1. <part> — <one-line what + the concrete artifact it produces>
  - [ ] P2. …

  ## Risks / unknowns
  - …

  ## Deviations
  (see convention 2 — appended as they happen)
  ```
- **Shape — controls how the Manifest maps to Linear tickets in `/spawn-tickets`:**
  - **`slices`** (default — what most plans are): N Manifest parts → **N independent tickets**, dependency-ordered. Each part ships its own PR via one `/next-ticket` → build → `/land-ticket` cycle. Use when parts touch different code paths and have independent acceptance (e.g. extract helper, wire it into module A, wire it into module B, add tests). Worker-reliability-shaped work fits here.
  - **`procedure`**: N Manifest parts → **1 ticket with N Acceptance items**. Use for sequential setup/runbook work where steps are one-way, dashboard-clickable, or otherwise un-PR-able (provider research, DNS config, secrets storage, smoke test, runbook write-up). The whole procedure ships as one ticket; the Manifest's parts become its Acceptance checklist verbatim. SMTP-shaped work fits here.
  - **`mixed`**: each Manifest part declares its `kind` inline — `[slice]` (becomes a ticket) or `[checkpoint → P<n>]` (Acceptance item folded into ticket `P<n>`). Use when prerequisite research/decision steps must complete before an implementation slice can start, but you want the research recorded in the same plan. Example Manifest line: `- [ ] P1. [checkpoint → P3] Decide provider`.
- **Execution:** do one manifest part at a time; check its box the moment it's truly done; keep `Status` current. A part that can't be finished stays unchecked with a note — do not silently skip.
- A reviewing skill (e.g. `rcmd`) may rely on the plan to know intended scope. Keep the plan the source of truth for intent.

## 2. Deviation Log — record divergence as it happens

Plans are predictions; reality differs. The moment execution diverges from the Manifest — a part skipped, done differently, reordered, or the plan found wrong — append an entry to the plan's `## Deviations`:

```
### <YYYY-MM-DD> P<n> — <short title>
Planned: <what the manifest said>
Did instead: <what actually happened>
Why: <the reason — a discovered constraint, a better approach, a blocker>
```

Never rewrite history to hide a deviation; the log is the audit trail. If a deviation invalidates later parts, update the Manifest and note that you did.

## 3. Ticket Acceptance Checklist — every generated ticket is verifiable

Every Linear issue created by these flows MUST carry an acceptance checklist in its description:

```
## Acceptance
- [ ] <concretely verifiable outcome — a behavior, a file, a passing test>
- [ ] …
```

Rules:
- Items are **verifiable from the diff/tests**, not vague ("works well"). Prefer "X endpoint returns Y", "migration applied", "test covers Z".
- `/land-ticket` checks each item against the merged change before closing. Unmet items are surfaced at its confirm gate — the issue is not auto-closed with unmet acceptance items unless the user explicitly waives them.
- A plan's Manifest part maps to a ticket; the part's produced-artifact line seeds that ticket's Acceptance.

---

## 4. Pipeline Continuity — every chain command is self-aware

The flow is a chain: `/plan` → `/spawn-tickets` → `/next-ticket` → build → `/land-ticket` (→ next ticket, or project done). Every command in it:

- **At start — soft prerequisite check.** Verify the prior step's artifact/state exists (a ready plan for `/spawn-tickets`; a Linear project for `/next-ticket`; a built worktree for `/land-ticket`). If missing: warn, name the step that produces it, offer to run it — **never hard-block**. Legit mid-pipeline entry (a hand-made Linear issue, a manual branch) must still work; the check informs, it does not gate.
- **At end — name the next step.** Print the exact next command to run (with args), and the one after if obvious. The user should never have to remember what comes next.

## 5. Project = feature = one worktree

A "ticket series" from one plan is **one Linear project** (the feature). Tracking and parallel isolation both hinge on this:

- `/spawn-tickets` creates the Linear project and files every ticket into it.
- A **worktree is bound to exactly one project**. Binding marker: `.claude/active-project.json` **inside that worktree** (gitignored), e.g. `{ "linearProject": "<name-or-id>", "planSlug": "<slug>" }`.
- Worktree path is deterministic from the project: `../<repo-basename>-wt-<project-slug>`. **Sanitize both halves** — the repo basename can contain spaces and the project slug can be long: lowercase, replace non-alphanumerics with `-`, strip trailing `-`, cap the slug at ~40 chars. Always quote the path in shell. The path names the project — paths never get mixed up across parallel features.
- A freshly added worktree has **no `node_modules`** — the flow must bootstrap deps in it before any build/verify, or the repo-local toolchain (TypeScript, etc.) is absent and a bare `npx <tool>` may install and run an unrelated package that exits 0 (a false-green check). The required check always runs against the repo-local toolchain.
- A freshly added worktree also has **no `.envrc`** (it's gitignored by design — secrets). When running env-dependent commands from a worktree (`npm run dev`, `supabase` CLI with project link, scripts that read env vars), the worktree must inherit env from the main repo. **The only sanctioned pattern is the symlink:** `ln -sf <main>/.envrc <wt>/.envrc` at worktree bootstrap (already done by `/next-ticket`). After that, `direnv` picks it up inside the worktree, or commands can `set -a && . ./.envrc && set +a` inline. **Never use `direnv exec <main> <cmd>` — it is banned.** If env vars are missing, the symlink is missing or hasn't been `direnv allow`'d in the worktree; fix the symlink, don't reach for `direnv exec`. Don't ask the user to run `direnv exec` either — they will not run it. The symlink is the only answer.
- **Using the env vars after they're loaded: implicit only.** Once `.envrc` is sourced (whether via `direnv` or inline `. ./.envrc`), use the secret env vars **implicitly** in the real command — pass them as `-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"`, set them as the environment of the next process, etc. **Never run a separate "confirm vars are set" step**: no `env | grep`, `printenv | grep`, `echo "$SUPABASE_ACCESS_TOKEN"`, `set | grep TOKEN`. Those are blocked by the secret-handling deny rules and they're the most common way a session gets stuck after a clean symlink setup. Trust the symlink — if a Bash invocation has `. ./.envrc` in it, the vars are loaded; go straight to the curl/CLI call that needs them, and pipe its output through `jq`/`python3 -c` so only the answer (not the credential) ever lands in the transcript.
- **Scratch & audit writes in a bg-isolated session — inside the worktree, or via a `bin/*` helper; never the shared checkout (V-87).** Once `EnterWorktree` isolates a background session, the harness Edit/Write isolation guard hard-errors on **any** `Write`/`Edit` under the shared checkout — including `~/.claude/jobs/<id>/tmp` (`$CLAUDE_JOB_DIR/tmp`), the very path the harness's generic bg-session preamble recommends for scratch. The two directives conflict, and the repo cannot edit the harness preamble — so **this convention is the authoritative guidance pipeline skills follow, and it supersedes the generic `$CLAUDE_JOB_DIR/tmp` recommendation for any isolated session.** Verified behavior (observed, not asserted — convention 8): `Write → ~/.claude/jobs/<id>/tmp/x` ⇒ *"This session is now isolated in `<wt>`. Edit the worktree copy of this file instead of the shared-checkout path."*; `Write → $WT_ABS/tmp/x` ⇒ succeeds. The rules:
  - **Throwaway scratch → inside the worktree** (`$WT_ABS/tmp/`, auto-gitignored by the worktree's ignore rules). The SessionStart-bootstrapped `$WT_ABS/**` edit scope permits it; the guard does not fire.
  - **An append that must land in the canonical shared checkout** (outside `$WT_ABS` — e.g. `pipeline/audit/*`, which also has to survive `/land-ticket`'s standalone-mode worktree teardown) → a sanctioned **`bin/*.mjs` helper** that resolves its target relative to its own `bin/` location (`fileURLToPath(import.meta.url)`, `mkdirSync` recursive) and does the write itself — e.g. `log-gate-audit.mjs` (V-75). Never an Edit/Write tool (guard-blocked), never a raw `>>` heredoc (convention 7).
  - Bash `>>`/`>` to `$CLAUDE_JOB_DIR/tmp` is *not* guard-gated (the guard intercepts only the Edit/Write tools) — but prefer the two rules above so writes stay observable and convention-7-clean. This generalizes V-75's `/go`-audit-flush fix from one gate to **all** `~/.claude` scratch/audit writes in an isolated bg session.
  - **Spawned subagents don't inherit any of this — the dispatching prompt must hand them a sanctioned *absolute* scratch path (V-322).** A subagent (`Agent` / `general-purpose` / `Explore`) runs in its **own empty context**: it inherits neither this convention nor the harness's generic bg-session `$CLAUDE_JOB_DIR/tmp` preamble, and it does not know `$WT_ABS` or `$CLAUDE_JOB_DIR`. So a subagent asked for throwaway scratch with no path guidance falls back to `/tmp`, and — computing a relative path from a cwd it can't see — writes `../../../../../../tmp/<file>`, which is outside every pre-allowed dir and **forces a manual permission prompt** (the V-322 failure: a bg `/go`-job `general-purpose` subagent Write to `../../../../../../tmp/hint-sim.mjs`). Whenever a bg-isolated (or bg) session spawns a subagent that may write scratch, **embed the scratch directive in the subagent's prompt and resolve the path to an absolute literal yourself** — throwaway scratch → the worktree `tmp/` (the absolute `$WT_ABS/tmp/`, resolved to its literal value) when the session is worktree-isolated, else `$CLAUDE_JOB_DIR/tmp`; **never `/tmp`, and never a deep relative path** (`../../../../../../tmp/…`). A subagent that itself runs a pipeline skill reads this convention on its own (covered by the skill's read-first preamble); the gap this closes is the **bare ad-hoc `general-purpose`/`Explore` dispatch** the `autonomy` knob encourages, whose prompt carries only what the dispatcher writes into it.
- **Editing `~/.claude` from a bg session prompts on EVERY `Edit`/`Write` — because `.claude` is a Claude Code *protected path*, not a missing allow.** Writes under `.claude` are never auto-approved; `permissions.allow` **cannot** override it (the safety check runs before allow-rules are evaluated), and the per-session "allow Claude to edit its own settings" prompt option is a known bug that does **not** persist (GH anthropics/claude-code#66525). The guard exempts `.claude/worktrees`, but that exemption is anchored at `~/.claude/worktrees` (single `.claude`); this repo's root **is** `~/.claude`, so `EnterWorktree` double-nests the worktree to `~/.claude/.claude/worktrees/<name>`, which the exemption never reaches → protected → prompts on every edit. Normal ticket work is prompt-free because `/next-ticket` uses a **sibling worktree OUTSIDE `~/.claude`** (`git worktree add ../<repo-basename>-wt-<slug>` → `$HOME/-claude-wt-<slug>`, then `EnterWorktree(path:)`), which isn't under any `.claude`. **A bg session cannot use that escape:** `EnterWorktree` refuses to switch into a sibling ("limited to worktrees managed by Claude Code under `.claude/worktrees/`"), so an isolated bg job is forced into the double-nested trap. **Proven fix (verified):** from a non-worktree state — a fresh `~/.claude` session, or after `ExitWorktree(action:"keep")` if already trapped — `git worktree add $HOME/-claude-wt-<slug>` then `EnterWorktree(path: <that sibling>)`; the Edit/Write tools then work prompt-free (a sibling `EnterWorktree(path:)` is accepted from a non-worktree state — it's only refused when switching *from* an existing worktree). So a bg session's **first** isolation move should be a sibling `EnterWorktree(path:)`, **never** `EnterWorktree(name:)` (which auto-creates the under-`~/.claude` trap). Fallbacks if you can't relocate: **write via Bash** (`python3`/`sed`/heredoc — the protected-path guard is on the Edit/Write *tools*, not Bash; convention 5's isolated-session escape), or set `worktree.bgIsolation: "none"` for this repo and edit a sibling by cwd. The `PostToolUse:EnterWorktree` bootstrap hook, the per-worktree `settings.local.json`, and the `.claude/worktrees/**` catch-all do **not** help the under-`~/.claude` case (allow-rules can't override the protected-path guard) — they only matter for sibling worktrees, which already work. See memory `feedback-bg-worktree-perms-bootstrap`.
- `/next-ticket` ingests **only** from the bound project of the worktree it runs in. It physically cannot pull another feature's ticket. Parallel worktrees = parallel projects, zero cross-contamination.
- The worktree is **per-project, reused across that project's tickets** — not per-ticket. `/land-ticket` keeps it alive between tickets (deletes only the merged ticket branch, re-baselines) and tears it down only when the project's **last** ticket lands, at which point it marks the Linear project complete.
- Repos using this must gitignore `.claude/active-project.json` (the binding is local, per-worktree).

### Standalone mode — parallel ticket execution (per-repo bucket + per-project opt-in)
Some tickets shouldn't go through the project-sequential default: bug-fix-sized one-shots (forcing them into one shared "Misc" project would block parallelism via the In Progress rule; spinning up a Linear project per bug clutters Linear), AND feature projects that are natively parallel (a group of related, non-stage-dependent tickets). Both escape via the same mechanism: **standalone mode**.

A project is **parallel-eligible** (routes through standalone mode) when EITHER:
- It is a configured standalone bucket. `.claude/ticket-flow.json` sets `"standaloneProject": "<project name>"` — the **primary** bucket for miscellaneous one-shots — and may set `"standaloneProjects": ["<primary>", "<more…>"]`, the **full registry** when a repo runs ≥2 buckets (e.g. a perpetual `bugs` harvest bucket alongside the general one; V-52). Scalar-reading consumers use the primary; `/bulk-fix --project <name>` targets any registered member. Set via `/ticket-flow-init`. Optional — omit both for feature-only repos.
- It carries the Linear **project label `parallel`** (a workspace-level project label, distinct from issue labels — applied per-project via Linear's UI; create it once under Linear → Settings → Labels → "Project labels"). No repo config needed; the label IS the opt-in.

When `/next-ticket` targets a parallel-eligible project (either explicitly by name or via an ISSUE-ID whose parent is one), it switches to **standalone mode**:
  - **Worktree per ticket** — path `../<repo-basename>-wt-<issue-key-lowercased>` (e.g. `../trashart-wt-art-3`).
  - Binding = `{ "mode": "standalone", "linearIssue": "<ID>" }` (vs feature `{ "linearProject", "planSlug" }`).
  - In Progress check is per-ISSUE, not per-project — multiple tickets in the same project can be In Progress in parallel worktrees.
  - `/land-ticket` tears the per-ticket worktree down on merge. The Linear project is **never auto-completed** by `/land-ticket` in standalone mode — the bucket is perpetual by design; a parallel-labeled feature project is finite but you close it manually when the matter is done (extra click in Linear, deliberate signal that the group is exhausted).

Feature projects without the `parallel` label and not the bucket are unchanged: one worktree per project, sequential tickets, In Progress blocks parallel within the project. All four configurations coexist per-repo.

Detection cost: when resolving a target, `/next-ticket` and `/resume-ticket` run one `get_project` on the resolved/parent project to inspect labels (skipped when it's already known to be the bucket).

### Milestone mode — per-milestone parallel execution (per-project label opt-in)
A large multi-milestone feature project wants a **middle granularity** the two modes above don't offer: run its milestones in parallel, but keep **one worktree per milestone** (reused across that milestone's tickets) — not a fresh worktree per ticket (too granular), nor a single project-wide worktree (no parallelism). That third mode is **milestone mode**, opt-in via the Linear **project label `milestone-parallel`** (a sibling to `parallel`; label-based, no repo config — the label IS the opt-in).

When `/next-ticket` (or `/resume-ticket`) targets a `milestone-parallel` project — by name, or via an ISSUE-ID whose parent carries the label:
- **Worktree per milestone** — deterministic path `../<repo-basename>-wt-<project-slug>-<milestone-slug>`, the convention-5 slug sanitizer applied to **both** halves and **each capped ~40 chars independently** (never cap the concatenation — a long project + long milestone must not silently collide). The trailing milestone segment also keeps a milestone path from ever colliding with the feature path (`-wt-<project-slug>`) for the same project. The bound milestone is read off the picked ticket's `projectMilestone`.
- Binding marker = `{ "mode": "milestone", "linearProject": "<id>", "linearMilestone": "<id>" }` (vs feature `{ linearProject, planSlug }` / standalone `{ mode: "standalone", linearIssue }`).
- Worktree **reused across that milestone's tickets** (the way the per-project worktree is reused across a project's tickets), sequential within the milestone. `/next-ticket` run from inside a milestone worktree auto-picks the bound milestone's next ready ticket; it ingests **only** that milestone's tickets, never the wider project.
- **In Progress enforced per-milestone:** one ticket In Progress per milestone — checked by `list_issues` (state In Progress, assignee me, project) **filtered client-side** on `projectMilestone.id` (`list_issues` has no milestone filter; paginate). Different milestones run In Progress simultaneously in their own parallel worktrees. The guard is milestone-width: never project-wide (that would re-impose feature-mode sequentiality and defeat the parallelism), never per-ticket (that's standalone).
- **`/land-ticket`** deletes the merged ticket branch + re-baselines and **keeps the milestone worktree alive** until the milestone's *last* ticket lands (detected by excluding the current landing ticket and checking every *other* milestone issue is Done). On the last ticket it tears the milestone worktree down, right after the issue→Done transition (the subsystem-altitude milestone close-out check is covered on-demand by `/validate` §2; V-157 removed the per-land auto-fire). The **project auto-completes** only when *all* milestones have landed (mirrors feature mode's auto-complete-on-last; a `milestone-parallel` project is a finite feature project — unlike the perpetual standalone bucket, which never auto-completes).
- **No orphan worktree** (cf. V-89): the per-milestone path is deterministic, so a fully-landed milestone's teardown (`worktree-remove.sh`) frees exactly that path and `orphan-detect.sh` finds nothing for it. *Worked example:* milestone `M2` of project `Connectors` has tickets `CB-201, CB-202`. Landing `CB-201` (not last — `CB-202` still open) keeps `…-wt-connectors-m2` and deletes only the `CB-201` branch. Landing `CB-202` (now last — `CB-201` Done) tears `…-wt-connectors-m2` down and — if `M2` was the project's final milestone — auto-completes the project. After teardown `git worktree list` shows no `…-wt-connectors-m2` entry and `orphan-detect.sh` reports nothing for it.

**Precedence — `milestone-parallel` wins over `parallel`.** A project should carry at most one of the two labels. If it carries **both**, `/next-ticket` / `/resume-ticket` take **milestone mode** and **warn** (`project carries both 'parallel' and 'milestone-parallel' — using milestone mode; a project is per-ticket OR per-milestone, not both`) — per-milestone is the more specific grouping, and silently honoring per-ticket would surprise a user who added the milestone label deliberately. The label-precedence order resolvers apply is `milestone-parallel` > `parallel` > none (feature).

---

## 6. Documentation lifecycle

Project docs (`docs/*.md`) drift if not maintained. `CLAUDE.md` (root + per-folder) bloats if used as a dumping ground. Three rules keep both honest. Opt-in per repo via `.claude/ticket-flow.json` `docs` block.

### Three buckets — each doc is exactly one type

- **System docs** — describe how the system *currently* works (architecture, schema, app-structure, deploy). Rot if code changes without doc update. Touched when their covered subsystem changes.
- **Decision docs** — record *why* (adopted proposals, design specs, ADRs). Append-only after adoption. Don't rot — they're historical.
- **State docs** — track project state over time (`changelog.md`, `roadmap.md`, `postponed.md`). Append-only, dated.

Mixing types is the #1 cause of confusing docs. A doc that's both System and Decision should be split: keep the "how it works now" in the System doc, archive the "why we chose it" as a Decision doc with `> Status: adopted in <phase> (PR #N)` at the top.

### Freshness headers (System docs only)

Line 1 of every System doc:
```
> Last verified against code: YYYY-MM-DD (PR #N)
```
Under `maintenance: "daily"` the parenthetical is `(daily YYYY-MM-DD)` instead of `(PR #N)` — the bump comes from the batched daily pass, not a specific PR (V-284). Both forms satisfy the header check (the date is what freshness keys on).

Updated by `/land-ticket` whenever a merged PR touches the doc's covered paths — or, under `maintenance: "daily"`, by the daily `/docs-refresh` pass for every covered doc touched in its window. Stale = the header date is older than the most recent code touch to the doc's `covers` paths.

### CLAUDE.md size ceiling

- **Root `CLAUDE.md`** ≤ **~150 lines** hard limit (target ~100). Steering only.
- **Per-folder `CLAUDE.md`** ≤ **~50 lines**. Local orientation only.

Over either ceiling → extract to `docs/*.md` (System / Decision / State as applicable). CLAUDE.md is steering, not history. Reference content (changelog, postponed, completed-phase walkthroughs, full subsystem descriptions) belongs in `docs/`, not in CLAUDE.md.

`/audit-docs` flags ceiling violations; manual extraction follows because deciding what to keep inline is a human judgment call.

### CLAUDE.md placement & depth (the cascade tax)

The harness loads **every `CLAUDE.md` and `AGENTS.md` along a file's ancestor path** on a single `Read` (ancestors at session start; subtree files on demand when a file under them is read). So a CLAUDE.md at depth *D* is re-loaded on **every read of any file below *D*** — its cost is multiplied by the read-frequency of its whole subtree, not paid once. One observed read of a 70-line leaf file pulled in 5 ancestor docs. We can't change that the harness cascades; we control only **how many docs sit on the path**. Each CLAUDE.md must earn its cascade cost.

- **Place at the shallowest unit boundary, never the leaf.** A CLAUDE.md belongs at a **unit** — a coherent module with its own responsibility/exports (the same "unit, not every leaf folder" granularity `/sweep` and `/gen-claude-md` use) — at the shallowest dir that still scopes its content correctly. Don't add a thin file to a leaf when its content could live in the parent unit's file.
- **Earn-its-place test** — a deep CLAUDE.md is justified only when **both** hold: (a) it says something non-obvious and true that no ancestor file already says, **and** (b) its subtree is read often enough that orienting agents there pays back the per-read tax it adds below it. A file failing either test gets **pushed up** into the nearest unit's CLAUDE.md or **out** into `docs/`.
- **Depth guidance:** prefer **≤ 2 levels** of CLAUDE.md on any single path. A third is occasionally right for a genuinely distinct, frequently-read sub-unit — but treat it as the exception that must justify itself, not the default.
- **No `AGENTS.md` duplication.** The harness loads `AGENTS.md` alongside a sibling `CLAUDE.md` in the same dir — if one duplicates the other, the duplicate is pure tax for zero added signal. Keep one file per dir (`CLAUDE.md` is canonical here); merge any `AGENTS.md` content in and delete it, unless an external tool genuinely requires the `AGENTS.md` name.

`/audit-docs` flags placement/depth smells (a thin or restating deep file, an `AGENTS.md`/`CLAUDE.md` duplicate pair) the same way it flags ceiling violations; `/sweep` and `/gen-claude-md` apply this test when deciding **whether** a dir gets its own file.

### Per-repo opt-in via `.claude/ticket-flow.json`

```json
{
  "docs": {
    "maintenance": "per-land",
    "changelog": "docs/changelog.md",
    "postponed": "docs/postponed.md",
    "systemDocs": [
      {"doc": "docs/architecture.md", "covers": ["src/", "web/src/lib/"]},
      {"doc": "docs/schema.md", "covers": ["supabase/migrations/"]},
      {"doc": "docs/deploy.md", "covers": ["dashboard/", "src/myapp/__main__.py"]}
    ]
  }
}
```

- `maintenance` — **who does routine doc upkeep** (V-284). `"per-land"` (the default when absent — existing repos unchanged): `/land-ticket` does per-PR doc work as below. `"daily"`: per-land doc work is **off** — `/land-ticket` §4.7/§6.5/§6.8 no-op with a deferral note (its §8 Done-comment + §9 report lines say `docs: deferred to daily /docs-refresh`; §5's docs-ripple presentation is naturally empty), and the scheduled daily **`/docs-refresh`** pass reviews the day's merged changes and lands **one consolidated `docs: daily maintenance <date>` PR** carrying every warranted update (freshness bumps, changelog, drift fixes, CLAUDE.md refreshes, postponed). Builds stop making inline doc edits (the convention-9 dual still applies: a doc change a ticket's *goal* genuinely requires is part of that ticket, not "upkeep"). Wins: doc work isn't re-paid in tokens per-build, and history carries one doc commit/day instead of doc lines smeared across every feature PR; the daily PR is the single human review point.
- `changelog` / `postponed` — state-doc paths recorded into (under `"per-land"`, by `/land-ticket`: changelog via per-PR fragments under `<changelog-dir>/changelog.d/`, postponed appended directly; under `"daily"`, by `/docs-refresh`: entries generated from the day's merged PRs, fragments folded + deleted).
- `systemDocs[].covers` — path prefixes. Under `"per-land"`: if a PR touches a file matching any prefix and the doc itself isn't in the PR diff, `/land-ticket` raises `docs-stale-risk` at the §5 confirm gate. Under `"daily"`: `/docs-refresh` bumps the freshness header of every covered doc touched in the day's window (lag ≤ 1 day — well inside the 30-day staleness signal).

Repos without the `docs` block get default behavior — no docs hooks, no surprises.

### Skills

- **`/land-ticket`** *(`maintenance: "per-land"` only)* — records each merged PR as a per-PR changelog **fragment** (`<changelog-dir>/changelog.d/<PR>.md` — conflict-free under concurrent lands incl. GitHub-side mergeability, V-194; curated into the changelog later), flags `docs-stale-risk` at the §5 gate, prompts to append `postponed` on `Deferred:` markers in PR/ticket body. Under `"daily"` all of this no-ops and defers to `/docs-refresh`.
- **`/docs-refresh`** *(`maintenance: "daily"` — the daily owner, V-284)* — the scheduled daily pass (launchd, 09:47): reviews the day's merged changes since a watermark and lands **one consolidated doc PR** applying freshness bumps, changelog entries (from merged-PR metadata), genuine drift fixes (via read-only `/audit-docs` findings), CLAUDE.md refreshes (applying `/gen-claude-md`'s approach inline — never the interactive commands headless), and postponed entries. Never auto-merges — the daily PR is the human review point.
- **`/audit-docs`** — on-demand health check: freshness (vs `covers`), drift (doc claims X, code says Y), bloat (CLAUDE.md ceiling), coverage (subsystems with no doc). Emits a findings doc; selected findings graduate via `/triage-findings`. Also the read-only drift engine `/docs-refresh` consumes daily.
- **`/backfill-docs`** — one-shot retrospective for repos adopting this convention with an existing under-documented codebase. Plan-first, propose-vs-write per `/gen-claude-md` rules.

### Where docs creation lives in the chain

- **During `/spawn-tickets`** — the plan doc itself (`docs/plans/<slug>.md`) is the seed. No additional System doc work.
- **During `/next-ticket`** — no doc work. Focus is building.
- **During `/build`** — no routine doc upkeep under `maintenance: "daily"` (the daily pass owns it); a doc change the ticket's *goal* genuinely requires is in-scope work, not upkeep (convention 9's dual).
- **During `/land-ticket`** — under `"per-land"` (default): write a per-PR changelog fragment (mechanical, conflict-free — V-194), check freshness (surfaces drift), prompt postponed (captures deferral reasoning). Under `"daily"`: none of this — deferred to the daily pass (V-284). New System docs are NOT created here either way — that's a deliberate human decision.
- **Daily `/docs-refresh`** *(under `"daily"`)* — the one batched refresh: everything above, once a day, in one reviewed PR.
- **Standalone runs of `/audit-docs` / `/backfill-docs`** — for everything that doesn't fit the per-merge flow.

---

## 7. Bash call composition — discrete over chained

Default to **discrete, single-purpose Bash calls.** Do not staple unrelated steps into one `A && B && C` mega-call. A compound is bad on three independent axes (only the first is a permission concern): it **re-prompts as a whole** (matches no prefix allow rule), it **blocks on its slowest link** (a quick step can't stream while a slow one runs), and it is **fragile** — one failed link aborts the rest with a single opaque exit, partial state is hard to inspect, and a prompting/denied link can **cancel its siblings**.

- **Reserve `&&` for a genuine dependency** — B must not run if A failed (e.g. `mkdir -p d && >d/f`). Sequencing unrelated steps is not a dependency; split them.
- **Run independent steps as separate calls.** When they don't depend on each other, emit them as parallel tool calls in one message (the harness runs them concurrently) rather than `&&`-serializing.
- **Isolate anything that may prompt.** Never put a known-prompting or sensitive op (interactive login, a write that triggers an `ask` tier, `ln -sf` across a guarded path) in a chain *or* a parallel batch — a prompt on one cancels its siblings. Give it its own call.
- **No confirmation padding.** Drop trailing `echo "done"` / `pwd` / `ls` / `env | grep` appendages — read the real command's output. Per convention 5, trust the env after `. ./.envrc`; never re-verify vars (the secret guard blocks it anyway).
- **Genuinely multi-step routines go in an allowlisted helper script** (`bin/*.mjs` / `bin/*` — the `wait-for-check.mjs` / `usage-stats.mjs` pattern), not an inline mega-chain. One reviewable, allow-ruled command beats a bespoke chain re-approved every run.

---

## 8. Observed state over asserted state — read back before you claim

Never assert an outcome you have not observed. The worst failure class in this pipeline is **claiming success on failure** — "done / built / active" reported from *intended* state rather than *observed* state. It corrupts the repo, poisons the docs system (false System-doc claims about live infra), and destroys trust — strictly worse than a slow or stuck agent. The vivid instance (Grafana, 2026-05-30): a build committed docs asserting an alert rule was "built + active" when the POST had returned **400** and the real rule list was `[]`; an earlier `jq` had swallowed the 400 body, and invented rule UIDs were filled in to paper over the gap. Every clause below maps to one symptom of that incident, but the rule is the general failure-class, not the Grafana specifics.

- **(A) Read back before claiming done/active.** After any create / POST / `PUT` / external mutation, **GET (or otherwise observe) the artifact and assert it exists** before you claim success, tick an acceptance item, or write docs. A docs/State-doc claim about external or live state must cite the **verification step** (the GET that confirmed it), not the intended outcome. This generalizes the artifact-kind acceptance gate (`/build` §4.5, `/land-ticket` §4.8) and the empirical-invariant probe (`~/.claude/memory/verify-asserted-invariants.md`) to **all** asserted external state, not just acceptance items.
- **(B) Never fabricate identifiers.** Every ID / UID / handle / URL must come from an **actual tool or API response** — never invented, guessed, or templated to fill a slot. If the response doesn't carry the identifier you need, that is a failure to **surface**, not a blank to fill in.
- **(C) Never swallow error bodies.** Check the HTTP status (or the tool call's success) **before** piping a response through `jq` / parsing it. On a non-2xx or error, **surface the body** — do not discard it. A `jq` that drops the response on the floor turns a 400 into a silent false-success. (This is the read-back analogue of convention 7's "read the real command's output.")

`/build` carries the operational form of this rule for build-time mutations (§4.6); the convention is the substrate every skill inherits — `/land-ticket`'s acceptance check (§8) and the background-session "sanity-check before `result:`" discipline both rest on it.

---

## 9. Stay on-ticket — triage out-of-scope defects, don't fix them in-session

When a session (build, manual-test, or any task) surfaces a defect **outside the current work's scope** — a systemic bug in an unrelated subsystem, or a gap a prior ticket never delivered — **triage-not-fix**: investigate only enough to file a good spin-out ticket (symptom + minimal repro + at most an *unproven hypothesis* of the cause), file it, and return. Do not let the session become the fix for the out-of-scope defect.

**The dual — do not spin out an in-scope-cheap improvement** (`craft/building.md`, the follow-up reflex). Triage-not-fix is for genuinely *out-of-scope* or genuinely *separable* (in-goal but large — its own design/blast-radius/verification) work. A mid-session realization that is **in-scope and cheap** — part of the best version of *this* work's goal, foldable in while you're already there — is not a follow-up: **do it now.** Reflexively filing it for later is the failure dual to scope-creep — under-delivery against the goal, not over-delivery past it. The burden is on *genuinely separable*; spin out only when that's the honest call, and name *why* it's separable. (This convention's out-of-scope half is unchanged; the dual just stops the reflex from sweeping in-scope-cheap work into the spin-out bucket — the V-254 feedback that droids file follow-ups instead of doing in-scope-cheap improvements.)

The line sits at "enough to write a good ticket." A short diagnosis that *produces* the spin-out is fine — that's where the good ticket comes from. It is crossed when the session makes live edits to the out-of-scope area, runs a full `/scope`/build-plan on the fix, or runs repeated repro/diagnostic cycles to *confirm* root cause — that work belongs in the spin-out's own build. Default is triage-then-resume, not a hard stop; escalate to `needs input:` only when the out-of-scope defect *blocks* the current work.

Evidence (V-24): of the analyzed marathon sessions, this pattern recurred but is low-frequency / high-cost — CB-122 drew ~30% of a 462k-token session into OTP rework + Supabase log-digging + a full `/scope` of the *fix* (CB-152) before spinning out; CB-144 ran live-Grafana PUT/poll cycles before filing CB-157. Both spin-outs were correct; the delay and depth before them was the waste. `/build` §4.7 is the operational form for the build/manual-test face; §5's pre-existing-failure stop is the verify face; `~/.claude/memory/verify-asserted-invariants.md` and V-17 cover the spec-correctness-before-build face.

### The verify-the-fix / monitoring spin-out — a *sanctioned* spin-out, distinct from triage (V-257)

The spin-out above is **triage of an out-of-scope defect** — the fix belongs elsewhere, so you file it and move on. The **verify-the-fix / monitoring spin-out** is a different, deliberately-sanctioned kind: the in-scope fix *is* correct and *has* landed; what spins out is only the **confirmation that it held post-deploy** — an outcome nobody can observe at land time (*does the recurrence stop*, *does the fix hold in production over the next N runs*). Blocking a merge gate on such an un-verifiable-yet outcome just asks a human to rubber-stamp something no one can check; tracking it as a follow-up is the honest alternative. This is the pattern V-247/248/249 ran ad hoc (a human ordering "verify-the-fix" follow-ups at the land gate); naming it here makes it a first-class, reproducible artifact.

**The same shape serves a second, sibling trigger: a deferred-at-land owed verification (the check-later spin-out, V-319).** Distinct from a *post-deploy* outcome, this is an acceptance-item verification that is **genuinely owed but cannot run at the land gate** — an end-to-end runtime read-back that would need a throwaway resource, an active flow-exercise, or runtime state the gate shouldn't stand up (V-309's case). It is observable-now-but-deferred-for-cost, not post-deploy — yet the honest handling is identical: a human can't discharge it at the pause, so blocking only extracts a rubber-stamp, and the owed verification is tracked as a follow-up instead of being waived into a Done-comment prose note. Both triggers produce the same canonical artifact, differing only in dedupe key + title (below).

**Its canonical shape** (the artifact `/land-ticket` §6.7 auto-produces, and the one a human files manually for the same purpose):
- **Title:** by trigger — `verify-the-fix: <source-ID> — <what to confirm post-deploy>` (monitoring) or `check-later: <source-ID> — <owed verification>` (deferred-at-land, V-319).
- **Dedupe anchor:** a key line in the body — `monitor-key: <source-ID>` (monitoring) or `defer-key: <source-ID>` (check-later, V-319) — so a re-land (or a second person filing the same follow-up) is deduped, not double-filed (mirrors the harvesters' `harvest-key`/`feedback-key`). The **two keys are distinct**, so a ticket owing *both* a monitor and a deferred verification files two independently-deduped follow-ups.
- **Acceptance** (convention 3): the specific checks, each verifiable — post-deploy (`no recurrence of <X> over the next N runs`, `<metric> holds after deploy`) or the owed verification steps for a check-later item (`raw reads DENY via end-to-end runtime read-back`) — not "works well". A **check-later** body also carries its **origin** (`parent: <source-ID>` · the specific owed acceptance item · why it couldn't run at land).
- **Home:** the repo's **deferred-checks bucket** (`deferredChecksProject`, e.g. "deferred checks" — V-319's unified home for both triggers; falls back to `standaloneProject` where unset) — a deferred check is a one-shot verification, not a bug report, so it does not go in the bugs bucket.

**Producers:** `/land-ticket` §6.7 auto-files these after a merge — reading the §4.9 **POST-DEPLOY MONITORING** block (post-deploy-only residue → `verify-the-fix:`, `monitor-key`; V-257) and the §4.9 **DEFERRED VERIFICATION** block (genuinely-owed check-later residue → `check-later:`, `defer-key`; V-319), deduping on each key, and reading the returned ID back before naming it (convention 8). The DEFERRED VERIFICATION block has two feeders: an owed `manual-verify`/`invariant` need partitioned at §4.9, and a §4.8 `invariant`-item deliberate-defer routed in from §5 — so an owed acceptance-item verification that can't run at land becomes a tracked `check-later:` ticket instead of a Done-comment prose note. A human can file either shape by hand when they spot an outcome (post-deploy) or an owed verification (deferred-at-land) worth tracking. Either way the outcome is *tracked*, not lost to a waived residue — the deficit this convention closes. (These are spin-outs of *verification*, so they are exempt from the triage-line above: authoring the small follow-up ticket is the sanctioned act, not scope creep. A *merely-nice-to-have* check is dropped, not minted — only a genuinely-owed one becomes a ticket.)

---

## 10. Craft register — read-first

`craft/` is the **judgment** substrate — a read-first sibling to this file. Where these conventions keep *procedure* honest and resumable, the craft register governs how a skill exercises **designer-grade judgment** while it works (names the default instinct and resists it; self-critiques output against named constraints before shipping; reasons diagnostically over a bare checklist). Its constitution and index is `craft/README.md`; per-domain files (`craft/judgment.md`, `craft/authoring.md`, …) carry the depth.

- **Read it on-demand, per command — not at SessionStart.** A command that exercises judgment opens `Read ~/.claude/craft/README.md` in its header, the same way it already opens `Read ~/.claude/workflow-conventions.md first`. On-demand load pays the register's token cost once per invocation, when judgment is actually needed — not every turn. This is the resolution to the persistent-register token tension the craft research flagged.
- **It references `pipeline/principles.md`; it does not restate it.** `principles.md` is the *output* quality-bar, judged top-down at `/validate`; `craft/` operationalizes that bar for the *moment* of authorship. Three distinct layers — output bar, procedure, judgment — no competing constitutions. The full ontology lives in `craft/README.md`.
- **Adopt it incrementally — but track it, or "incrementally" becomes "never."** Not every command needs craft, and pure-procedure / capture commands shouldn't have it (a craft line that carries no load is the *Ceremony* anti-pattern). The judgment commands wire it first (the review / scope / build / gate rail); the rest follow on a command's **next substantive edit** or when **`/review-skill` flags it**. The register is the shared source — a command opts in by adding the read-first line to its header (grep `craft/README.md` across `commands/` to see who has). The remaining surface and the full adoption rule are tracked in **`craft/retrofit-backlog.md`** (V-127) so the deferral stays visible rather than silently lapsing. And the craft files themselves earn or lose *their* place via the governance loop (**`craft/governance.md`**, V-126): each domain craft file carries a line-1 `Status` header (`hypothesis | reinforced | retired`) and is reinforced or retired on `/report-feedback` + `/review-skill` evidence — so a craft file that stopped helping can be dropped on evidence, not left loaded forever.
- **Authoring craft files — and pipeline skills — follows the imported `skill-creator` conventions** recorded in `craft/README.md`: explain the why, keep bodies under ~500 lines, let metadata drive invocation, disclose progressively, and avoid all-caps `ALWAYS`/`NEVER` blocks (a yellow flag — reframe and give the reasoning).

---

## 11. Confirm gates — one mechanism (`needs input:` prose, never a modal)

A **confirm gate** is any STOP where a skill needs a human *yes* before an irreversible or outward-facing action — a merge, a `db push`, a branch/worktree teardown, a publish, or any `needs-eyes` acknowledgement. The failure this convention removes: the same gate gets asked three different ways depending on which skill and which run you're in — `/go`'s one-token `p`, a free-text `needs input:` line, or an `AskUserQuestion` modal — because no skill ever said *how* a gate should be rendered. (Likely trigger, unproven: V-113 allow-listed `AskUserQuestion`, making the modal frictionless, which plausibly let it leak into gate rendering. The fix holds regardless of cause — whatever let the modal in, this convention rules it out.)

One mechanism, for reasons that are load-bearing, not stylistic:

- **A confirm gate is a `needs input:` prose stop on its own line** — stating the irreversible action, what proceeding does, and how to redirect. It is the only surface the **background-session state classifier** can see: that classifier reads message *text*, not tool calls, so this is the difference between a job parked as "needs input" and one stuck looking like it's still "running". It is also the surface `/go` knows how to drive.
- **`/go`'s one-token protocol is this same stop's orchestration affordance, not a second mechanism.** When `/go` drives a sub-skill it reads that skill's `needs input:` gate and offers the human one token — `p` = proceed with the stated default (logged `p'd`), anything else = a literal instruction to obey (logged `intervened`). The skill-level `needs input:` prose stays the source of truth; `/go` layers `p` over it.
- **`AskUserQuestion` is not a confirm gate.** It is a tool call (invisible to the bg-state classifier) and it bypasses `/go`'s `p` path, so it is the wrong tool for an approval / irreversible-action gate. Reserve it for a **discrete-choice fork** — picking among options, not approving an irreversible action — **when all three hold: the user is present, no bg-state signal is in play, and a multiple-choice UI genuinely beats prose** (e.g. `/plan`, `/spawn-tickets` phase picks, `/next-ticket`'s ticket picker). Those conditions are the rule; the planning skills are just where they usually apply.
- **Every gate is immediately preceded by a one-line restatement of the ticket's goal/summary.** The approver may be meeting the ticket for the first time — acute in `/go`, which launches a ticket the human never read — so a gate that asks "merge?" without stating *what this ticket does* forces a blind yes. Put `<TICKET-ID>: <one-line goal>` on the line just above the `needs input:` stop, sourced from the ticket's Goal/title (not a paraphrase of the gate's action). It rides *above* the stop, never replacing it — the `needs input:` line stays the classifier-visible surface. **At a merge gate, add one more line between them: `changed: <one-line what-changed/diff-shape>`** (e.g. `changed: 2 command files + 1 new bin helper, no migrations`) — the approver of an irreversible publish needs *what this does* and *what it touches*, not just land-ticket's receipts.
- **A third gate kind exists: the ack gate (`[HARD STOP]`)** — a pause that a bare `p` must **not** pass, distinct from both the confirm gate (`p`-able) and the run-ending hard stop (nothing to approve). Use it where proceeding requires the human to have actually engaged — a research-ticket review point, a security-HIGH waiver, a manual-test residue (the V-169/V-179 rules are instances of this kind). Render it as `needs input: [HARD STOP] <decision required> — <what the human must supply>. A bare 'p' does not pass this gate.` `/go` drives it per its §2: `p` → re-state the gate and wait; only an explicit instruction (an answer, a per-item waive, a named-token ack) clears it, logged `ack'd` or `intervened`.

Gate line shape — the one-line ticket-goal restatement, then the stop (precise, not ad-hoc prose):
`<TICKET-ID>: <one-line goal/summary>`
`changed: <one-line what-changed/diff-shape>`   *(merge gates only)*
`needs input: <irreversible action> — <what proceeding does / the default>. Reply to proceed, or <how to redirect / amend / deny>.`
For an ack gate: `needs input: [HARD STOP] <decision required> — <what the human must supply>. A bare 'p' does not pass this gate.`

Skills that gate (`/land-ticket` §5 + §6.7, `/scope`, `/build`, `/go`) render every confirm gate this way; `AskUserQuestion` stays in the planning skills' discrete-fork role.

---

## 12. Model profile — read-first posture layer

The pipeline's **procedures** are model-independent; its **trust posture** is not. Rails calibrated to one model generation's weaknesses degrade a generation that doesn't have them — and under-rail a generation that needs more. So posture lives in a profile, not in command bodies.

- **Selection:** identify the model family you are running as (you know your own identity) and read the **absolute** `~/.claude/pipeline/profiles/<family>.md` — `fable-5.md` for Fable 5, `opus-4-8.md` for Opus 4.x. Always the absolute `~/.claude/…` path, **never** `$(git rev-parse --show-toplevel)/pipeline/profiles/…`: the profiles live in the V repo regardless of which repo a command is driving (like the `errors.jsonl` logger path), so a command running from a non-V repo must not resolve the profile under that repo's root. **No match or unsure → `opus-4-8.md`** (conservative default). A subagent uses the profile its dispatching prompt names, else the same rule.
- **When:** alongside this file — any skill whose header says "read workflow-conventions.md first" reads the active profile too. The cost is one small file per invocation.
- **What profiles own:** the named knobs — `design-check` (adversarial thesis-check vs recorded self-check at the design→build boundary), `scope-plan-depth` (full vs minimal build-plan schema), `re-grounding` (re-verify planning-time findings vs trust-with-staleness-check), `autonomy` (act-vs-ask posture, narration), `review` (review-prompt shape atop the fresh-context core). Commands reference knobs by name; `pipeline/profiles/README.md` is the registry.
- **What profiles may never touch:** hard gates on destructive/irreversible/outward-facing actions, real-scope-change stops, convention 8's evidence rules, convention 11's gate mechanism, and the fresh-context-review core. Those are model-independent — the failure modes they guard (fabricated "verified" claims above all) persist across generations.

## 13. MCP tools are tool calls — load the schema, never guess it

An `mcp__*` tool (Linear, Sentry, Gmail, …) is invoked through the **tool-use mechanism**, exactly like `Read` or `Edit` — it is **not** a shell command and its arguments are **not** memorized trivia. Two failure modes recur in chained (`/go`) runs, both from skipping the schema (V-195: 9 occurrences across 9 product-repo `/go` sessions, every one self-corrected on retry but burned a turn):

- **Tool name run as a shell command.** Typing `mcp__linear__get_issue V-1` (or `mcp__linear get_issue …`) into Bash dies `command not found: mcp__linear` — there is no such binary. Call the tool as a tool; never route it through `Bash`.
- **Guessed argument keys.** Many MCP tools are **deferred** — their schema is not in context until you fetch it (`ToolSearch` `select:<name>`), so a remembered or improvised arg shape is rejected (`-32602 unrecognized_keys` / `invalid_request 400`). Load the schema, read it, then call — the schema in hand is the only authority for the arg names.

**Schemas drift, so a remembered gotcha goes stale** — this is the load-bearing reason, not pedantry. `save_project`/`save_issue` once *rejected* a top-level `team` key (V-195's origin, 2026-06-07); the current schema *requires* `team` on create. A note that hard-coded "save_project takes no `team`" would now be wrong and recreate the bug. Trust the freshly-loaded schema over any remembered list, this one included. Linear specifics, **true as loaded 2026-06-20 — re-verify at call time**:
  - `list_issues` has **no `ids`** — fetch a known id with `get_issue`; filter the rest with `state`/`project`/`label`/`assignee`.
  - `get_issue`/`get_project` take **`id`, not `query`**; `list_projects` takes **no `query`** either (filter by `state`/`label`).
  - `list_milestones` uses **`project`**, not `projectId`.
  - `save_project`/`save_issue` **do** take a top-level `team` (required on create) — the inverse of the original V-195 report, and the live proof of why you load the schema rather than recall it.

`next-ticket.md`'s "Linear MCP call discipline" section carries the call-site detail for that command; this convention is the general rule every chained agent inherits.

---

**Precedence:** these conventions are additive to a skill's own steps and to repo `CLAUDE.md`/rules. If a repo rule conflicts, the repo rule wins for that repo — note the conflict in the Deviations log.

**Chain reference:** see `~/.claude/workflow-chains.md` for the full command map — typical flows (feature, standalone, audit), who-calls-who, and where state lives. Each individual skill at `~/.claude/commands/<skill>.md` carries its own operational detail.
