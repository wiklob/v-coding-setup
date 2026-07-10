# Post-session review standard (SOP)

The canonical run-book for reviewing what happened *inside* a finished ticket session. One artifact so a reviewer follows the method end-to-end without re-deriving it from the source, and so the lenses / output formats / finding-routing stop surviving only as "see first comment" examples.

This is the **written** half of V-5. V-5 / V-26 / V-60 built the **engine, resolver, and wrapper**; this document is the standard they implement. Where this SOP and the originating ticket (V-25) disagree on a concrete token, **this SOP wins** — it is written against the current code; the ticket (2026-05-30) predates the V-59/V-60/V-52 convergence (see [§7 What changed since V-25](#7-what-changed-since-v-25)).

---

## 1. The system at a glance

The review is **converged into one automated pipeline** — discover → analyze (two lenses) → single sink → harvest into tickets. The reviewer's job is to run it, then *read* what it surfaces (Lens B especially is candidates for a human, never verdicts).

```
ticket/session ──► transcript-resolver.mjs ──► session-review.mjs ──► log-pipeline-error.mjs ──► harvest-pipeline-bugs
   (V-26 resolve+redact)        (V-5 two lenses, --emit)      (V-55 single sink: errors.jsonl)     (V-52 cluster → bugs bucket)
```

| Piece | File | Role |
|---|---|---|
| Resolver / reader | `bin/transcript-resolver.mjs` | ticket → ranked sessions; read one **secret-redacted** (V-26) |
| Review engine | `bin/session-review.mjs` | the two lenses; `--emit` to the sink (V-5) |
| Wrapper command | `commands/review-session.md` | `/review-session`; the on-demand + auto face (V-60) |
| Single sink | `bin/log-pipeline-error.mjs` → `pipeline/audit/errors.jsonl` | one log for every detector (V-55) |
| Census | `bin/usage-stats.mjs` | raw counts that **corroborate** — does **not** route call-shapes (V-1) |
| Harvester | `commands/harvest-pipeline-bugs.md` | log → clustered, deduped patch-tickets in the `bugs` bucket (V-52) |

---

## 2. When to run it

- **On demand** — `/review-session <ticket-id | session-id | path-to.jsonl>` for a deep dive over any session, from any cwd.
- **Automatic** — `/land-ticket` §8.6 runs the engine (`session-review.mjs --ticket <ID> --emit`) right after the §8.5 `usage-stats.mjs` census, scoped to the landed ticket's primary session. Per-land coverage with no human action.

Both paths run the **same one engine** into the **same one sink**. There is no second detector, no second report parser.

---

## 3. Transcript discovery (the load-bearing dependency)

One ticket spans N sessions across ≥2 project dirs, none named for the ticket — and raw `*.jsonl` reads are correctly blocked by the secret guard (transcripts hold cleartext secrets). Both problems are solved by the **V-26 resolver**; never hand-roll the old `grep -rl "<TICKET>" ~/.claude/projects/*/*.jsonl` method.

```sh
# list every session touching a ticket, ranked
node ~/.claude/bin/transcript-resolver.mjs resolve <TICKET> [--json] [--limit N]

# read one transcript, secret-redacted, zero-context by default
node ~/.claude/bin/transcript-resolver.mjs read <TICKET|sessionId|path> [--session <id>] [--grep <pat>] [--excerpt[=N]] [--json]
```

- **Ranking = content-match wins.** Sessions are ranked by **mention count** (descending). **Recency is a tiebreaker only** — a session older than the 5-minute staleness window is *never* gated out if it has more mentions. Recency must not gate correctness (the V-1/V-20/V-21 lesson).
- **Redaction.** Env-var *names* are kept, *values* masked (the `TOKEN/SECRET/PASSWORD/KEY/CREDENTIAL/BEARER/AUTH/PAT/DSN` class, known token prefixes — `sbp_ sk- ghp_ xox* AKIA` — JWTs, `Authorization` headers, opaque runs ≥32 chars). **Tool-result bodies are never printed** — only counts + `is_error` flags. Because it is a named, redaction-enforcing verb it is allowlisted where a raw read is denied.
- **Caveat:** redaction is a **best-effort deny-list, not a guarantee** — treat output as low-risk, not certified secret-free. A short, unprefixed secret in prose can slip through.

`session-review.mjs` resolves the session itself (via `discoverPrimary()` → V-26 content-match), so a normal review never calls the resolver directly — reach for it for ad-hoc discovery or a manual read.

---

## 4. The two lenses

The engine streams the resolved transcript **once** and emits both lenses. Every emitted byte passes redaction first.

### Lens A — repetitive-call mining

Group every Bash command (and tool call) into a normalized **shape**, count recurrence (`--min-count N`, default 2), and bucket each recurring shape. Feeds V-4's permission model + V-23's helper scripts — this is how `wait-for-check.mjs` / `usage-stats.mjs` were born.

**Report heading:** `## Lens A — repetitive-call mining (N recurring shape(s))`
**Table:** `Shape | Count | Bucket | Reason | Example`
**Buckets (exact tokens):**

| Bucket | Meaning | Example shapes |
|---|---|---|
| `Allow` | read-only recurring verb → allowlist it | `git status`, `ls`, `grep` |
| `Script` | compound / multi-step → wrap in a `bin/*` helper | `git add && git commit` |
| `Deny/Ask` | sensitive / prod-mutating / secret-touching → keep gated | `git push --force`, `rm -rf`, `curl --data` |

> The V-25 ticket and the V-4 seed example wrote these as lowercase `script / allow / ask / deny` (with a `Pattern | Bucket | Reason | Ran here?` column set). The engine's actual tokens are **`Allow` / `Script` / `Deny/Ask`** with the column set above — use these.

### Lens B — correctness-flag candidates

Surface V-6/V-7-class issues. **Candidates, never verdicts** — the heading says so: `## Lens B — correctness-flag candidates (N) — human review, not verdicts`. The engine *surfaces*; the human *adjudicates*.

| Flag type | What it catches |
|---|---|
| `error-swallow` | Bash error-suppression (`2>/dev/null`, `\|\| true`, `\|\| echo`, `\|\| :`) |
| `failed-then-claimed` | assistant claims success after a tool error, no retry |
| `doc-asserts-state` | a Write/Edit to a `.md` asserting deployed/live/migrated/active state |
| `fabricated-id?` | (opt-in `--fab`) a success sentence naming an ID never seen in a prior tool_result |

**Credit working patterns too**, not only friction — a review notes where the session did it right (subagent offload to keep context clean, real read-back verification of an external mutation, a clean spin-out of an out-of-scope defect). The standard is a feedback loop, not a blame log.

### Engine CLI

```
node ~/.claude/bin/session-review.mjs (--ticket <ID> | --session <id> | <path.jsonl>) [opts]
  --emit         append each finding to the sink; print a one-line summary instead of the report
  --json         machine-readable report instead of Markdown
  --min-count N  Lens A threshold (default 2)
  --fab          enable the low-confidence fabricated-identifier scan
exit: 0 ok · 1 session unresolvable/unreadable/fs error · 3 bad args
```

---

## 5. Output formats

Three concrete schemas, all current:

**(a) Human-readable report** (default, no `--emit`) — the two Markdown sections above: Lens A's `Shape | Count | Bucket | Reason | Example` table and Lens B's candidate list.

**(b) `--emit` payload** — one log entry per **patchable** finding, the line carrying the fix-class up front:
- Lens A: `[lens-a/<BUCKET>] <SHAPE> ×<COUNT> — <REASON>`  (BUCKET ∈ `Allow` `Script` `Deny/Ask`)
- Lens B: `[lens-b/<TYPE>] msg#<N> — <DETAIL>`  (TYPE ∈ `error-swallow` `failed-then-claimed` `doc-asserts-state` `fabricated-id?`)

**Emit-worthiness filter (V-165).** The `--emit` path is consumed by `/harvest-pipeline-bugs` as **patchable** pipeline-command bugs, so it carries only findings that map to a fixable committed artifact. The pervasive convention-7/8 *pattern* flags — Lens A/`Script` (conv 7, "script it": per-session agent behavior, no command at fault), Lens B/`error-swallow` (conv 8), Lens B/`doc-asserts-state` (conv 8 read-back; mostly System docs correctly describing state) — are **suppressed from the sink** (they restate a behavior the conventions already govern; emitting them collapsed every harvest into ~4 generic non-patchable clusters). They remain in the **human Markdown report** (format (a) — `renderMarkdown` is unfiltered: the report is the meta read where allowlist/script signals and doc candidates still surface). What survives to the sink: Lens A/`Allow` + `Deny/Ask` (→ a `settings.json` permission patch) and Lens B/`failed-then-claimed` + `fabricated-id?` (rare genuine correctness anomalies). A new Lens type defaults to emit (over-emit beats silent-drop — the V-132 stance). The policy lives in `EMIT_SUPPRESS_LENS_A`/`EMIT_SUPPRESS_LENS_B` (`session-review.mjs`, filtered in `emitPayloads`).

`--emit` prints exactly one summary line — `review-session: emitted N patchable finding(s) → errors.jsonl (Lens A M, Lens B K); suppressed S non-patchable convention-7/8 pattern flag(s) (kept in report) [SESSION].` (the `suppressed …` clause is omitted when S=0; `no patchable findings` when N=0). That summary **is** the result; the findings live in the log, not the console.

**(c) The sink entry** — what each finding becomes in `pipeline/audit/errors.jsonl` (V-55 schema):

```json
{ "ts": "<ISO8601>", "session": "<id|null>", "activeCommand": "review-session",
  "origin": "<repo|null>", "tool": "manual", "error": "<the [lens-x/…] payload>" }
```

Review entries are emitted in **manual mode** (`--command review-session`, no `--tool`): `tool:"manual"`, `activeCommand:"review-session"`, and **no `input` field**. That `(tool, activeCommand)` pair + absent `input` is exactly how the harvester tells a review finding from a hook-caught failure (which always carries `input`) or a `/report-bug` entry.

> The V-4 `Pattern | Bucket | Reason | Ran here?` and V-23 `Proposal | Category | Reason` blocks were the *seed examples* the ticket cited; they are now realized as the engine's emitted formats above — the seeds, not the spec.

---

## 6. Finding routing — one sink, then harvest

**The routing is the single sink, not a per-finding map.** Every **patchable** finding goes to `pipeline/audit/errors.jsonl`; tickets are created downstream by the harvester.

1. `--emit` appends each **patchable** finding to `~/.claude/pipeline/audit/errors.jsonl` (the **absolute main-checkout** path, regardless of cwd — a worktree-relative copy is gitignored and harvester-invisible). The convention-7/8 pattern flags are filtered out first (the V-165 emit-worthiness filter, §5b) — they stay in the human report, not the sink.
2. `/harvest-pipeline-bugs` (V-52) reads that **one** log, selects review findings by the `(tool, activeCommand)` discriminator (`tool:"manual"` / no `input`, `activeCommand:"review-session"` — weighted **high**, since each already carries its Script/Allow/Deny or correctness fix-class).
3. It **clusters by root cause** (normalized error shape — *not* by `(tool, activeCommand)`; the same problem from many commands = one ticket listing all of them), dedups via a stable `harvest-key` (`<route>:<hash-of-normalized-error>`) against open bucket tickets, and **files one patch-ticket per cluster into the `bugs` bucket** (`cfg.bugBucket`, on `cfg.bugBucket.team`, labelled `scopeLabel`).

**Never route findings per-finding onto individual named tickets.** The reviewer does **not** decide "this finding lands on V-4, that one on V-23." Emitting is commitment-free; the read side (V-52) clusters and files. (`/review-session` and `/report-bug` are symmetric here — both write the sink and stop.)

Call-shape routing (Script/Allow/Deny) lives **only** in Lens A. `usage-stats.mjs` emits raw compound/failed-call **counts** that corroborate — it is not a second classifier (the V-60 de-dup boundary).

---

## 7. What changed since V-25

The ticket described the *manual* practice as of 2026-05-30; the system has since converged. Recorded so this SOP isn't misread as contradicting the ticket — it deliberately supersedes it:

- **Transcript discovery** — the manual `grep -rl … *.jsonl` ranked by `firstUserText` is replaced by the **V-26 resolver** (one allowlisted, redacting call). §3.
- **Buckets / output formats** — the seeded lowercase `script/allow/ask/deny` + `Pattern | Bucket | Reason | Ran here?` are replaced by the engine's actual `Allow / Script / Deny/Ask` + `Shape | Count | Bucket | Reason | Example`. §4, §5.
- **Finding routing** — the ticket's "per-finding routing map (which V ticket each finding class lands on)" + "expand-existing vs new-ticket rule" is **superseded** by the single-sink → harvester model: findings → `errors.jsonl` → `/harvest-pipeline-bugs` → `bugs` bucket. §6.

---

## 8. Method caveats

- **Shell-aware decomposition is approximate.** The shape signature does not split inside quotes, but a naïve operator scan is still fooled by heredocs and `curl --data` bodies. It's a good-enough normalizer, not a shell parser — read Lens A shapes with that in mind.
- **Don't over-automate Lens B.** The CB-123 catch (a dual-confirm email change that dead-ends the user) needed *reading the migration history*, not a file count. The engine surfaces candidates; correctness judgment stays human.
- **Redaction is best-effort.** §3's caveat applies to every emitted byte — low-risk, not certified secret-free.
