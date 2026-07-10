---
description: Structured code review of one PR — acceptance vs diff, migrations, correctness, boundaries, security. Print-only by default; explicit gate before posting to Linear.
argument-hint: "[PR# | <branch>]  (defaults to PR for current branch)  [--comment to also post to the linked Linear ticket]"
allowed-tools: Bash, Read, Grep, Glob, mcp__linear
---

# /review-pr — retroactive PR review

**Fresh-context rule (the locus decision).** A reviewer that built the work inherits the builder's assumptions and blind spots — fresh-context verifiers outperform self-critique on every current model (Anthropic, Fable 5 prompting guide; obs-2 in `plans/adaptive-pipeline-overhaul.md`). So before reviewing, check the locus:
- **This session edited or committed to the branch under review** (you built what you're about to review) → do **not** review inline. Spawn an `Agent` subagent (`subagent_type: general-purpose`) with the same prompt template `/land-ticket` §4.5 uses ("Execute `~/.claude/commands/review-pr.md` literally on PR `<n>` … print-only, structured sections only, every finding cites real `file:line`"), **tiering the model by PR size as §4.5 does** — `model: "haiku"` for a medium PR, Opus (the default) only for a sensitive or large one (§4.5 Tier C: the sensitive path list, `>200` changed lines, or `>10` files). The parent prints the returned review verbatim and owns the §3 output gate (`--comment`).
- **Already a fresh context** (a review subagent dispatched from `/land-ticket` or the rule above, or a session that never touched the branch) → run inline per the sections below. Never nest a second spawn.

Read `~/.claude/workflow-conventions.md` first, then `~/.claude/craft/README.md` — the craft register (the judgment substrate; see conventions §10) — and, for the review judgment itself, `~/.claude/craft/judgment.md`, whose `## Constraints` + `## Anti-Patterns` are the rail §2 critiques each finding against. Bring its stance to this review: name the default instinct you're about to follow (rubber-stamp it, or nitpick for its own sake) and decide whether to resist it; weigh each finding against named constraints before you write it; and when something feels off, say *why* diagnostically rather than reaching for a checklist. This skill **reviews only — never edits, merges, or changes state**. Be fact-rooted: every finding cites `file:line` against code you actually read. No padding, no speculative findings, no theatre.

## Load config + resolve target
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (used for the Linear lookup; `scopeLabel`, `baseBranch`).
- Resolve PR:
  - `$ARGUMENTS` starts with `#` or is a number → PR number.
  - `$ARGUMENTS` is a branch name → `gh pr list --head <branch> --json number -q '.[0].number'`.
  - Else (no arg) → `gh pr view --json number -q .number` from cwd's current branch.
  - None found → STOP, suggest `/land-ticket` (which publishes if needed).
- Strip a leading flag (`--comment`) before parsing the PR target.
- Fetch:
  - `gh pr view <n> --json number,title,body,headRefName,baseRefName,author,additions,deletions,mergeable,mergeStateStatus,state,statusCheckRollup,files`
  - `gh pr diff <n> --patch`  (full unified diff)
  - `gh pr diff <n> --name-only`  (file list)
- Linked Linear ticket: parse `Closes <ID>` / `Part of <ID>` (case-insensitive, word-boundary) from PR body. If matched → `mcp__linear get_issue <ID>`; record its `## Acceptance` checklist.

## 1. Read enough of the touched code (ground truth)
- **The diff is the primary artifact.** `gh pr diff <n> --patch` (fetched above) is what you review; read source to *understand* the diff, not instead of it.
- **Default: scoped reads, not whole files.** For each non-trivial changed file, read the code *around* each hunk — the enclosing function / class / section (use `Read` with `offset`/`limit`, or `Grep` to locate the enclosing scope) — enough to see the surrounding behavior the raw hunk hides, **not** the entire file. Reading every changed file in full is the dominant cost of a review subagent: because a subagent re-reads its accumulated context at cache-read price every turn, a handful of whole-file reads compounds fast (observed — one Tier-C review read 15 whole files → ~2.85M cache-read for 9.5K of output). A scoped window gives the same "surrounding behavior" at a fraction of the context.
- **Read a file in FULL only when judgment needs it** — a small file (a window ≈ the file anyway), or a change whose correctness depends on file-global state (control-flow rework, changed exports / contract / types, an invariant established elsewhere in the file). Name which files you read in full, in the Coverage line.
- Read the relevant tests too (scoped the same way). Skip lockfiles, generated/build output, vendored dirs.
- Read repo `CLAUDE.md` + `.claude/rules/*.md` once — they ARE the convention contract; violations of them are findings.
- If total changed lines roughly exceeds ~1500 or the diff spans >25 non-trivial files: read the highest-risk files (migrations, schema/contracts, security-sensitive paths, large new files) and **say which files you skipped**. Don't pretend to have reviewed it all.

## 2. Produce the review

The section list below is the **shape** of the output, not a quota — a finding earns its place only when it cites an observation you actually made (`craft/judgment.md` rail), never to fill an empty section; **omit any section that has genuinely nothing to say** — silence is better than padding.

Print each kept section in this order.

### Summary
1-3 sentences: what the PR does, scope (files / lines), blast radius. State whether you read the diff fully or partially (with the skipped-files list if partial).

### Acceptance vs diff *(only if a Linear ticket is linked)*
For each item in the issue's `## Acceptance` checklist: **MET / PARTIAL / UNMET / VACUOUS** — with the `file:line` proof (or "not in diff"). Flag VACUOUS items explicitly (e.g. "`npx tsc --noEmit` passes" when the changed paths are outside `tsconfig.include`).

### Migration & schema safety *(only if `supabase/migrations/*` or schema files changed)*
Apply `/land-ticket` §4 checks: view/rule dependencies before `ALTER TYPE` / `ALTER COLUMN TYPE` / `DROP TYPE`; the add-enum-value-then-use-in-same-transaction trap; cross-PR ordering; the corresponding update to `src/shared/database/types.ts`, `src/shared/validation/`, and Edge Functions per `.claude/rules/validation-schemas.md`. Each finding cites the file + the rule it implicates.

### Correctness
Real logic issues only: missing edge cases, wrong condition, off-by-one, error paths that swallow vs propagate, behavior changes that diverge from the stated goal, concurrency/ordering bugs. Each: `[sev] file:line — <issue> → <one-line fix>`.

### Boundary / convention violations
Cross-stage TS imports (`.claude/rules/database-boundaries.md`), strategy registry bypass (`strategy-registry.md`), repository conventions (`repository-patterns.md`), migration-safety violations (`migration-safety.md`), validation-schema ripple (`validation-schemas.md`), or any repo-specific rule. Each finding names the rule it violates.

### Security
OWASP-top-10 hits **actually present in this diff**: SQL/command injection, XSS, auth bypass, secret committed to code/logs/error messages, unsafe deserialization, path traversal, SSRF, broken access control. No security theatre — if the diff is benign, omit the section.

### Style & clarity *(only material items, terse)*
Dead code, misleading names, comments that lie, copy-paste, premature abstractions. Group `nit`-level at the bottom or skip entirely.

### Severities
`critical` blocks merge · `high` should-fix-before-merge · `med` follow-up acceptable · `low` / `nit` optional.

### Coverage
End with one line: what you DIDN'T cover, and (per §1) which files you read in **full** vs. scoped to hunks (e.g. "read `migration.sql` + `auth/guard.ts` in full; rest scoped to hunks; did not run code; did not run tests; relied on `statusCheckRollup`: type-check=SUCCESS, lint(non-blocking)=FAILURE").

## 3. Output gate
- **Always print the review to the user first.** Never auto-post.
- If `--comment` was passed: after printing, ask "post this as a Linear comment on <ID>?" — only on explicit yes, `mcp__linear save_comment` with the review body and `issue = <ID>` (the schema field is `issue`, not `issueId` — passing `issueId` throws `MCP error -32602 … path:["issue"] … Required` and the comment never posts; V-240). Markdown headings render directly; do not escape newlines.
- If `--comment` was passed but no Linear ticket is linked: warn that the flag is a no-op for this PR and continue print-only.

## Hard rules
- **Review-only.** No `Edit`/`Write`/merge/Linear-state-change. Do not propose code edits as patches — describe the fix in prose. (The skill's `allowed-tools` already forbids edits; the rule is here so the *content* of the review also stays advisory.)
- Every finding must cite a real `file:line` against code you read. No speculative findings, no "consider whether…" filler.
- Don't run the code, don't run tests — note their status from `statusCheckRollup` only.
- Don't conflate convention violations with personal preference — cite the specific rule file.
- Be terse. Severities pull weight. Absence of a section is fine; padding is not.
