---
description: Read-only bidirectional orphan sweep of the built Objective→Initiative→Project→Milestone→Issue trace tree — reports every broken trace edge (dead-root objective, project without initiative, milestone without criterion, issue without milestone) with its Linear ID and the fix. Documents + reports; mutates nothing.
argument-hint: "(no args)"
allowed-tools: Bash, Read, Write, mcp__linear
---

# /trace-audit — bidirectional orphan sweep of the trace tree

The audit half of the left wing. Where `/align` reasons over the **funnel** (the convergent Intake side — many ideas → one project), this sweeps the **built tree** (the divergent V — one project → many issues) and reports where the trace edges are broken. It is to the trace tree what `/sweep` is to the codebase: a **read-only, fact-rooted report**, never a fix. Every finding names the broken edge and the fix; graduating a finding to a ticket is `/triage-findings`'s job, not this command's.

Read `~/.claude/workflow-conventions.md` first (esp. conventions 4, 8) and `~/.claude/craft/README.md` — the judgment substrate. The default instinct to resist here (`craft/judgment.md`): **report from intent, not observation.** An edge is "broken" only when the live read shows it broken — every finding cites the actual Linear/registry read it rests on, never an assumed state.

This repo has **no CI and no out-of-session Linear access** — every Linear call is an in-session MCP read. So this is a command the agent runs, not a cron; there is no `bin/*` helper, because the tree's state can only be observed by in-session MCP reads.

## What `/trace-audit` is NOT

- **Not a fix.** It reports broken edges; it never writes Linear, never reattaches a project, never edits a milestone. Fixes graduate to tickets via `/triage-findings`.
- **Not `/align`.** `/align` gates the funnel (idea → promote/park/kill against objectives). This audits the built tree's structural integrity. Different surface, different read-contract.
- **Not `/refresh-landscape`.** That re-derives the cached KB snapshot (`landscape.md`); this reads **live** Linear so it audits current state, not a snapshot that may itself be stale.

## Linear MCP call discipline

Read-only throughout. One paginated `list_projects` per in-scope team (its results feed **both** sweep directions), then one `list_milestones` and one paginated `list_issues` per surviving project. At most one `list_initiatives includeProjects: true` is used — and **only** to resolve an Initiative's display name for a dead-root finding, never to detect the dead root (§2 derives that from the project map alone). No `get_*` per node, no writes.

## Config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). Use `linearTeam`, `objectivesRegistry`.
- **Objectives registry** (the trace-down roots): resolve `objectivesRegistry` from config, `~`/`$HOME`-expanded to an absolute path; default `~/.claude/pipeline/objectives.md`. **Never** the bare repo-relative `pipeline/objectives.md` — a run from another repo would read a nonexistent registry.
- **In-scope teams** (the trace-up project set — the domains the co-mingled registry spans): from `.claude/ticket-flow.json` — `cfg.landscapeTeams` (array of `{ "name", "key" }`), falling back to the single `cfg.linearTeam`. Same set `/refresh-landscape` pulls, so the audit covers every team whose objectives it roots from.
- **Findings doc:** `docs/plans/trace-audit-findings.md` (the only file this command writes).
- **Live filter:** a project is **live** when `status.type ∉ {completed, canceled}`; an issue is **live** when `state.type ∉ {completed, canceled, duplicate}` (a duplicate-state issue is terminal — closed-as-dup — so its trace is moot, same as canceled). Compare on the stable enum `type`, **never** the localizable `name` (`/refresh-landscape` §49 rule). Both negative sets ARE expressible server-side now via `includeCompleted: false` (V-246) — `list_projects`/`list_issues` drop exactly those terminal `type`s — so step 1 fetches the live set directly instead of fetch-all-and-drop-client-side.

## 1. Pull the tree (one project sweep feeds both directions)

1. **Run date** — `date +%F` (one Bash call) for the findings-doc header.
2. **Projects, per in-scope team** — `mcp__linear list_projects team: "<team name>" includeCompleted: false limit: 50`, once per in-scope team. `includeCompleted: false` returns only live projects (per Config), which is exactly the set the trace map is built from. **Paginate** while `hasNextPage` (pass `cursor`). Keep each project's `id`, `name`, `status.type`, `initiatives[]` (id + name), and `team`.
3. **Milestones, per project** — `mcp__linear list_milestones project: <id>` for each project. Keep each milestone's `name` + `description` (the criterion lives in the description).
4. **Issues, per project** — `mcp__linear list_issues project: <id> includeCompleted: false limit: 50`. `includeCompleted: false` returns only live issues server-side (per Config — drops `state.type ∈ {completed, canceled, duplicate}`), so the audit's live set arrives already filtered (a big cut: a mature project is mostly Done issues). **Paginate** while `hasNextPage` — `list_issues` has no milestone filter and a 50 default, so an un-paginated read silently under-reports. Keep each issue's `identifier`, `state.type`, and `projectMilestone` (id + name, or null).
5. **Objectives** — read the registry. Each objective block carries `**Initiative:** <name> (<uuid>)` (or `—` if unmirrored) and `**Status:** active | parked | retired`. Audit **active** objectives only (a parked/retired objective is intentionally rootless).

## 2. Trace-down — every objective roots a live project (dead-root check)

`objectives.md` is the **root enumerator**: the audit walks the objectives *the registry declares*, not the initiatives Linear happens to hold — so an objective whose Initiative has zero (or only-Canceled) projects is caught precisely because the registry, not Linear, drives the loop.

Build an **initiative-id → [live projects]** map from step 1.2: each project contributes to every initiative in its `initiatives[]`, keeping only projects whose `status.type` is live (the §Config filter — `∉ {completed, canceled}`, on the stable enum, never `status.name`). **This map is the membership test, and a miss is the dead-root signal** — an objective whose Initiative id is absent from the map, or present with an empty list, has no live project; no per-initiative fetch is needed to detect it. Then for each active objective:
- **Initiative is `—` (unmirrored)** → finding **dead-root objective**: `<objective name> — active objective not mirrored to any Initiative → create the Linear Initiative and record its id in objectives.md`.
- **Initiative id has zero live projects in the map** (no projects at all, *or* every project under it is Completed/Canceled — the client-side live filter already collapses both to "zero survivors", so do not special-case the all-Canceled variant) → finding **dead-root objective**: `<objective name> (Initiative <name>) — no live project under its Initiative → spawn or revive a project under this objective, or park the objective in objectives.md`.
- **≥1 live project** → healthy; no finding.

## 3. Trace-up — every edge reaches its parent

Walk the live tree from step 1 and flag each missing edge with the node's Linear ID:
- **Project without an Initiative** — `initiatives[]` empty → finding **project without initiative**: `<project name> (<id>) — project has no Initiative → attach it to its objective's Initiative (save_project addInitiatives), or record the objective in objectives.md first`.
- **Milestone without a criterion** — `description` lacks a `**Verification criterion:**` marker, or the marker is present but its value is empty (`/validate` §2's inline milestone-criterion parse; `/spawn-tickets` §3 writes it) → finding **milestone without criterion**: `<project name> › <milestone name> — milestone description carries no Verification criterion → add a **Verification criterion:** line to the milestone description`.
- **Issue without a milestone** — a **live** issue (`state.type ∉ {completed, canceled}`) whose `projectMilestone` is null → finding **issue without milestone**: `<issue identifier> — live issue has no milestone → assign it to a milestone (save_issue milestone)`. (Done/Canceled issues missing a milestone are historical noise, not actionable orphans — the live filter keeps the report actionable.)

## 4. Emit the findings doc (read-only — the report IS the output)

Write `docs/plans/trace-audit-findings.md`. "Mutates nothing" means **no Linear write and no edit to the audited tree** — emitting this report is the deliverable, exactly as `/sweep` writes its findings doc; it is not a mutation of the system under audit.

**The doc conforms to the `/triage-findings` input schema** (the `/sweep` §B2 shape), so its findings graduate to fix-tickets through the unchanged router (§5) instead of rotting as a static report. The contract `/triage-findings` §1a parses: findings grouped under `### <unit>` (H3) below a `## Findings` heading, each line `- [<sev>] \`<locus>\` — <issue> → <fix>`, with `<sev> ∈ critical|high|med|low`. Map the audit onto it:
- **Each orphan class is a unit** — the `### ` header is the class name.
- **The broken Linear node is the `<locus>`** (objective name; project name + id; project › milestone; issue identifier) — the trace-audit analog of `/sweep`'s `file:line`. The parser treats the token between `]` and `—` as an opaque locus; it is **not** path-validated, so a Linear id/name sits there cleanly.
- **Severity is fixed per class** by the impact of the broken edge — **dead-root objective = high, project-without-initiative = high, milestone-without-criterion = med, issue-without-milestone = low** — which drives `/triage-findings`'s severity→priority map.

```markdown
# Trace audit — <YYYY-MM-DD>
> Read-only sweep of the Objective→Initiative→Project→Milestone→Issue tree. Mutates nothing.
Scope: objectives (active) from <registry path>; teams <in-scope team list> (live projects).

## Findings

### Dead-root objectives (trace-down)
- [high] `<objective name>` — <broken edge> → <fix>

### Projects without an Initiative (trace-up)
- [high] `<project name> (<id>)` — <broken edge> → <fix>

### Milestones without a verification criterion (trace-up)
- [med] `<project name> › <milestone name>` — <broken edge> → <fix>

### Issues without a milestone (trace-up)
- [low] `<issue identifier>` — <broken edge> → <fix>

## Summary
Objectives audited: <n active> · dead roots: <n>
Projects audited: <n live> · without initiative: <n>
Milestones audited: <n> · without criterion: <n>
Live issues audited: <n> · without milestone: <n>
Total broken edges: <n>
```

A class with no findings keeps its `### ` heading with a single `_none_` line (italic — **not** a `- ` bullet) — a clean tree reads as audited, not as a dropped section, and the non-bullet marker is skipped by `/triage-findings`'s line parser (it consumes only `- [<sev>] … → …` finding lines), so an empty class never mis-parses as a finding. Keep the ` — ` and ` → ` separators byte-identical to `/sweep` §B2 (ASCII spaced em-dash and arrow) — the parser is line-literal. The `# Trace audit` title, the `>` blockquote, the `Scope:` line, and the `## Summary` block carry no `- [<sev>] … → …` lines, so the parser ignores them.

## 5. Hand off (convention 4) — findings are not auto-filed

Like `/sweep`, the reviewed findings doc is the deliverable; the user picks which findings graduate. Most trace-audit findings are atomic single-edge fixes (attach a project, add a criterion line, assign a milestone) — the standalone-bucket shape.

- Print the findings-doc path and the per-class counts from the Summary.
- **Name the next step:** `/triage-findings docs/plans/trace-audit-findings.md` — it presents the findings and files the selected ones (atomic edges as standalones; any genuine cluster via `/plan-quick`). `/trace-audit` itself files nothing and writes nothing to Linear.
- **Routing note (expected `(no-suggest)`):** a trace finding's fix is a Linear-API mutation (attach a project, add a criterion, assign a milestone), which matches **none** of `/triage-findings` §1b's AUTO-APPLY *or* STANDALONE verb patterns — so each auto-classifies as **`(no-suggest)`**. That is correct, not a defect: `/bulk-fix` (a code executor) cannot perform a Linear write, so **STANDALONE** is the right route. At the §2 confirm gate, route each trace finding to STANDALONE (`<n>: standalone`); it files to the standalone bucket and is picked up via `/next-ticket`. The router is used **unchanged** — only the auto-*suggestion* is `(no-suggest)`.

Emit `result:` on its own line: `result: /trace-audit — swept <n> active objectives + <n> live projects; <n> broken trace edges across <classes>. Findings: docs/plans/trace-audit-findings.md. Next: /triage-findings.`

## Cadence

`/trace-audit` is **on-demand** — run it whenever you want a current picture of the trace tree's structural integrity. There is no cron path (this repo has no CI and no out-of-session Linear access; every read is an in-session MCP call), so the cadence is driven by the moments the tree most likely just gained a broken edge:

- **After a `/spawn-tickets` run** — the moment new projects/milestones/issues enter the tree is when a missing Initiative attach, an empty milestone criterion, or an unassigned issue is most likely introduced. Run `/trace-audit` then to catch the break while the context is fresh, and graduate the findings via `/triage-findings`.
- **Periodically** — a standing sweep (e.g. weekly, or at the start of a planning session) catches drift that accumulates between spawns: an objective whose last live project completed (a new dead root), a milestone whose criterion was never filled in.
- **Before `/validate`** — a clean trace tree is a precondition for system validation; running the audit first surfaces orphans that would otherwise fail validation late.

Each run emits the findings doc; graduate its findings to fix-tickets via `/triage-findings` (§5).

## Hard rules
- **Read-only — mutates nothing in Linear or the tree.** The only file written is `docs/plans/trace-audit-findings.md` (the report). No `save_*`, no `Edit` of source, no reattachment — fixes become tickets via `/triage-findings`. The read-only guarantee is structural: `allowed-tools` excludes every Linear-write MCP and `Edit`, scoping `Write` to the findings doc.
- **Observed, not asserted (convention 8).** Every finding cites the live read it rests on — never a finding from an assumed or cached state. This is why it reads live Linear, not `landscape.md`.
- **Filter on `status.type`, never `status.name`** — type is the stable enum; the name is localizable.
- **Paginate every `list_*`** — `list_issues` especially (no milestone filter, 50 default); an un-paginated read under-reports orphans and falsely reads as a clean tree.
- **`objectives.md` is the trace-down enumerator** — walk the registry's active objectives, not Linear's initiatives, so an objective with zero/all-Canceled projects is caught.
- **Canonical registry path** — resolve `objectivesRegistry` / `~/.claude/pipeline/objectives.md` (`~`-expanded), never bare repo-relative.
- **In-session only** — every read is an in-session MCP call; no `bin/*` helper, no cron path (this repo has neither CI nor out-of-session Linear access).
