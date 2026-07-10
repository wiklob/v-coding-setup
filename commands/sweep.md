---
description: Methodical fact-rooted repo sweep — one engine, two outputs: refresh per-folder docs + record a reviewed findings doc. Plan-first, part-by-part, resumable. Documents + reports; never fixes code (fixes become tickets).
argument-hint: "[target-dir]  (defaults to repo root)"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# /sweep — methodical codebase sweep (docs backfill + retroactive review)

Read `~/.claude/workflow-conventions.md` first and follow it (esp. conventions 1, 2, 4). One **fact-rooted, plan-first, resumable** traversal that visits every unit once and produces two outputs: refreshed per-folder docs and a single reviewed findings doc. **It documents and reports — it does not modify code.** Code fixes become tickets, not edits. Be terse and decisive; never guess from filenames — read the actual code.

## Start check (soft — convention 4)
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` if given, else `$root`. Resolve absolute.
- Read `$root/CLAUDE.md` + repo rules if present (house conventions, language/toolchain — stay language-agnostic). Note any `.claude/ticket-flow.json` (used only for the findings→tickets handoff at the end; not required to sweep).
- If a `docs/plans/<slug>-sweep.md` for this target already exists, this is a **resume**: read it + `docs/plans/<slug>-findings.md`, skip to Phase B at the first unchecked part. Don't re-plan. The two files ARE the state.

---

## Phase A — plan only (NO edits, NO findings yet)

### A1. Survey structure
- `Glob` the tree under target; exclude vendored/build/lock dirs (`node_modules`, `dist`, `build`, `.venv`, `target`, `vendor`, `.git`). Read **enough** of each area to judge its boundary — not just names.
- Decide **units**: a unit is a coherent module/directory with its own responsibility and exports (the granularity that warrants its own CLAUDE.md), not every leaf folder. Group trivial sibling leaves into their parent unit; split a dir that hosts unrelated concerns. When unsure, prefer the unit a fresh agent would reason about as one thing.
- **Apply the placement/depth policy** (conventions §6 "CLAUDE.md placement & depth"): a per-folder CLAUDE.md is re-loaded on every read below it, so place it at the shallowest unit boundary, never a leaf, and only when it passes the earn-its-place test (non-obvious content no ancestor already says **and** a subtree read often enough to repay the cascade tax). Prefer ≤ 2 CLAUDE.md levels on any path. A thin/restating deep file is a finding (push it up or into `docs/`), not a file to refresh; an `AGENTS.md` duplicating its sibling `CLAUDE.md` is a merge-and-delete finding.

### A2. Write the plan (Manifest only)
Write `docs/plans/<slug>-sweep.md` per the Plan Artifact convention (`<slug>` = kebab area, e.g. `stage-3-sweep`, `engine-sweep`):
```
# Plan: <area> sweep
Status: planning
Created: <YYYY-MM-DD>  ·  Source: /sweep <target>

## Goal
Sweep <target>: refresh per-folder docs + a reviewed findings doc. No code changes.

## Scope
In: <units>   Out: <excluded dirs + why>

## Manifest (ordered, checkable)
- [ ] P1. <unit path> — docs lens + findings lens
- [ ] P2. ...

## Risks / unknowns
- ...

## Deviations
```
- **Order** by dependency / priority: shared/foundational units before consumers; highest-blast-radius first.
- Create `docs/plans/<slug>-findings.md` now as an empty skeleton (header + `## Findings` + `## Summary` placeholder) so resume has a stable target.

### A3. STOP — show the manifest, get go/adjust
Print the ordered Manifest (unit list + the in/out scope) and the unit-granularity call. **Outline before you act:** no reading-for-findings, no doc writes, no findings until the user approves or adjusts. On go: set `Status: in-progress`.

---

## Phase B — execute part-by-part (resumable)

For each unchecked Manifest part, in order. The plan + findings files are the resume state — safe to interrupt between parts.

### B0. Read the unit (ground truth)
- `Read` every source/config file in the unit (batch if large; never skip — claims are verified against code you actually read). Trace real exports, entry points, data flow, cross-module/DB/external touchpoints, registries/presets, ordering constraints.

### B1. Documentation lens — defer to the point-2 primitives (don't reimplement)
- **Existing CLAUDE.md in the unit:** run `/review-claude-md <unit>` semantics — fact-root it; if drifted, **propose** the diff and stop for approval (load-bearing context: never silently rewrite). REWRITE verdict → recommend `/gen-claude-md <unit>`.
- **No CLAUDE.md (or trivial stub):** run `/gen-claude-md <unit>` semantics — generate from the code you just read. Pure-new docs → write directly. Existing non-trivial → propose-diff + approval.
- **Doc-write boundary (resolved — no ambiguity):** the **only** thing a sweep authors directly is `CLAUDE.md` (per the primitives' propose-vs-write rule: write only when absent/trivial; otherwise propose a diff for an explicit yes — never silently overwrite load-bearing context) plus its own plan + findings docs. **Every other doc** (READMEs, archive banners, docstrings, design notes) is treated like a code fix: it does **not** get written by the sweep — it becomes a finding that graduates to a ticket. This keeps "sweep documents + reports; fixes become tickets" unambiguous.
- If the unit has nothing non-obvious to say, record "no CLAUDE.md — adds no value" and move on (no filler).

### B2. Findings lens — append to the one reviewed findings doc
- Record issues into `docs/plans/<slug>-findings.md` under `## Findings`, grouped by unit:
```
### <unit path>
- [SEV] `file:line` — <issue> → <one-line suggested action>
```
- Hunt for: unfinished/TODO/stub/messy code, dead/unreachable code, bugs, missing or broken tests, contract/schema drift, boundary violations, risky patterns, doc↔code mismatch found while reading.
- `SEV` ∈ `critical | high | med | low`. Every item needs `file:line`, a concrete issue, and a single suggested action. **Reviewed, not raw:** only land items you actually verified in the code — no speculative noise, no padding to look thorough.
- This is a report only. **Do not fix code.** Fixes graduate to tickets at the end.

### B3. Close the part
- Check the Manifest box the instant the unit is truly done (both lenses). Keep `Status` current.
- A unit that can't be completed (blocked, unreadable, out of scope on contact) stays **unchecked** + a `## Deviations` entry (convention 2) — never silently skip. If a deviation invalidates later parts, update the Manifest and note it.
- Any CLAUDE.md diff still awaiting approval: note it in the part line as `docs: proposed-pending` — the part is not fully done until resolved, but the sweep continues to the next unit.

### B4. Sweep complete
- All parts checked (or accounted for via Deviations) → set plan `Status: done`.
- Finalize `docs/plans/<slug>-findings.md` `## Summary`: counts by severity, units with proposed-pending docs, top 3-5 highest-severity items.

---

## Findings → tickets handoff (convention 4) — NOT automatic

Findings are **not** auto-filed. The reviewed findings doc is the deliverable; the user picks which findings graduate. **Two routes:**

| Shape | Route |
|---|---|
| Anything from a sweep (atomic fixes + coordinated clusters mixed) — the common case | **`/triage-findings <findings-doc>`** — one interactive batch: select atomic findings as standalones (bulk-filed to `<standaloneProject>`) AND/OR define N plan clusters (each becomes a parallel `/plan-quick` subagent, capped at 5). One confirm gate, one execution, one report. Idempotent re-run. |
| A single cluster that needs interactive design discussion | **`/plan "<scope>"`** — standard interactive flow with full Stack Decision + Manifest checkpoints. |

A findings doc has no Manifest, so it cannot feed `/spawn-tickets` directly — `/triage-findings` is what turns selected findings into either standalone Linear tickets (no slicing needed) or sliced+acceptance-checklisted plan parts (via parallel `/plan-quick` subagents). Use plain `/plan` only when there's exactly one cluster and you want to talk through it.

For one-command end-to-end (`/sweep` → `/triage-findings` → `/spawn-tickets` per ready plan), use **`/audit-cycle [target-dir]`** instead — same gates, no re-typing between phases.

- Print the path to `docs/plans/<slug>-findings.md` and the severity summary.
- List CLAUDE.md diffs still pending approval and any pure docs written.
- **Name the next step:** typically `/triage-findings <findings-doc>` — it presents the findings, asks the user to triage in one prompt (standalones via select-pattern + N plan clusters with scopes + finding refs), previews everything, then on go fires the `/plan-quick` subagents in parallel and bulk-creates the standalones. After it returns: `/spawn-tickets <plan>` per ready plan; `/next-ticket <STANDALONE-ID>` for any standalone. `/sweep` itself files nothing.

## Hard rules
- Plan-first: Phase A produces only the plan + empty findings skeleton, then STOPS for go/adjust. Never one-shot a subtree.
- Resumable: the plan + findings files are the only state; re-invoking resumes at the first unchecked part. Never re-plan an in-progress sweep.
- Read the real code before any claim or finding — never filename guessing, never hallucinated issues. Findings are reviewed, not raw.
- **Never modify code in a sweep.** It documents + reports; fixes become tickets.
- CLAUDE.md changes follow `/review-claude-md` / `/gen-claude-md` propose-vs-write rules — no silent rewrite of load-bearing context. CLAUDE.md is the **only** doc a sweep authors directly; all other docs (READMEs, banners, docstrings) become findings/tickets, never sweep edits.
- Findings are never auto-filed and never fed straight to `/spawn-tickets` — emit the reviewed doc; selected findings go through `/plan` first (slicing + acceptance), then the normal `/spawn-tickets` path.
- Language-agnostic; no hard-coded repo paths. If a repo rule conflicts with these conventions, the repo rule wins — log it in Deviations.
