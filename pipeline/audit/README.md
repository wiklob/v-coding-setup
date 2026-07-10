# pipeline/audit — pipeline error log

Genuine pipeline tool errors land in `errors.jsonl` (this dir) so the pipeline's
rough edges are visible and fixable. The log itself is **gitignored** (per-machine
runtime data, churny, redacted-but-not-source); only this README is tracked.

## What writes it

`bin/log-pipeline-error.mjs` (V-55), in two modes:

- **Hook mode** — registered in `settings.json` on the two events that actually
  carry tool errors:
  - **`PostToolUseFailure`** — a tool call failed: non-zero Bash exit, MCP/API
    error, file/command not found.
  - **`PermissionDenied`** — the auto-mode classifier denied a call.

  > Not `PostToolUse`: that event fires **only after a tool call succeeds**, so it
  > would log zero errors. (Docs: <https://code.claude.com/docs/en/hooks> — lifecycle
  > table.) Denials from a PreToolUse-deny / manual reject / deny-rule fire **no**
  > hook, so they are out of capture scope — only auto-mode-classifier denials are
  > observable.

- **Manual mode** (the behavioral backstop, below).

## Entry format (JSONL, one object per line)

```json
{ "ts": "<ISO8601>", "session": "<session_id|null>", "conversation": "<conversation_id|null>", "activeCommand": "<slash-command|null>", "origin": "<repo|null>", "tool": "<tool_name>", "input": "<redacted tool_input, optional>", "error": "<message>" }
```

- `activeCommand` is best-effort in hook mode (scanned from the live transcript's
  last `<command-name>` marker; `null` when not derivable). In manual mode it is
  exact — the command names itself.
- `session` is the run the entry fired in; `conversation` is the **thread** it
  belongs to — the resume-chain root, walked from the daemon jobs' `resumeSessionId`
  links, so a follow-up turn or a post-compaction restart shares one conversation id.
  Both are resolved without `CLAUDE_SESSION_ID` (unset in the bg/daemon launch path):
  the session id comes from the job's `state.json`, the conversation from the chain.
  `conversation` may equal `session` (a length-1 or untraceable chain) or be `null`
  on entries written before the field existed. `/harvest-pipeline-bugs` cites an
  always-present **origin handle** on each patch-ticket — the distinct `conversation`
  ids, falling back to the `session` id(s) where `conversation` is `null` or equals
  `session` — so the build-time fallback (`next-ticket.md` §6) can always `/ingest-convo`
  the source. It also reconstructs an **Occurrence** summary from the verbatim
  (un-normalized) `error` + redacted `input` + `tool`/`activeCommand`/`origin` (V-137).
- `origin` (V-88) is the repo the entry fired in — nearest git-root basename of the
  session cwd, best-effort, `null` when not derivable. It is **triage context only,
  never a routing key**: the whole sink is pipeline-subject, so `/harvest-pipeline-bugs`
  files every entry into the one shared `bugs` bucket regardless of `origin`.
- `input` and `error` are passed through `redact()` (from `transcript-resolver.mjs`),
  so a secret in a failing command or error message is masked, not logged.
  Redaction is **best-effort deny-list**, not a guarantee — it masks secret-keyed
  values, known token prefixes, and opaque runs ≥32 chars. A short (8–31 char),
  unprefixed, unkeyed secret passed as a bare positional arg can still slip through.
  Treat the log as low-risk, not certified secret-free.

## Signal, not firehose — the noise filter

Dropped (expected control flow, not genuine errors):

- `grep`/`rg`/`egrep`/`fgrep`/`diff`/`cmp` exiting 1 (no-match). A *different*
  non-zero (e.g. `grep` bad-regex exit 2) is kept — it's a real error.
- commands containing `--dry-run`, or guarded with `|| true`.
- `test` / `[ ]` conditionals.
- user interrupts.

Kept: command-not-found (127), file-not-found, every `mcp__*` failure, every
`PermissionDenied`.

**Known limitation — retry-successes.** A fail-then-succeed pair (a tool that fails
once then succeeds on retry) logs the failure, because at failure time the retry
hasn't happened — a single failure event can't know its own future. This is
**not** silently dropped; it's reconciled downstream by whoever reviews the log.

## Behavioral backstop (semantic errors no hook can see)

A hook observes only tool-level failures. For *semantic* errors — a command
detecting its own inconsistency, a missing prerequisite, an assertion it makes
about its own state failing — the command appends to the same log itself:

```sh
node ~/.claude/bin/log-pipeline-error.mjs --command <self> --error "<what went wrong>" [--tool <t>]
```

A manual call is genuine by definition (no filter) and records `activeCommand`
precisely. Use it sparingly — only for errors a human would want surfaced, the
same bar as the hook's "genuine, not firehose" filter.

**Front door — `/report-bug`.** For a human-spotted pipeline bug, the friction-free
front door to this manual mode is the `/report-bug <note>` command — one free-text
note, no flags to remember. It invokes the CLI above with `--command report-bug`, so
its entries carry `activeCommand: "report-bug"` and are distinguishable in the log
from hook-caught errors and in-session self-reports.

**Machine writer — `/review-session` (V-60).** The second manual-mode writer is the
V-5 review engine run with `--emit` (via `/review-session` on demand, and
`/land-ticket` §8.5/§8.6 per land). Each Lens A call-shape routing recommendation and
Lens B correctness candidate is appended with `--command review-session` (no `--tool`),
so its entries carry `activeCommand: "review-session"` + `tool: "manual"` and the
fix-class leads the `error` payload — `/harvest-pipeline-bugs` routes them as `review`
findings through its one read (no separate V-5 report parser).

## What reads it

`/harvest-pipeline-bugs` (V-52) is the **single standing consumer**: it reads this log,
routes/weights each entry by the `(tool, activeCommand)` pair (the writer discriminator —
there is no `source` field), clusters distinct problems, and files deduped patch-tickets
into the shared `bugs` Linear bucket. A daily local OS cron (`claude -p "/harvest-pipeline-bugs --yes"`) invokes it. Re-runs dedupe
against open bucket tickets (via a `harvest-key` in each ticket body), so a recurring problem
is never refiled while its ticket is open. The harvester tracks its progress in a per-machine,
gitignored watermark `.harvest-watermark` (last-harvested `ts`) beside this log.

## Rotation — keeping the live log under the Read ceiling (V-166)

`errors.jsonl` is append-only and unbounded; left unchecked it crosses the Read
tool's **256 KB ceiling**, at which point a whole-file `Read` of the log fails
outright (`File content (NNN KB) exceeds maximum allowed size (256KB)`). Two
measures keep it readable, both keyed on the harvest watermark:

- **`/harvest-pipeline-bugs` streams, never whole-file-Reads** — §1 reads new
  entries via `bin/read-errors-since.mjs`, which streams the log line-by-line and
  emits only post-watermark entries, so harvest never trips the ceiling regardless
  of log size.
- **`bin/rotate-errors-log.mjs` rolls harvested entries to a dated archive** —
  invoked from harvest §7 *after* the watermark advances. It moves entries the
  watermark marks harvested (`ts <= watermark`) into `errors-<stamp>.jsonl` (same
  `*.jsonl` gitignore glob, so archives stay per-machine and untracked like the
  live log) and keeps only the un-harvested remainder (`ts > watermark`) live. The
  watermark is the **safety key**: an entry is archived only when provably
  harvested, so rotation never drops an un-harvested entry. It no-ops under a size
  threshold (default 200 KB) or when no watermark exists yet. Both helpers are pure
  + unit-tested (`bin/read-errors-since.test.mjs`, `bin/rotate-errors-log.test.mjs`).

## Install

The hook is registered in `settings.json` under `hooks.PostToolUseFailure` and
`hooks.PermissionDenied`, both pointing at
`node ~/.claude/bin/log-pipeline-error.mjs` (absolute path, matching
the other `bin/` hooks). The log path follows the script location, so capture is
**global** — every session writes to the main checkout's `pipeline/audit/errors.jsonl`.

---

## Sibling sink — subjective feedback (`feedback.jsonl`, V-86)

`errors.jsonl` above captures **objective failures** (a tool errored, a gate
misfired). Its sibling `feedback.jsonl` (same dir, also gitignored by the
`*.jsonl` rule) captures **subjective feedback** — how a command / session /
output *felt* ("`/scope` was overkill here", "`/go` output was great"). The two
are kept in **separate sinks on purpose**: feedback isn't a bug, and folding it
into `errors.jsonl` would pollute `/harvest-pipeline-bugs`'s `(tool, activeCommand)`
routing. The bug harvester never reads `feedback.jsonl`.

- **What writes it:** `bin/log-feedback.mjs` (V-86) — **manual-only**, no hook
  (there is no "this felt off" tool event for a hook to fire on) and no noise
  filter (a human-typed impression is genuine by definition). It reuses
  `transcript-resolver.mjs`'s `redact()` and the same script-rooted, global path
  resolution as `log-pipeline-error.mjs`.
- **Front door — `/report-feedback`** (sibling of `/report-bug`): one free-text
  impression, zero forced decisions. Invokes the writer in manual mode.
- **Entry format (JSONL, one object per line):**
  ```json
  { "ts": "<ISO8601>", "session": "<session_id|null>", "subject": "<command-or-topic|null>", "note": "<redacted verbatim impression>" }
  ```
  - `subject` is the command/topic the feedback is about (`scope`, `go`,
    `land-ticket`), inferred by `/report-feedback` from context or omitted (`null`)
    — never prompted for. Leading slashes are stripped.
  - `note` passes through the same `redact()` deny-list as the error log (same
    best-effort caveat — low-risk, not certified secret-free).
- **What reads it:** **`/harvest-feedback`** (V-265) — the standing consumer, the
  feedback sibling of `/harvest-pipeline-bugs`. It streams new entries since
  `.feedback-watermark` (`bin/read-feedback-since.mjs`), clusters by `subject`,
  judges **emphasis** (a re-mention is signal, not dedup-noise — see
  `craft/governance.md` trigger (a)), and routes each cluster: **auto-files** the
  bug/pipeline routes (→ bugs bucket / Standalone (V)) and **proposes** the
  craft-revision route as a `/review-skill` (never auto-retiring a rail), marking
  every artifact `review-mode: auto`. Runs on demand and via a **daily launchd
  agent** (`com.v-coding-setup.harvest-feedback`, 09:17, installed by
  `bin/install-feedback-harvest-launchd.sh`; logs to `harvest-feedback.log`) — the
  same per-machine, local-only rationale as the bug harvester. The per-ticket
  **scorecard (V-81)** also keys off
  `subject` for its own aggregate.

---

## Producer — docs-maintenance ritual (`docs-refresh.log` + `.docs-refresh-watermark`, V-284)

Not a sink but a **producer** whose runtime state lands in this dir: **`/docs-refresh`**
is the daily docs-maintenance loop (V-284) — under `cfg.docs.maintenance: "daily"` it
**replaces per-commit doc work entirely**: it reviews the day's merged changes since the
`.docs-refresh-watermark` (last-reviewed `origin/main` SHA, advanced via the fs-write
helper `bin/advance-docs-refresh-watermark.mjs`), **applies** every warranted doc update
itself (freshness-header bumps, changelog entries generated from merged-PR metadata,
genuine drift fixes via read-only `/audit-docs` findings, CLAUDE.md refreshes applying
`/gen-claude-md`'s approach inline, postponed entries), and lands them as **one
consolidated `docs: daily maintenance <date>` PR** — never auto-merged; the human's merge
of that single daily PR is the review checkpoint that replaces the per-tool STOP gates
and `/land-ticket`'s per-land ripple (§4.7/§6.5/§6.8 no-op under `"daily"`). One doc
commit/day instead of doc lines smeared across every feature PR, and doc work paid once
instead of per-build. Runs on demand and via a **daily launchd agent**
(`com.v-coding-setup.docs-refresh`, **09:47** — after the 09:07/09:17/09:27 morning
cluster, installed by `bin/install-docs-refresh-launchd.sh`, runner
`bin/docs-refresh-runner.sh`; logs to `docs-refresh.log`) — the same per-machine,
local-only rationale as the harvesters (it reads the machine's git history + tree). The
log and watermark are gitignored (per-machine runtime state). Registered in
`pipeline/schedule-registry.json` (V-306); pairs with the V-263 daily rituals.

---

## Sibling sink — tool-fit verdicts (`tool-fit.jsonl`, V-78)

`errors.jsonl` captures **objective failures**, `feedback.jsonl` captures
**subjective human impressions**; `tool-fit.jsonl` (same dir, also gitignored by
the `*.jsonl` rule) captures **synthesized per-session verdicts** — the
*Pipeline self-review* tool-fit lens (b) grading whether each pipeline step
(`scope` / `recon` / `build`) earned its cost. A third sink on purpose: a
verdict is neither a bug nor a typed impression, and folding it into either
would pollute the bug harvester's `(tool, activeCommand)` routing and the
feedback consumer's `subject` keying. `/harvest-pipeline-bugs` never reads it.

- **What writes it:** `/tool-fit <TICKET-ID | --session <id>>` — a judgment lens
  (subagent), read-only except this one append, made via the sanctioned
  `bin/log-audit-record.mjs --sink tool-fit.jsonl` helper (dir-creation + `ts`
  stamp + redaction internal; no bare `mkdir pipeline/audit` — V-335). It routes
  all transcript access
  through `transcript-resolver.mjs` / `session-review.mjs` (redaction + streaming
  already solved) and consumes `usage-stats.mjs`'s census + `gate-audit.md`'s
  ledger as evidence; it never bulk-loads a transcript.
- **Entry format (JSONL, one object per session):**
  ```json
  { "lens": "tool-fit", "ticket": "<ID>", "session": "<session_id>", "ts": "<ISO8601>", "steps": [ { "step": "scope|recon|build", "ran": true, "verdict": "right-sized|overkill|underdelivered|n/a", "ceremony": false, "evidence": "<one-line cited signal>" } ] }
  ```
  - Same `ts`/`session` envelope as the other two sinks; the lens-specific
    payload is `steps[]`, keyed `ticket`+`session` so one record = one session.
  - `verdict` per step grades tool fit against `next-ticket.md` §5's scope rubric
    (the single source — the lens references, never restates it). `ceremony:true`
    flags a step that ran but produced no downstream value (the build-chain
    analogue of a perennially-`p'd` gate).
- **What reads it:** the per-ticket **scorecard (V-81)**
  — A5 aggregates this stream (alongside the token-economics A3 and code-quality
  A4 lenses) by `lens`/`ticket`/`step` into the "ceremony vs load-bearing"
  verdict. This lens is the **producer** of the contract above; the consumer is
  built later (V-81, Backlog) — keep the per-line `{lens, ticket, session, ts, …}`
  envelope identical across the sibling lenses so A5 reads one uniform stream.

---

## Sibling sink — produced-code review (`produced-review.jsonl`, V-80)

`errors.jsonl` captures objective failures and `feedback.jsonl` captures
subjective human impressions; `produced-review.jsonl` (same dir, also gitignored
by the `*.jsonl` rule) captures the **automated produced-code review** of a
landed ticket — the merged diff judged against each Acceptance item plus a
quality verdict. It is the **code-quality lens (e)** of the Pipeline self-review
loop. Kept in its own sink on purpose: it is machine-generated per-ticket review
output, distinct from `feedback.jsonl`'s manual, human-subjective notes — folding
the two would pollute the human signal exactly as folding feedback into
`errors.jsonl` would pollute bug-harvest routing.

- **What writes it:** `/review-produced <TICKET-ID>` — the retrospective review
  skill. One record appended per run, after the human-readable review is printed,
  made via the sanctioned `bin/log-audit-record.mjs --sink produced-review.jsonl`
  helper (dir-creation + `ts` stamp internal; no path-naming inline append that
  would trip the `pipeline/audit` prompt — V-335). Free-text fields pass through
  the same `redact()` path as the other sinks (now inside the helper) when the
  repo's diffs may carry secrets.
- **Front door — `/review-produced`** (sibling of `/review-pr` / `/review-session`):
  resolves the ticket's merged PR, reads the diff, emits met/partial/missed per
  Acceptance item + a clarity/reuse/engineering verdict.
- **Entry format (JSONL, one object per line):**
  ```json
  { "ts": "<ISO8601>", "session": "<session_id|null>", "subject": "review-produced", "ticket": "<ID>", "pr": <n>, "mergeCommit": "<sha|null>", "acceptance": [ { "item": "<text>", "verdict": "met|partial|missed", "evidence": "<file:line>" } ], "quality": { "clarity": "...", "reuse": "...", "engineering": "...", "conventions": "...", "notes": "..." } }
  ```
  - `subject` is the literal `"review-produced"`; `ticket` is the per-ticket join
    key. The scorecard groups on `ticket` and keys the lens on `subject`.
- **What reads it:** the per-ticket **scorecard (V-81)**
  — lens (e), alongside `feedback.jsonl` (human signal), `tool-fit.jsonl` (lens b),
  and `gate-audit.md` (gate friction). Per-ticket it surfaces acceptance
  met/partial/missed + the quality verdict; aggregated it counts partial/missed
  rates and recurring quality smells across tickets.

## The reader — per-ticket scorecard + cross-session aggregate (`scorecard.mjs`, V-81)

`bin/scorecard.mjs` is the **synthesis** step that closes the loop: it reads every
sink above plus `gate-audit.md` and rolls them into one view. It is, for the full
chain, what `log-gate-audit.mjs` + `gate-audit.md` is for `/go`'s gates.

- **Front door — `/scorecard`:** `/scorecard <TICKET-ID>` (per-ticket) ·
  `/scorecard --aggregate` (cross-session). `--json` for machine output.
- **The four lenses + the model it combines:**
  - (a) session-report → `errors.jsonl` rows `activeCommand:"review-session", tool:"manual"` (V-60). Joined to a ticket via the `session`→`ticket` map built from `usage-stats/*.json` (rows carry only `session`).
  - (b) tool-fit → `tool-fit.jsonl` (V-78). Direct `ticket` join.
  - (c) token economics → `.claude/usage-stats/*.json` (V-79). Direct `ticket` join; ranks output tokens + `tool_result_bytes` re-read offenders.
  - (e) produced-code → `produced-review.jsonl` (V-80). Direct `ticket` join.
  - (model) gate friction → `gate-audit.md` (V-75). Grep/parse by ticket.
- **Paths:** like `usage-stats.mjs`, it resolves the **main worktree** via
  `git worktree list` and reads the canonical sinks there — the `*.jsonl` are
  gitignored runtime data absent from feature worktrees, so a self-locating reader
  would see empty dirs. A missing/empty sink degrades to "no data for lens X",
  never a crash.
- **Aggregate output:** ranks top cost offenders (by ticket output tokens; by tool
  re-read bytes), quality offenders (produced-review missed/partial), tool-fit
  ceremony candidates, and gate ceremony-vs-load-bearing (a confirm gate p'd in
  every run with zero interventions is a prune candidate; one with ≥1 intervention
  is load-bearing), then derives a **Recommendations** block naming ≥1 concrete
  pipeline change with cited evidence.
- **Standing consumer of the aggregate — `/periodic-review`** (V-264): the weekly
  ritual that closes the *consumption* half of the loop the way `/harvest-feedback`
  closes it for `feedback.jsonl`. It runs `scorecard.mjs --aggregate --json`,
  **adds the delivery dimension the aggregate lacks** (the tickets completed using V
  in the window, read from `usage-stats/` by `completed_at`), synthesizes a durable
  dated report at **`periodic-review-<date>.md`** (this dir, gitignored per-machine
  like every sink), and **routes each recommendation** to an action — auto-filing
  pipeline/bug tickets, proposing craft-revisions (`review-mode: auto`), exactly as
  `/harvest-feedback` routes. Runtime state: watermark `.periodic-review-watermark`
  (window start, advanced only via `bin/advance-periodic-review-watermark.mjs`), log
  `periodic-review.log`. Runs on demand and via a **weekly launchd agent**
  (`com.v-coding-setup.periodic-review`, Monday 09:27, installed by
  `bin/install-periodic-review-launchd.sh`) — the same per-machine, local-only
  rationale as the harvesters (it reads gitignored sinks a cloud routine can't see).
