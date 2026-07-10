---
description: Generate or update a concise, fact-rooted per-folder CLAUDE.md that orients a fresh agent to one directory. Reads the real code; plan-first for recursive sweeps; proposes a diff before overwriting an existing non-trivial CLAUDE.md.
argument-hint: "<target-dir> [--recursive]  (target defaults to repo root)"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# /gen-claude-md — write a per-folder CLAUDE.md from the actual code

Read `~/.claude/workflow-conventions.md` first and follow it. This produces **load-bearing context for future agents** — every line must be true of the code as written, derived from source you actually read, never guessed from filenames. Be terse and decisive.

## Start check (soft — convention 4)
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` (minus flags) if given, else `$root`. Resolve absolute.
- Read `$root/CLAUDE.md` if present — so the per-folder file **complements** it and never duplicates it. Note repo language/toolchain (lockfile / root CLAUDE.md); stay language-agnostic.
- Target must exist and contain code. If empty/pure-config with nothing non-obvious to say: report that a CLAUDE.md adds no value here and stop — don't write filler.
- **Placement/depth test (conventions §6 "CLAUDE.md placement & depth").** Before writing, confirm the target earns it: it says something non-obvious that no ancestor CLAUDE.md already says, **and** it sits at the shallowest unit boundary (not a leaf whose content belongs in the parent unit's file). Fails either → push the content up into the nearest unit's file instead of writing a new deep one. If a sibling `AGENTS.md` duplicates this dir's `CLAUDE.md`, merge it in and delete it.

## Mode: single dir (no `--recursive`)

### 1. Read the directory's source (ground truth)
- `Glob` every source/config file directly in the target (and shallow subdirs that aren't their own documented unit). Exclude vendored/build/lock dirs. `Read` them — all of them; batch if large.
- Trace real exports, entry points, data flow in/out, cross-module imports, DB/external touchpoints. Note non-obvious behavior, ordering constraints, registries/strategies/presets, and real pitfalls (things a fresh agent would get wrong).

### 2. Draft the CLAUDE.md (concise, complementary)
Target shape — only sections that carry weight:
```
# <Dir purpose in one line>
<2–4 lines: what this folder is responsible for, where it sits in the system.>

## Key files
- `name.ext` — one-line purpose (the real export / entry point)
- ...

## Conventions / non-obvious behavior
- <a rule the code follows that isn't self-evident; a registry to register in; an ordering trap>

## Pitfalls
- <a real "don't do this" grounded in the code>
```
Rules: no duplication of root CLAUDE.md; no explaining standard language/runtime patterns; no narrating obvious code. Every claim cites code you read. Omit any section with nothing true and useful to say.

### 3. Write or propose
- **No existing CLAUDE.md, or it's trivial/stale-stub:** write it directly with the Write tool (pure new docs, low risk).
- **Existing non-trivial CLAUDE.md:** do NOT overwrite. Present a precise before→after diff (or full proposed replacement vs current), tied to the source facts that justify each change, and **stop for approval**. Apply only on explicit yes. (Same load-bearing caution as `/review-claude-md`.)

## Mode: recursive (`--recursive`) — plan-first (convention 1)

### R1. Plan the sweep before writing anything
- Enumerate the dirs under the target that each warrant their own CLAUDE.md (a coherent unit: own exports/responsibility — not every leaf folder). `Glob` the tree; decide units by reading enough to judge, not by name. Apply the placement/depth test above to **each** candidate: prefer ≤ 2 CLAUDE.md levels on any path, and exclude dirs that fail the earn-its-place test (their content folds into the nearest unit's file) — every extra deep file taxes every read in its subtree.
- Write `docs/plans/<slug>.md` (slug e.g. `gen-claude-md-<area>`) per the Plan Artifact convention: Goal, Scope (in/out — which dirs, which excluded and why), and an ordered **Manifest** with one checkable part per directory (`P<n>. <dir> — write/update its CLAUDE.md`). Status: `planning` → confirm scope with the user → `in-progress`.

### R2. Execute part-by-part
- For each manifest part, run the single-dir flow (steps 1–3) on that dir. Write-direct vs propose-diff rule applies **per dir** (existing non-trivial files still get a diff + approval; new ones write directly).
- Check the box the instant a part is truly done; keep `Status` current. If a dir turns out not to need a file or differs from plan, leave it unchecked and append a **Deviations** entry (convention 2) — never silently skip.
- Batch approval: you may collect proposed diffs and present them grouped at natural checkpoints rather than one prompt per dir — but never apply an overwrite without an explicit yes.

### R3. Close the sweep
- All parts checked → set plan `Status: done`. Summarize: dirs written, dirs proposed-pending-approval, dirs skipped (+ why, from Deviations).

## End — next step (convention 4)
- Single dir written/approved → print: `Next: /review-claude-md <target>` (verify the generated file against source).
- Recursive → print: `/review-claude-md <first-manifest-dir>` and note the plan at `docs/plans/<slug>.md` tracks remaining dirs.
- Any diff still awaiting approval → say so explicitly; nothing was written for those.

## Hard rules
- Every line traceable to code you actually read — no filename guessing, no hallucinated capability.
- Language-agnostic; no hard-coded repo paths or `.ts`-only assumptions.
- Never overwrite an existing non-trivial CLAUDE.md without an explicit approved diff.
- Recursive runs are plan-first and part-by-part — never one-shot a subtree.
- Don't write a CLAUDE.md that just restates the root or standard patterns; no file beats a filler file.
