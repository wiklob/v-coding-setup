---
description: One-shot retrospective doc generation — walks repo, identifies subsystems with no System doc, drafts them to the three-bucket convention. Plan-first, part-by-part, propose-vs-write per /gen-claude-md rules. Heavy subagent use (Haiku-routed for read-only inspections). Run once per repo when adopting convention 6.
argument-hint: "[target-dir]  (defaults to repo root)"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# /backfill-docs — retrospective System docs generation

Read `~/.claude/workflow-conventions.md` first (esp. §6) and follow it. Same propose-vs-write rules as `/gen-claude-md`: new docs write directly; existing non-trivial docs get a proposed diff requiring explicit approval.

This skill is **one-shot, retroactive** — meant for the moment a repo adopts convention 6 with an existing under-documented codebase. Steady-state docs maintenance is `/land-ticket`'s §6.5 (per-merge) + `/audit-docs` (on-demand). Don't run this routinely.

**Subagent discipline**: dispatch read-only subsystem inspection to `Explore` or `general-purpose` subagents with `model: "haiku"` (per `~/.claude/memory/feedback_subagent_haiku_routing.md`). Keeps main context lean; subsystem reads can be heavy.

## Phase A — plan only (NO writes)

### A1. Inventory existing docs
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` if given, else `$root`.
- Read `$root/.claude/ticket-flow.json` `docs.systemDocs[]` if present (gives current coverage).
- `Glob` `$root/docs/*.md` (depth 1). For each, classify into System / Decision / State per convention 6 by reading line 1–10 (banner / freshness header signals).
- `Glob` `$root/**/CLAUDE.md` (excluding vendored). List per-folder CLAUDE.md files — they cover their own dir but don't substitute for a System doc.

### A2. Survey code → identify gaps
- `Glob` direct + 2-deep children of `$root` to identify candidate **subsystems** (coherent module / concern that warrants its own System doc — not every leaf folder). Use the existing repo `CLAUDE.md` to understand boundaries. When unsure, prefer the unit a fresh agent would reason about as one thing.
- For each subsystem, check: is it covered by an existing System doc's `covers` paths (from `cfg.docs.systemDocs`)? Or by a strong per-folder CLAUDE.md (> 20 lines, substantive)?
- A subsystem is a **gap** if: no System doc covers it AND its per-folder CLAUDE.md is absent / trivial AND it has ≥ 5 source files (not just a leaf).

### A3. Write the plan
Write `$root/docs/plans/backfill-docs-<area-slug>.md` per the Plan Artifact convention (convention 1):

```
# Plan: backfill docs (<area>)
Status: planning
Created: <YYYY-MM-DD>  ·  Source: /backfill-docs <target>

## Goal
Backfill missing System docs for <area> per convention 6. New docs only — no edits to existing System docs (those go through /audit-docs → /triage-findings).

## Scope
In: <subsystems with no doc>
Out: <subsystems already covered + reason>

## Manifest (ordered, checkable)
- [ ] P1. docs/<subsystem>.md — System doc covering <paths>
- [ ] P2. ...

## Risks / unknowns
- ...

## Deviations
```

Order parts by dependency: foundational subsystems (shared lib, schema, infra) before consumers.

### A4. STOP — show manifest, get go/adjust
Print the gap list + the manifest + the inferred `covers` paths for each new doc. **No writes until user approves or adjusts.** On go: set `Status: in-progress`.

## Phase B — execute part-by-part (resumable)

For each unchecked Manifest part, in order. The plan file is the resume state — safe to interrupt between parts.

### B1. Subagent inspection (Haiku)
Dispatch one subagent per subsystem with explicit `model: "haiku"`:
- Subagent type: `general-purpose` (or `Explore` if pure read-only is enough).
- Prompt: "Read every source/config file under `<subsystem path>` (exclude vendored / build). Return a structured summary: (1) purpose in 1-2 sentences, (2) key files with one-line export/responsibility per file, (3) data flow in/out, (4) cross-module / DB / external touchpoints, (5) non-obvious behavior + pitfalls a fresh agent would get wrong. Cite `file:line` for every claim. Keep response under 600 words."
- Wait for the report. The subagent's read of the code is the ground truth — main context only carries the structured summary.

### B2. Draft the System doc
Using the subagent summary, draft `docs/<subsystem-slug>.md` to the System-doc shape per convention 6:

```
> Last verified against code: <YYYY-MM-DD> (initial backfill)

# <Subsystem> — <one-line purpose>

<2–4 lines: what this subsystem is responsible for, where it sits in the system, who calls it.>

## Key files
- `<path>` — <one-line purpose / export>
- ...

## Conventions / non-obvious behavior
- <rule, registry, ordering constraint, gotcha>

## Pitfalls
- <real "don't do this" grounded in the code>

## See also
- Related System docs / Decision docs by path
```

Rules:
- Reference root `CLAUDE.md` decisions instead of duplicating them.
- Every claim traceable to the subagent's cited `file:line`.
- No filler — omit any section with nothing true and useful.
- Keep tight: target ~60–120 lines per doc.

### B3. Write or propose
- **New doc (target doesn't exist)** → `Write` directly. Pure-new docs, low risk.
- **Existing trivial stub** (< 20 lines, no substantive content) → `Write` directly.
- **Existing non-trivial doc** → do NOT overwrite. Draft a proposed diff against the current doc, present it with justifications tied to subagent's cited facts, and **STOP for approval**. Apply only on explicit yes. (Same load-bearing caution as `/gen-claude-md` and `/review-claude-md`.)

### B4. Close the part
- Check the Manifest box the instant the doc is written or approved-and-applied.
- A part that can't be completed (subagent couldn't read, subsystem turned out trivial, doc rejected) stays unchecked + a `## Deviations` entry. Never silently skip.

## Phase C — close

### C1. Update `.claude/ticket-flow.json` `docs.systemDocs`
- For each new doc written, append an entry to `cfg.docs.systemDocs[]`: `{"doc": "docs/<slug>.md", "covers": ["<inferred path prefixes>"]}`.
- If no `docs` block exists, create it (with `changelog: "docs/changelog.md"` and `postponed: "docs/postponed.md"` defaults — assuming those exist or are about to be created).
- Stop for user confirm before writing the JSON — the `covers` paths are a judgment call.

### C2. Set plan Status: done
- Summarize: docs written, docs proposed-pending-approval, parts skipped (from Deviations).

### C3. Next step (convention 4)
- Print: `/audit-docs` (verify the backfill — freshness headers should pass; drift should be minimal since we just wrote against ground truth).
- Then: open a PR for the backfill batch (review by a human before merge — these are load-bearing docs going to `<baseBranch>`).
- After PR merges: future `/land-ticket` runs will keep them fresh via §6.5.

## Hard rules
- Plan-first: Phase A produces only the plan, then STOPS for go/adjust. Never one-shot.
- Resumable: the plan file is the only state; re-invoking resumes at the first unchecked part.
- Read code via **Haiku-routed subagents** — keep main context off bulk file reads. The subagent's `file:line` cites are the ground truth.
- Propose-vs-write rule per part: new files write directly, existing non-trivial files require explicit-approved diff.
- Update `.claude/ticket-flow.json` `docs` block at the end (C1) so steady-state `/land-ticket` and `/audit-docs` can find the new docs.
- One-shot retrospective. After this runs, the per-merge `/land-ticket` §6.5 + on-demand `/audit-docs` are the maintenance path. Don't re-run this routinely.
- Language-agnostic; no hard-coded repo paths.
