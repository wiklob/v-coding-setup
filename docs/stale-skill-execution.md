# Stale skill execution — diagnosis + mitigation

> Investigation/decision doc for V-99. Status: adopted (PR for V-99).

## The failure mode

A long-running, resumed, or parallel session keeps executing the slash-command text it was **launched with**, even after the on-disk `commands/*.md` has been fixed — so it re-introduces patterns the repo already banned. Observed (V-99 evidence, 2026-06-03):

- A session ran a **pre-V-75** `/go` §6 — its injected text still said "append via Edit/Write or a single append" + `mkdir -p pipeline/audit`, so it used the banned heredoc even though V-75 had already shipped `log-gate-audit.mjs` + the ban.
- `cd ~/<repo>` (slug-derived) and bare `git pull --ff-only` surfaced despite V-74 and `land-ticket.md §8` already encoding the fixes — the bad commands came from stale/improvised text, not current source.

## Root cause (probed, confirmed)

Custom slash-command / skill bodies are injected into the conversation **once, at invocation time, and are never re-read from disk during the session.** (Confirmed against Claude Code docs: skills load on demand and the context holds the body until the session ends; `bin/capture-session.mjs`'s header independently notes `CLAUDE_CODE_SESSION_ID` is "frozen at process start.") The injected text is a snapshot.

`/go` runs are long, and several standalone `/go` worktrees run **concurrently**. While one run executes, a sibling can land a PR that fixes the very command file the first run is mid-executing. The first run keeps running its frozen pre-fix text. The divergence is invisible — nothing in the session signals that its instructions are now out of date.

## Why the per-fix approach (V-74/V-75) didn't prevent it

This is the crux — the same two fixes landed by **opposite mechanisms**, and only one survived contact with a stale session:

- **V-74 fixed its banned `cd` at the _hook_ level** — `75faa2a feat(guard): probe rejects hardcoded cd into nonexistent repo paths`. A `PreToolUse` guard runs from `settings.json` **on disk**, on every Bash call, regardless of what prose the session carries. So V-74's guard **does** bite a stale session — which is exactly why the evidence shows the stale `cd` was *caught* (surfaced as a hook event), not silently executed.
- **V-75 fixed its banned heredoc only in _prose_** — `2be7bbf fix(go): sanctioned gate-audit flush via log-gate-audit.mjs helper`. It removed the heredoc instruction from `go.md §6` and added the helper + allowlist + ban. **All of that lives on disk.** A session carrying the pre-V-75 injected `go.md` snapshot never sees it, and re-runs the banned heredoc.

**Generalization:** a content/prose fix to a command file *cannot reach an in-flight session* — it only changes what *future* invocations inject. The defect lives in the **refresh model**, orthogonal to any single command's content. The only repo mechanism that bites a session already carrying stale text is a **hook** (executed from `settings.json` on disk every session-start / prompt). Per-fix prose edits are necessary but structurally incapable of preventing stale execution.

## Mitigation: a hook-based staleness *detector*

`bin/check-skill-staleness.mjs` (+ `check-skill-staleness.test.mjs` probe). Detection, not prevention — a frozen session's text cannot be rewritten retroactively, but a hook **can** tell the model, in model-visible `additionalContext`, that its text is stale and to re-read from disk. Hook-based ⇒ immune to the stale prose by construction (the V-74 property, generalized from "one banned pattern" to "any drift").

- **`SessionStart` (`startup`/`clear`)** — record the baseline canonical `~/.claude` HEAD to `run/skill-baseline/<session_id>.json`. No warning.
- **`SessionStart` (`resume`/`compact`) + every `UserPromptSubmit`** — compare baseline vs current canonical HEAD; if it advanced **and** the diff touches `commands/` or `workflow-conventions.md` **and** we haven't already warned for this HEAD, emit a `⚠️ STALE-SKILL RISK` warning naming the changed files and instructing a disk re-read. Dedup on the current HEAD → one warning per new drift, not per turn.
- **Compares the canonical `~/.claude` checkout, not the worktree** — slash commands resolve from `~/.claude/commands/` regardless of cwd, and sibling fixes land into the canonical checkout's `main`.
- **Best-effort, always `exit 0`** — runs on every session start + prompt globally; mirrors `capture-session.mjs`'s never-disrupt contract.

`PreToolUse` is deliberately **not** used: it cannot emit model-visible `additionalContext` (only a permission decision + stderr-on-exit-2). The events that *can* inject context the model reads are `SessionStart`, `UserPromptSubmit`, and `PostToolUse`.

### Coverage and the one honest gap

`SessionStart(resume|compact)` covers the highest-risk case — a resumed or long compacted session (the exact V-99 scenario). `UserPromptSubmit` covers every interactive turn. **Gap:** a purely autonomous background `/go` run that never compacts receives no user prompts mid-run, so mid-run sibling-landed drift isn't surfaced until its next SessionStart/prompt. Closing it needs a **`PostToolUse`** wiring of the *same* helper (PostToolUse supports `additionalContext`); the existing HEAD-dedup keeps it silent until HEAD actually moves, so it is viable. It is **deferred** to avoid a per-tool-call `git rev-parse` tax across all sessions until the gap is shown to be costly — recorded here rather than silently dropped (conventions 8/9).

## Structural rule (the lesson)

> A banned-pattern fix that must bite **in-flight** sessions belongs in a **hook guard** (the V-74 model), not only in command prose (the V-75 anti-pattern).

Concrete follow-up candidate: give the V-75 heredoc/`mkdir -p pipeline/audit` append path its own `PreToolUse` guard rule, so a stale session that tries the banned heredoc is blocked the same way V-74's guard blocks the stale `cd`. Noted, not built here (on-ticket discipline, convention 9).

## Reproduce / verify

`node bin/check-skill-staleness.test.mjs` — proves the warn/no-warn/dedup truth table. End-to-end: write a `run/skill-baseline/<id>.json` with an old `baseHead`, pipe a `UserPromptSubmit` payload to the helper → `⚠️ STALE-SKILL RISK` is emitted naming the changed `commands/*`; pipe again → silent (dedup); a `SessionStart`/`startup` payload records a baseline and emits nothing.
