---
description: Wrap the session-review engine and emit its PATCHABLE findings to the single sink — run bin/session-review.mjs --emit so each Lens A allow/deny candidate + Lens B genuine correctness anomaly lands in pipeline/audit/errors.jsonl (activeCommand:review-session, tool:manual) for the harvester to pick up, while the convention-7/8 pattern flags stay in the human report (emit-worthiness filter). On-demand deep dive; also auto-fires at /land-ticket §8.6.
argument-hint: "<ticket-id | session-id | path-to.jsonl>"
allowed-tools: Bash
---

# /review-session — run the session-review engine into the error log

Wraps the session-review **engine** (`bin/session-review.mjs`, two lenses — Lens A call-shape routing + Lens B correctness flags) and points its output at the **single sink** (`errors.jsonl`), so its findings become tickets via the harvester.

**No second engine, no second sink, no separate report parser.** It runs `bin/session-review.mjs --emit` (the existing resolution + redaction SOP). `--emit` appends one entry per **patchable** finding by calling the logger in manual mode (`--command review-session`, **no** `--tool`, **`--session <resolved-uuid>`** — the session forwarding that makes each finding ticket-attributable downstream) → each entry carries `activeCommand:"review-session"` + `tool:"manual"` + the resolved `session` + no `input`, with the fix-class leading the `--error` payload. **Emit-worthiness filter:** the pervasive convention-7/8 *pattern* flags (Lens A/`Script`, Lens B/`error-swallow` + `doc-asserts-state`) map to no committed artifact and are suppressed from the sink; only patchable findings (Lens A/`Allow` + `Deny/Ask`, Lens B/`failed-then-claimed` + `fabricated-id?`) reach `errors.jsonl`, while the pattern flags stay in the human Markdown report (run without `--emit`). See `pipeline/review-standard.md` §5b. The **machine path is the log**.

## Two triggers, one command

- **ON-DEMAND** — `/review-session <ticket|session>` (this command): a deep dive over any ticket, session id, or transcript path, from any cwd.
- **AUTO** — `/land-ticket` §8.6 runs `session-review.mjs --ticket <ID> --emit` right after the §8.5 `usage-stats.mjs` census, scoped to the landed ticket's primary session. Per-land coverage with no human action. (Documented there; this command is the on-demand face.)

## Steps
1. `$ARGUMENTS` is the target. Empty → ask "Which ticket, session id, or transcript path?" and STOP.
2. Map the target to the engine's flag (the engine resolves all three; reuse its `discoverPrimary` + path handling — never re-resolve transcripts here):
   - Looks like a ticket id (`^[A-Z]+-\d+$`, e.g. `ENG-60`) → `--ticket <arg>`.
   - Looks like a path (contains `/` or ends `.jsonl`) → pass as the leading **positional** (`<arg>`).
   - Otherwise (a session id / UUID) → `--session <arg>`.
3. Run the engine in emit mode, by its **absolute main-checkout path** (so the entries always land in the global `~/.claude/pipeline/audit/errors.jsonl`, regardless of cwd — the same global log the hook and `/report-bug` write):
   ```sh
   node ~/.claude/bin/session-review.mjs <resolved-target-flag> --emit
   ```
   `--emit` prints a one-line summary — `review-session: emitted N patchable finding(s) … ; suppressed S non-patchable convention-7/8 pattern flag(s) (kept in report) …` or `review-session: no patchable findings …`. That summary IS the result; the findings are in the log, not the console.
4. Report the summary line back in one line. Done — routing happens later in `/harvest-pipeline-bugs`.

## Hard rules
- **Semantic deny inheritance.** Raw `~/.claude/projects/**/*.jsonl` access is forbidden through every tool and indirect path. Never substitute Python, Node evaluation mode, shell search, copies, alternate APIs, or a subagent for a denied read; stop at the first block. See `docs/security-review-boundaries.md`.
- **One engine.** Only ever invoke `~/.claude/bin/session-review.mjs` — no re-implemented discovery or analysis, no second detector. It in turn calls only `~/.claude/bin/log-pipeline-error.mjs` (the one logger, the one sink).
- **Absolute `~/.claude` path**, never a worktree-relative `bin/…`: the log path follows the script's location, so a worktree copy writes the wrong (gitignored, harvester-invisible) log.
- **Never pass `--tool`** to the underlying logger path — the default `"manual"` is what the harvester keys on to route the entry as a `review` finding.
- **Never triage here** — like `/report-bug`, emitting is commitment-free; the read-side (`/harvest-pipeline-bugs`) clusters and files tickets.
- Call-shape routing (script/allow/deny) lives **only** here (Lens A), not in `usage-stats.mjs` — the census emits raw counts that corroborate, never a second classifier.
