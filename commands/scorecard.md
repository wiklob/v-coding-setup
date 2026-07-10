---
description: Per-ticket scorecard + cross-session ceremony-vs-load-bearing aggregate — roll the four review lenses (session-report, tool-fit, token economics, produced-code) plus gate friction into one view per ticket, and aggregate across sessions into a ranked verdict that names ≥1 concrete pipeline change. The synthesis that makes the self-review loop actionable; mirrors /go's gate-audit for the full chain.
argument-hint: "<TICKET-ID> | --aggregate  [--json]   (per-ticket scorecard, or the cross-session ranked verdict)"
allowed-tools: Bash
---

# /scorecard — per-ticket scorecard + cross-session aggregate (A5)

The synthesis step of the **Pipeline self-review** loop. It reads the four lens
sinks plus the gate-audit friction map and combines them — per ticket into one
scorecard, across all tickets/sessions into a ranked "what's ceremony vs
load-bearing" verdict that names ≥1 concrete pipeline change. It is, for the full
chain, what `/go`'s `gate-audit.md` is for gates.

No interactive turns, no Linear writes, read-only. It's a thin wrapper over
`bin/scorecard.mjs` (the engine — pure join/parse/rank logic with its own test).

## Run it

- **Per-ticket scorecard:**
  ```bash
  node ~/.claude/bin/scorecard.mjs <TICKET-ID>
  ```
  Combines all four lenses for one ticket into one view:
  - (c) token economics — sessions, output/input/cache tokens, top output-by-command, top `tool_result` re-read bytes.
    - **Read-token footprint + regression flag (V-267):** `node ~/.claude/bin/read-footprint.mjs --ticket <TICKET-ID>` rolls this build's Read footprint up from `usage-stats.mjs`'s `tool_result_bytes.Read` and flags a `REGRESSION` when it exceeds the recent-build baseline (median ×1.5). This is the per-build accountability half of the read-discipline knob; the just-in-time half is the PostToolUse `bin/nudge-read-discipline.mjs` hook that nudges at the read itself. Add `--strict` to exit 3 on a regression so a land/CI caller can gate on it.
  - (b) tool-fit — per-step `right-sized|overkill|underdelivered` verdicts + ceremony flags.
  - (e) produced-code — acceptance met/partial/missed + quality verdict.
  - (a) session-review — Lens A/B finding counts, joined via the `session`→`ticket` map.
  - (model) gate friction — the ticket's `/go` runs: p'd / intervened / forced.

- **Cross-session aggregate:**
  ```bash
  node ~/.claude/bin/scorecard.mjs --aggregate
  ```
  Ranks top cost offenders (by ticket output tokens; by tool re-read bytes),
  quality offenders (produced-review missed/partial), tool-fit ceremony
  candidates, and **gate ceremony-vs-load-bearing** (a confirm gate p'd in every
  run with zero interventions is a prune candidate; one with ≥1 intervention is
  load-bearing), then prints a **Recommendations** block naming ≥1 concrete
  pipeline change — each with cited evidence.

- **Machine output:** add `--json` to either mode.

## Notes

- **Reads the canonical checkout.** Like `usage-stats.mjs`, the engine resolves
  the main worktree via `git worktree list` and reads `pipeline/audit/*` +
  `.claude/usage-stats/*` there. The `*.jsonl` sinks are gitignored runtime data,
  absent from feature worktrees, so a self-locating reader would see empty dirs.
- **Degrades gracefully (convention 8).** A missing/empty sink shows
  "no data for lens X" rather than crashing; the aggregate still ranks from the
  sinks that have data (`usage-stats`, `gate-audit.md` are always populated).
- **Where the sinks come from / how to populate them:** `pipeline/audit/README.md`
  documents each sink and its writer. `tool-fit.jsonl` and `produced-review.jsonl`
  are written by `/tool-fit` and `/review-produced`; `errors.jsonl`
  review-session rows by `/review-session` (auto at `/land-ticket` §8.6);
  `usage-stats/*.json` by `usage-stats.mjs` at land.
- **On-demand.** Run it after a batch of lands to see what the loop has learned.
