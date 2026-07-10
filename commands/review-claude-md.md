---
description: Fact-root a directory's CLAUDE.md against actual source — verify every claim, judge accuracy/completeness/conciseness/AI-usefulness, emit PASS|NEEDS FIXES|REWRITE. Proposes diffs for review; never silently rewrites load-bearing context.
argument-hint: "[target-dir]  (defaults to repo root)"
allowed-tools: Bash, Read, Grep, Glob
---

# /review-claude-md — verify a CLAUDE.md against ground truth

Read `~/.claude/workflow-conventions.md` first and follow it. A CLAUDE.md is **load-bearing context for every future agent in that directory** — a wrong line is worse than a missing one. So: verify every claim against source, and **propose edits for approval rather than silently writing them**. Be terse and decisive; don't invent issues to look thorough.

## Start check (soft — convention 4)
- `root="$(git rev-parse --show-toplevel)"`. Target = `$ARGUMENTS` if given, else `$root`. Resolve to an absolute path.
- The target must contain a `CLAUDE.md`. If not: say so, name the command that creates one (`/gen-claude-md <dir>`), offer to run it — do **not** hard-block (the user may have meant a different dir).
- If a `docs/plans/*.md` documentation plan exists and scopes this dir, read it for *intended* scope (convention 1 — the plan is the source of truth for intent). Optional, not required.

## 1. Load context
- Read `$root/CLAUDE.md` (project overview + architecture rules) so you can flag duplication and know the house conventions.
- Read `$ARGUMENTS/CLAUDE.md` — the file under review.
- Note language/toolchain from the repo (lockfile, root CLAUDE.md) — stay **language-agnostic**; do not assume TypeScript.

## 2. Read the actual source (ground truth, no guessing)
- `Glob` every source file in the target dir and its subdirs — all code/config extensions present, not one language. Exclude vendored/build/lock dirs (`node_modules`, `dist`, `build`, `.venv`, `target`, `vendor`).
- `Read` them. For large dirs (20+ files) read in batches; do not skip — claims are verified against code you actually read, never filenames.
- For cross-module references the file makes (imports from shared/other dirs, DB tables, external services): `Grep`/`Read` to spot-check the *specific* claim. You needn't read whole external modules — just confirm the asserted fact.

## 3. Judge against the criteria
**Accuracy** — every file/dir/symbol named exists; described behavior matches real logic; imports/deps/DB references correct; no hallucinated capabilities.
**Completeness** — all subdirs accounted for; key patterns/conventions documented; non-obvious behavior a fresh agent would get wrong is explained; entry points + data flow clear; non-standard error handling noted.
**Conciseness** — no filler; not duplicating root CLAUDE.md; not explaining standard language/runtime patterns; not narrating trivially obvious code.
**AI-usefulness** — would a fresh agent make *better* decisions with this file? Are the "don't" warnings real pitfalls? Are cross-module relationships clear without over-explaining?

## 4. Output the review
```
## Review: <target>/CLAUDE.md
### Verdict: PASS | NEEDS FIXES | REWRITE
### Issues
1. [ACCURACY|COMPLETENESS|CONCISENESS|AI-USEFULNESS] — what's wrong
   - section/line · says X · code actually does Y (cite the file) · fix
### Missing
- claims it should make but doesn't (with the source fact that warrants it)
### Cut
- redundant / obvious / wrong lines to remove
### Summary
1–2 sentences: overall quality + the core change needed.
```
- **PASS** → say so, stop. Don't manufacture nits.
- **REWRITE** (mostly wrong / structurally unsalvageable) → say why; recommend `/gen-claude-md <target>` to regenerate from source rather than patching lies.
- **NEEDS FIXES** → proceed to step 5.

## 5. Propose diffs — do NOT auto-write (load-bearing caution)
This file steers future agents; an unreviewed "fix" can mislead silently. So **present the exact edits and stop for approval**:
- For each fix, show a precise before→after block (old text → new text) tied to the source fact that justifies it.
- Ask the user to approve all / pick a subset / adjust. **Only after explicit approval** apply with the editing tool (a follow-up invocation, or hand to the user).
- Never edit `CLAUDE.md` in this command's flow without that yes. Accuracy of context outranks throughput.

## End — next step (convention 4)
- PASS → print: `CLAUDE.md verified. Next: /review-claude-md <sibling-or-parent-dir>` (or, if part of a doc plan, the next unchecked manifest dir).
- NEEDS FIXES → after approval+apply, suggest re-running `/review-claude-md <target>` to confirm green, or moving to the next dir in the plan.
- REWRITE → print: `/gen-claude-md <target>` then `/review-claude-md <target>`.

## Hard rules
- Verify against source you actually read — never from filenames or memory.
- Language-agnostic: no `.ts`-only assumptions, no hard-coded repo paths.
- Never silently write to a CLAUDE.md — propose, get explicit approval, then apply.
- If the user says a finding is wrong, re-investigate the code before defending it.
