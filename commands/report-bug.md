---
description: Report a pipeline bug into the error log with near-zero friction — one free-text note, appended to pipeline/audit/errors.jsonl via the pipeline-error logger. The intentional front door to the manual backstop; no decisions forced.
argument-hint: "<what went wrong, free text>  (optionally prefix --tool <name> to tag a subsystem)"
allowed-tools: Bash
---

# /report-bug — file a pipeline bug into the error log

The manual capture front door. **Report without ceremony** (parity with `/capture`): you noticed the pipeline misbehaving — a command did the wrong thing, a gate misfired, a hand-off lost state — get it on the record in one line. No triage, no decisions. The read-side (`/harvest-pipeline-bugs`) routes it later.

This is the **intentional** capture layer. It writes through the existing pipeline-error logger in manual mode — same sink, same format, same redaction as the automatic hook and `/build`-style self-reports. No new logger, no new file.

## Steps
1. `$ARGUMENTS` is the bug note. If empty → ask "What went wrong?" and STOP. Otherwise the note is the only required input — never ask anything else.
2. If `$ARGUMENTS` begins with `--tool <name>`, lift `<name>` as an optional subsystem/tool hint and treat the rest as the note; otherwise the whole of `$ARGUMENTS` is the note and no tool hint is passed.
3. Append exactly one entry by invoking the pipeline-error logger in manual mode, by its **absolute main-checkout path** (so the entry always lands in the global `~/.claude/pipeline/audit/errors.jsonl`, regardless of the session's cwd — the same global log the hook writes):
   ```sh
   node ~/.claude/bin/log-pipeline-error.mjs --command report-bug --error "<note>"
   ```
   With a tool hint, add `--tool <name>`. Pass the note as the quoted `--error` value — never as a bare positional (the flag parser only reads `--command` / `--error` / `--tool` / `--session`).
   - `--command report-bug` tags the entry `activeCommand: "report-bug"` — the marker that distinguishes a human front-door report from hook-caught errors (real tool name, transcript-scanned `activeCommand`) and in-session self-reports (which name the command that erred).
   - **Trace handles are stamped automatically — pass no extra flag.** The logger resolves `session` (this run) and `conversation` (the resume-chain **root** — the *thread* the report was filed in, stable across follow-ups and compaction) itself. `/harvest-pipeline-bugs` cites these on the patch-ticket so a bug traces back to its conversation (via `/ingest-convo`). Only add `--session <id>` to override an already-resolved id.
4. Confirm in one line that the bug was logged. Done.

## Hard rules
- Writes exactly **one** JSONL entry per invocation, only through `~/.claude/bin/log-pipeline-error.mjs` (no second logger, no second sink).
- **Force zero decisions** beyond the note itself — never prompt for severity, category, or anything else (parity with `/capture`).
- Always use the absolute `~/.claude` path, not a worktree-relative `bin/…` — the log path follows the script's location, so a worktree copy would write to the wrong (gitignored) log.
- Never triage here — reporting is commitment-free.
