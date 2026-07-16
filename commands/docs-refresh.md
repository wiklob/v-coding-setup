---
description: Daily docs-maintenance loop — review the day's merged changes and land ALL warranted doc updates (freshness headers, changelog, drift fixes, CLAUDE.md refreshes, postponed) in ONE consolidated daily PR, instead of scattered two-line doc edits in every build. Replaces per-commit doc work under cfg.docs.maintenance:"daily". Runs unattended via a launchd LaunchAgent; also runnable by hand.
argument-hint: "[--yes] [--dry-run] [--since <git-ref-or-date>]  (no args = interactive over the day's merged changes)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Skill
---

# /docs-refresh — docs maintenance as one daily applied pass

The **single daily owner** of doc maintenance. Instead of every build making its own two-line doc edits (a freshness header here, a changelog line there, a drift fix in an unrelated PR), this ritual reviews **the whole day's merged changes at once** and lands **one consolidated `docs: daily maintenance <date>` PR** carrying every warranted doc update. Wins: fewer tokens (doc work isn't repeated per-build) and cleaner history (one doc commit/day, not doc lines smeared across every feature PR).

It runs on demand and via a daily local **launchd LaunchAgent** (`claude -p "/docs-refresh --yes"`, installed by `bin/install-docs-refresh-launchd.sh`, 09:47). It must run **locally** — it reads the machine's git history + working tree.

**This is the producer that replaces the per-land doc work** when `cfg.docs.maintenance` is `"daily"`: `/land-ticket`'s per-PR changelog fragment + freshness bump (§6.5), its docs-stale gate (§4.7), and the §6.8 deliverable assertion all no-op under `"daily"` and defer here (default `"per-land"` keeps the old per-land behavior — see convention 6).

Read `~/.claude/workflow-conventions.md` first (esp. §6 the documentation lifecycle, + conventions 4 + 8). (**Under `/go`** it is already in context — skip the re-read; a standalone run reads it here.)

**Why it APPLIES the edits itself (not propose, not auto-run the interactive doc commands).** The daily PR *is* the human review checkpoint — one review point that replaces the per-tool STOP gates. `/audit-docs` is read-only and safe to run headless. But `/sweep` and `/gen-claude-md` carry **interactive human-approval STOP gates** that cannot run under an unattended `--yes` pass — so this ritual **never invokes them as commands under `--yes`**; it applies the doc edits itself (composing `/audit-docs`'s read-only findings + `/gen-claude-md`'s generation *approach* inline + the freshness/changelog logic lifted from `/land-ticket` §6.5), and the single daily PR carries them for the human's one review.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; `MAIN_WT="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"` (the main checkout — the canonical history to review). Read `$root/.claude/ticket-flow.json`; parse the `docs` block: `systemDocs[]` (`doc` + `covers`), `changelog`, `postponed`, and `maintenance` (`"daily"` | `"per-land"`). **Each doc class is skipped when its config is absent** (no `systemDocs` → no freshness class; no `changelog` → no changelog class; etc.) — the pass degrades per-class, never errors.
- If `cfg.docs` is absent entirely, the pass still runs the config-free classes (drift via `/audit-docs`, CLAUDE.md refresh) — it is useful even before `docs` is configured.

## 0. Parse flags
- `--yes` — headless/cron mode: apply the edits, open the daily PR, advance the watermark, no confirm gate. What the launchd agent passes.
- `--dry-run` — print the batched doc-update plan + the PR it *would* open; write nothing, open no PR, advance no watermark. For inspecting a pass by hand.
- `--since <git-ref-or-date>` — override the review window's start (else the watermark; else default below). A date is resolved to a SHA in §1 — the window is always a rev range.
- Interactive (no `--yes`, no `--dry-run`) — apply + open the PR, but print the plan and pause for a go first, rendered per convention 11 (`needs input: open the daily docs PR with the plan above — reply to proceed, or redirect`), never an `AskUserQuestion` modal.

## 1. Resolve the review window (the day's merged changes)
- **Fetch first** (the launchd checkout can be stale): `git -C "$MAIN_WT" fetch origin <baseBranch>`.
- **Pin the window end ONCE:** `END_SHA="$(git -C "$MAIN_WT" rev-parse origin/<baseBranch>)"`. Every later use — the log range, the daily branch's base, and the watermark advance — uses `$END_SHA`, **never a re-resolved `origin/<baseBranch>`**: a PR merged between two resolutions would be reviewed against the old state but watermarked past by the new SHA — skipped forever.
- **Resolve the start ref**, most-authoritative first: `--since` value — a SHA/ref used as-is; a **date** resolved to a SHA first (`git rev-list -1 --before=<date> origin/<baseBranch>`; unresolvable → error out, don't guess); else the watermark `pipeline/audit/.docs-refresh-watermark` (last-reviewed commit SHA — a per-machine gitignored dotfile, like `.harvest-watermark`); else (first run / absent) default to `origin/<baseBranch>@{1.day.ago}` (`git rev-parse` it; fall back to `origin/<baseBranch>~20` if the reflog can't resolve a day).
- **The window** = `<start>..$END_SHA`. Capture:
  - Touched paths: `git -C "$MAIN_WT" log <start>..$END_SHA --name-only --pretty=format:` → sorted-unique file list.
  - Merged PRs in the window: `gh pr list --repo <repo> --state merged --search "merged:>=<start-date> base:<baseBranch>" --json number,title,url,mergedAt,body`, kept only where `mergedAt` falls inside the window (for changelog + postponed).
  - Empty window (nothing merged since the watermark) → report "docs healthy — nothing merged since `<watermark>`", advance nothing, STOP.
- **Prior daily PR guard:** `gh pr list --repo <repo> --state open --search "head:docs/daily"` — an **open** previous daily PR (unmerged yesterday, or a same-day partial re-run) → do **not** open a second one that would edit the same headers/changelog and guarantee a conflict. STOP and surface it (`yesterday's daily PR <url> is still open — merge or close it, then re-run`); a same-day leftover branch with no open PR → delete the branch and proceed fresh.

## 2. Compute the doc-update set (per class — skip any whose config is absent)
Build the plan class-by-class; each item records the file + the concrete edit.
- **Freshness** (needs `cfg.docs.systemDocs`): for each `systemDocs[]` whose any `covers` prefix matches a touched path **and** whose `doc` is not itself in the touched set, bump line 1 to `> Last verified against code: <today YYYY-MM-DD> (daily <date>)`. (This is the §6.5 freshness logic, moved here and batched.)
- **Changelog** (needs `cfg.docs.changelog`): fold any `<changelog-dir>/changelog.d/*.md` fragments into the changelog's `## Recent`, AND generate an entry per merged PR in the window not already represented: `- <PR title> ([#N](<url>)) — <ticket>`. Delete the folded fragments. (The per-PR fragment write itself is gone from `/land-ticket` under `"daily"`; the daily pass generates entries directly from merged-PR metadata, so there is no concurrent-write conflict to avoid.)
- **Drift** (always — config-free): invoke **`/audit-docs`** (read-only; via the `Skill` tool) over the repo, read its `[drift]` findings (a doc claim the code now contradicts), and **apply the fix** to each genuinely-stale claim. Skip `[bloat-*]`/`[coverage]`/`[placement]` here (those need human judgment — surface them in the PR body as notes, don't auto-edit). **Then remove `/audit-docs`'s transient findings doc** (`docs/plans/<date>-doc-audit.md` — a tracked path): its findings are consumed into this pass, so delete it (`rm`, plus `git rm --cached` if it got staged) — a daily run must not accumulate findings docs in `docs/plans/` or leak one into the daily PR.
- **CLAUDE.md refresh** (always — config-free): for each folder-unit with material change in the window, apply **`/gen-claude-md`'s generation approach inline** — read the changed source, re-derive the folder's CLAUDE.md to the three-bucket convention-6 shape, and write it. **Do NOT invoke the interactive `/sweep` or `/gen-claude-md` commands under `--yes`** (their overwrite-approval STOP gates can't run headless — the daily PR is the review that replaces them). Be conservative: refresh a folder's CLAUDE.md only on material change, not every touched file.
- **Postponed** (needs `cfg.docs.postponed`): parse `Deferred: <what> — <why>` markers from the window's merged-PR bodies; append them under `## <today> — daily maintenance` in `cfg.docs.postponed`.

## 3. Apply + open ONE daily PR (gated by mode)
- **`--dry-run`:** print the full plan (per-class, each file + edit) + the `docs: daily maintenance <date>` PR it *would* open. Write nothing, open no PR, advance no watermark. `result: /docs-refresh --dry-run — <K> doc updates across <C> classes would land in one PR; watermark unchanged.`
- **Interactive (default):** print the plan, pause for a go, then proceed as `--yes` below.
- **`--yes` (daily cron / headless) — apply + PR, never merge:**
  - Create the branch off the **pinned window end** (no re-fetch, no re-resolve — §1's `$END_SHA` is the base): work in a scratch worktree or the main checkout's branch `docs/daily-<date>` cut from `$END_SHA`.
  - Apply every §2 edit. `git add` the touched docs; `git commit -m "docs: daily maintenance <date>"`; `git push -u origin docs/daily-<date>`.
  - `gh pr create --repo <repo> --base <baseBranch> --title "docs: daily maintenance <date>" --body <summary>` — the body lists the per-class updates + the non-auto-applied `[bloat]`/`[coverage]` notes for the human. **Never `gh pr merge`** — the human's merge of this one daily PR is the review checkpoint (the user's explicit choice).
  - **Advance the watermark** only on a real (non-dry-run) pass, via the fs-write helper: `node ~/.claude/bin/advance-docs-refresh-watermark.mjs --commit $END_SHA --repo-root "$root"` (the §1-pinned window end — never a freshly re-resolved `origin/<baseBranch>`, which could have moved and would skip the in-between merges forever; never a `Write`/`>` — that trips the sensitive-file prompt and freezes the unattended cron; mirrors `advance-feedback-watermark.mjs`). **`--repo-root "$root"` targets THIS checkout's own watermark** (`<root>/pipeline/audit/.docs-refresh-watermark`) — required now that one machine-global runner sweeps several repos (V-375): each repo's watermark bounds only its own review window, so a shared file would let one repo's SHA skip or re-review another's merged work. Omitting `--repo-root` falls back to the helper's own checkout, which is only correct when `/docs-refresh` runs inside the pipeline repo itself; always pass `$root` so a swept product repo advances its own watermark.
  - **Read back** (convention 8): assert `gh pr view <N> --json url,state` returns the real PR before reporting it filed; never fabricate the PR number/URL.

## 4. Report + next step (convention 4)
- Print the PR URL + per-class update counts (or the dry-run plan).
- **Name the next step:** the human **reviews + merges the one daily PR** (the single review point). Empty window → "docs healthy — no PR opened".
- Emit `result:` on its own line: `result: /docs-refresh — <K> doc updates (<per-class breakdown>) in PR <url>; watermark → <sha>.` (or the `--dry-run` line).

## Hard rules
- **Never auto-merge the daily PR.** The human's merge is the one review checkpoint (the whole point of the daily-PR model over a direct-to-main bot commit).
- **Never invoke `/sweep` or `/gen-claude-md` as interactive commands under `--yes`.** Their STOP gates can't run headless; apply the doc edits inline and let the daily PR be the review. `/audit-docs` (read-only) is safe to invoke headless.
- **Applies edits itself, per class, skipping any class whose config is absent** — degrades, never errors.
- **Local-only** — reads the machine's git history + tree; runs via the local launchd agent, never a cloud `/schedule`.
- **Watermark advances only on a real (non-dry-run) pass**, via the fs-write helper (never `Write`/`>`).
- Read back the created PR (convention 8); never fabricate the PR number/URL. One pass per invocation. Convention 4: name the next step.
