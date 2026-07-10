---
description: On-demand docs/* health check — freshness vs covered code, drift between doc claims and code, root-CLAUDE.md bloat, subsystem coverage gaps. Emits a findings doc; selected items graduate to tickets via /triage-findings. Read-only — never edits docs.
argument-hint: "[target-dir]  (defaults to repo root)"
allowed-tools: Bash, Read, Grep, Glob, Write
---

# /audit-docs — health check for docs/ + CLAUDE.md

Read `~/.claude/workflow-conventions.md` first (esp. §6). This skill **reports** — it never edits docs or code. Findings graduate to tickets via `/triage-findings`. Be fact-rooted: every finding cites a real `file:line` against content you actually read.

Complements `/sweep` (which covers per-folder CLAUDE.md generation) — this skill focuses on `docs/*.md` and the cross-cutting health signals (freshness, drift, bloat, coverage) that `/sweep` doesn't address.

## 0. Load context
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` if given, else `$root`.
- Read `$root/.claude/ticket-flow.json`. If present, parse `docs` block — `changelog`, `postponed`, `systemDocs[]` with `doc` + `covers` paths. **Absent `docs` block → skill still runs**, but freshness checks (which require `covers`) are skipped with a note in the report.
- Read `$root/CLAUDE.md` and `Glob` `**/CLAUDE.md` (excluding `node_modules`, `.next`, `.venv`, `dist`, `build`, `.git`, `vendor`, `target`).
- `Glob` `docs/*.md` (depth 1 — exclude `docs/plans/`).

## 1. Freshness check (requires `cfg.docs.systemDocs`)
For each `cfg.docs.systemDocs[]` entry:
- `git log -1 --format=%cI -- <doc>` → last doc edit timestamp.
- For each path in `covers`: `git log -1 --format=%cI -- <path>` → last code edit timestamp under that path.
- If most-recent code timestamp > doc timestamp AND the gap is > 30 days → emit `[stale] <doc> — last touched <date>, code under <covers...> touched <date> in PR #N`.
- Read line 1 of the doc. If it doesn't match the regex `^> Last verified against code: \d{4}-\d{2}-\d{2}` → emit `[header-missing] <doc>` (low).
- If the header date is older than the doc's git timestamp by > 7 days → emit `[header-stale] <doc> — header says <date>, git says <date>` (low).

## 2. Drift check (always — works without `docs` block)
For each `docs/*.md` System doc (skip `changelog.md`, `roadmap.md`, `postponed.md` — those are State docs, drift doesn't apply):
- Read the doc fully.
- Extract **verifiable claims**:
  - File paths in backticks (`web/src/lib/X.ts`) → exists in repo?
  - Function/export names mentioned alongside file paths → grep the file for that symbol?
  - Table names mentioned with SQL context → present in latest `supabase/migrations/`?
  - Env vars (`SUPABASE_URL`, etc.) → referenced in `.envrc`, `.env.example`, or actual code?
- For each unverifiable claim, emit `[drift] <doc>:<line> — claims X, repo has Y` (or `not found`).
- Be conservative — only flag clear mismatches, not stylistic differences. No speculation.

## 3. Bloat check (always)
- Root `CLAUDE.md` line count: if > 150 → `[bloat-root] CLAUDE.md is N lines (ceiling 150)`. Identify the largest sections (any `##`/`###` block > 30 lines) and list them as extraction candidates: `[bloat-section] CLAUDE.md § <heading> is N lines — extract to docs/<suggested>.md`.
- For each per-folder CLAUDE.md (excluding root): if > 50 → `[bloat-folder] <path> is N lines (ceiling 50)`.

## 3b. Placement / depth check (always) — the cascade tax (conventions §6)

Every per-folder CLAUDE.md is re-loaded on every read of any file below it, so a misplaced one taxes its whole subtree. `Glob` all `CLAUDE.md` + `AGENTS.md` (exclude `node_modules`, `.git`, build/vendor dirs).
- **Depth:** any path with > 2 CLAUDE.md ancestors → `[depth] <leaf-dir> has N CLAUDE.md on its path (<list>) — collapse toward ≤ 2; the deepest taxes every read below it`.
- **Thin/restating deep file:** a non-root CLAUDE.md that is very short or whose content largely restates an ancestor → `[placement] <path> adds little over <ancestor> — fold up or into docs/` (judgment call; flag, don't auto-fix).
- **AGENTS.md duplication:** an `AGENTS.md` sibling to a `CLAUDE.md` in the same dir → `[agents-dup] <dir> has both AGENTS.md and CLAUDE.md — merge into CLAUDE.md and delete AGENTS.md unless an external tool needs the AGENTS.md name`.

## 4. Coverage check (always)
- Identify top-level code dirs that warrant docs: `Glob` direct children of `$root` for source dirs (skip `docs/`, `node_modules`, `.git`, dotdirs, `tests/`, `__tests__/`, lockfiles).
- A dir warrants doc coverage if it has ≥ 5 source files OR ≥ 3 subdirs of source files.
- For each warranting dir: is there a per-folder CLAUDE.md? Is it referenced by any System doc's `covers`? If neither → `[coverage] <dir> has no doc and isn't covered by any systemDoc`.
- Skip dirs that are clearly leaves or pure-config (e.g. `public/`, `assets/`, `migrations/` if no .md sibling expected).

## 5. Emit findings doc
Write `docs/plans/<today YYYY-MM-DD>-doc-audit.md`:

```
# Doc audit — <YYYY-MM-DD>
Status: ready for triage
Source: /audit-docs <target>

## Findings

### Freshness
- [stale] docs/architecture.md — last touched 2026-04-10, code under web/src/lib/ touched 2026-05-04 (PR #42)
- [header-missing] docs/deploy.md

### Drift
- [drift] docs/schema.md:34 — claims 9 tables, repo has 14

### Bloat
- [bloat-root] CLAUDE.md is 187 lines (ceiling 150)
  - [bloat-section] CLAUDE.md § "What's done" is 92 lines — extract to docs/changelog.md
  - [bloat-section] CLAUDE.md § "Postponed indefinitely" is 38 lines — extract to docs/postponed.md

### Placement / depth
- [depth] web/src/app/(app)/settings/ has 4 CLAUDE.md on its path — collapse toward ≤ 2
- [agents-dup] web/ has both AGENTS.md and CLAUDE.md — merge and delete AGENTS.md

### Coverage
- [coverage] dashboard/ has no per-folder CLAUDE.md and no systemDoc covers it

## Summary
- <count> stale · <count> drift · <count> bloat · <count> placement · <count> coverage
- Top severity: <highest>
- `docs` block configured: <yes/no>
```

## 6. Next step (convention 4)
- Print findings path + counts.
- **Name next step**:
  - If any findings: `/triage-findings docs/plans/<file>` — pick what graduates to tickets.
  - If `[bloat-*]` findings present: note that extraction needs human judgment (what stays inline) — recommend manual review of the bloat section before running `/triage-findings` on it.
  - If `[coverage]` findings present: consider running `/backfill-docs <dir>` instead of opening individual tickets.
  - Empty findings → docs are healthy; print one-line "no action needed".

## Hard rules
- Read-only. Never edits docs/ or code. The findings doc is the only file written.
- Every finding cites a real `file:line` or `doc:line` against content read. No speculative findings, no padding.
- Skip silently if prerequisites unmet (no `docs` block → skip freshness; no `supabase/migrations/` → skip table-name verification in drift).
- Don't reinvent `/sweep`: that handles per-folder CLAUDE.md generation. This skill cares about `docs/*.md`, cross-cutting health, and the bloat/coverage signals `/sweep` doesn't compute.
- Language-agnostic; no hard-coded repo paths or `.ts`-only assumptions.
