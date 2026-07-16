# Profile: Routed / proxied non-Anthropic models (e.g. gpt-5.6-sol, gpt-5.6-terra)

Source basis: this pipeline's own 2026-07-14 findings on routing Claude Code through `claude-model-router`/CLIProxy to non-Anthropic backends (V-387, V-388, V-389, V-390) + the prior-art on proxied prompt-caching loss. Posture: **context economy is the governing constraint.** These models are reached over a proxy with two properties the rest of the pipeline never assumed: a **context window well below the Opus-1M the commands implicitly budget for**, and **little or no working Anthropic prompt caching** (breakpoints are stripped in format translation, or the upstream caches but reports it under a field we don't read — V-389). So every token re-sent into the main frame both risks a hard `400 'input exceeds the context window'` *and* is likely re-billed. This profile removes the fan-out/whole-read reflexes the Opus profile prescribes and replaces them with strict context economy. It changes **posture only** — every model-independent core rule (README §"may NOT touch") still holds.

Until a routed model's real window and caching are characterised (V-389), treat the window as small and uncached.

## Hard enforcement (this file advises; these bind)

2026-07-15 proved .md guardrails are non-binding: a routed model read "cap fan-out hard" and spawned a depth-5, 1,290-agent review cascade anyway. The binding layer now is:

- **`bin/guard-agent-spawn.py`** (PreToolUse) — spawn depth capped at 2, per-session subagent budget 60, observer blocklist. See `docs/spawn-guard.md`.
- **`bin/spawn-observer.py`** (launchd watchdog) — blocklists runaway sessions, parks jobs blocked on provider limits.
- **`claude-model-router` `guard`** — per-upstream concurrency + daily completion budget + 429 circuit breaker; breaches answer non-retryable 403.

When one of these denies you: that is the system working. Finish inline, return a compact result, report to the human. Do not retry, re-spawn, or route around it.

## Launching (context window + compaction)

The harness cannot be told a custom model id's real window (gateway model discovery reads only `id`/`display_name`), assumes ~200k, and auto-compact is unreliable there — the 2026-07-15 main frame reached 371k/200k (186%), past the point where `/compact` itself can still run (V-387). Through a translating proxy there is also no working prompt caching, so a huge frame is re-billed **every turn** — even where the upstream window genuinely is 1M, riding it on a metered account is the expensive choice, not the safe one. **Launch routed sessions through `bin/claude-routed.sh`** (or set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000` yourself): compaction fires early, well before the unrecoverable zone. V-383 ("sol 1m") retargets accordingly: client-side window-up is not implementable today; early compact-down is.

## Delegate down, not out

The routed flagship is for the main frame's judgment. Everything mechanical goes to a SMALLER model, not a same-size clone: pass `model: "haiku"` (or `"sonnet"`) on `Agent` calls for Explore/scan/extract/verify-one-fact work, and reserve the routed model itself for synthesis and decisions. A finder does not need the most expensive model on the machine to grep a diff — yesterday's cascade billed ~40 flagship turns per agent for work a haiku leaf does in five.

## Knobs

- **`design-check`** — self-check by default. When the plan lacks a `## Thesis-check` block, red-team the design yourself against the 7-item bar (`thesis-check.md` §1) and append the block with `Verdict: sound (self-checked)`. Fire the full `/thesis-check` subagent **only** for net-new architecture (no in-repo pattern, a new dependency/service/protocol) or when the human/ticket asks — a fresh-context subagent's report re-enters this frame, and on a tight window that round-trip is a cost, not a free rail.
- **`scope-plan-depth`** — minimal. Write only the always-required contract (header, `## Goal`, `## Pre-build validation`, `## Deviations`); add `## Implementation design` only when `design-check` routes it to the subagent or the change is cross-cutting/migration-bearing. A verbose plan is re-read into a small window every resume — keep it lean.
- **`research-depth`** — small by default; **cap fan-out hard**. Prefer serial, targeted investigation. When you must dispatch subagents, cap concurrency low and require each to return a **compact digest** (the finding with `file:line`, never a file dump or a transcript). Never let a research/Explore agent's full result land in this frame.
- **`re-grounding`** — trust planning-time findings. Re-verify only on a staleness signal (code moved under the plan, or observation contradicts the finding). Do not re-read ritually — re-reads are the most avoidable context cost here.
- **`read-discipline`** — **strictest.** `Read` is the #1 window/cost lever on a small context. Never pull a whole file when you know the section — always `offset`/`limit`; route bulk or exploratory reads through a subagent digest so the *finding* returns, not the file. Re-read only the changed lines, never the whole file to re-confirm one part. The `bin/nudge-read-discipline.mjs` hook still fires; heed it harder here.
- **`autonomy`** —
  - When you have enough to act, act; don't re-derive settled facts or overplan. Minimal narration.
  - **Budget the context against *this model's* real window, not Opus-1M.** Proactively compact/summarise *before* the window fills — `/compact` itself needs the full window and cannot rescue an already-overflowed session (V-387), so never let it get there.
  - **Never `Read` or `TaskOutput` a `local_agent` `.output` file** — it is the full subagent JSONL transcript and will overflow the window. Use the agent's returned summary only.
  - **Avoid high-effort/`max` `/code-review` (the 8-finder fan-out) on this model** — its blocking read-back of full finder transcripts reliably 400s a small window (V-388). Use `low`/`medium` effort, or run the review on a 1M-context model. The same caution applies to any skill that fans out many verbose subagents at once.
  - Audit every status claim against a tool result from this session; state boundaries you're honoring; don't take unrequested actions.
- **`review`** — fresh-context verifier subagents (core rule), but they **must return compact findings only** — confidence + severity + `file:line`, never full transcripts or re-quoted diffs. Prefer fewer, tighter reviewers over a wide fan-out; a small window cannot absorb many verbose review returns at once.

## Reading the commands under this profile

Where a command prescribes fan-out ("dispatch a parallel agent per plan-point", "spawn N reviewers"), read it through this profile's cap-and-digest lens: the *outputs* the command wants are the contract, but on a routed model you reach them with the smallest fan-out that works and compact returns — never the full-parallel, full-transcript shape the Opus profile assumes. When a command says "read the file", read the section. When it would surface a subagent's raw output, surface its summary. The procedure is unchanged; only the context footprint is tightened.
