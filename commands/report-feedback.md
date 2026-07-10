---
description: Report subjective feedback on a command/session/output into the feedback log with near-zero friction — one free-text impression, appended to pipeline/audit/feedback.jsonl. The sibling of /report-bug (objective failures); no decisions forced.
argument-hint: "<how it felt, free text>  (optionally prefix --subject <command> to tag what it's about)"
allowed-tools: Bash
---

# /report-feedback — drop a subjective impression into the feedback log

The subjective-feedback front door — symmetric with `/report-bug` (which captures
**objective** failures). Here you record how a command / session / output *felt*:
"`/scope` was overkill here", "`/go` output was great this time", "this plan was
thin". **Report without ceremony** (parity with `/report-bug` and `/capture`): get
the impression on the record in one line. No triage, no decisions.

This is the human signal the **Pipeline self-review** loop's per-ticket scorecard
can't synthesize from transcripts
alone. It writes through `bin/log-feedback.mjs` — a **separate sink**
(`pipeline/audit/feedback.jsonl`), not the bug log: feedback isn't a bug, and
folding it into `errors.jsonl` would pollute `/harvest-pipeline-bugs`'s routing.

Downstream classification (craft-vs-procedure, per `craft/governance.md`) lives at the consumer, never at this front door.

## Steps
1. `$ARGUMENTS` is the feedback note. If empty → ask "How did it feel? What's the feedback?" and STOP. Otherwise the note is the only required input — never ask anything else.
2. **Subject (the command/topic the feedback is about) — infer, never prompt:**
   - If `$ARGUMENTS` begins with `--subject <name>`, lift `<name>` as the subject and treat the rest as the note.
   - Otherwise, if it's plainly obvious from the note or the immediately preceding session context which command/topic the feedback concerns (e.g. the note names `/scope`, or the session just ran `/go`), pass that as `--subject`. If it isn't obvious, **omit `--subject`** — not all feedback has one, and guessing is worse than null. Do **not** ask the user.
3. Append exactly one entry by invoking the feedback writer in its **absolute main-checkout path** (so the entry always lands in the global `~/.claude/pipeline/audit/feedback.jsonl`, regardless of the session's cwd):
   ```sh
   node ~/.claude/bin/log-feedback.mjs --note "<note>" [--subject <name>]
   ```
   Pass the note as the quoted `--note` value — never as a bare positional (the flag parser only reads `--note` / `--subject` / `--session`).
   - **Trace handles are stamped automatically — pass no extra flag.** The writer resolves `session` (this run) and `conversation` (the resume-chain root — the *thread*, stable across follow-ups/compaction) itself ([`session-identity.mjs`](../bin/session-identity.mjs), same mechanism as `/report-bug`) — what lets the scorecard attribute the feedback to a session/thread. Only add `--session <id>` to override.
4. Confirm in one line that the feedback was logged (name the subject if one was set). Done.

## Hard rules
- Writes exactly **one** JSONL entry per invocation, only through `~/.claude/bin/log-feedback.mjs` (the feedback sink — never `errors.jsonl`, never a second logger).
- **Force zero decisions** beyond the note itself — never prompt for severity, category, rating, or even the subject (parity with `/report-bug` and `/capture`). Subject is inferred or omitted, never asked.
- Always use the absolute `~/.claude` path, not a worktree-relative `bin/…` — the sink path follows the script's location, so a worktree copy would write to the wrong (gitignored) log.
- Never triage here — reporting is commitment-free; the scorecard consumes it later.
