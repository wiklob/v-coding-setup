---
description: In-depth periodic review — consume the pipeline's own measurement outputs (usage-stats + session reports + scorecard --aggregate) and the tickets completed using V in the window, then emit a durable dated actioned summary and route its actions (auto-file pipeline/bug, propose craft-revision), review-mode auto. The standing consumer of the measurement loop; weekly launchd schedule + on-demand.
argument-hint: "[--yes] [--all] [--dry-run] [--since <ISO8601>]"
allowed-tools: Bash, Read, Grep, Write, mcp__linear
---

# /periodic-review — turn the measurement loop into actioned review

The **one** consumer of the pipeline's own review outputs. `usage-stats/` and the session reports are written every land but barely read (feedback #27/#24); `/scorecard --aggregate` ranks them but only on demand and only ephemerally, and it is pipeline-meta only. This is the standing ritual that **reads the aggregate, adds the delivery dimension the aggregate lacks (what actually shipped using V), and emits a durable, dated, actioned summary** — auto-filing the objective improvement/bug routes into their buckets and proposing the craft-revision route for a human `/review-skill`. Runs on demand and via a weekly local **launchd LaunchAgent** (`claude -p "/periodic-review --yes"`, installed by `bin/install-periodic-review-launchd.sh`). It must run **locally, from the canonical `~/.claude` checkout** — every sink it reads is a per-machine gitignored file only a process on this machine can see (the documented reason the harvesters use launchd, not a cloud `/schedule` routine).

Read `~/.claude/workflow-conventions.md` first (esp. conventions 4 + 8), then `~/.claude/craft/README.md` and `~/.claude/craft/governance.md` (the routing taxonomy + the propose-don't-auto-retire discipline this command inherits). The sibling of `/harvest-feedback` — it reuses that command's read→route→dedupe→file→propose→review-mode→watermark skeleton, with one deliberate divergence: it does **not re-implement aggregation** (`bin/scorecard.mjs --aggregate` already reads all four lenses + gate friction and ranks them — this command *consumes* its `--json`), and it adds a **synthesis + delivery-review + durable-artifact** layer the harvest pattern doesn't have.

**Why this is not `/scorecard --aggregate` (what it adds):**
1. **Scheduled + durable.** `/scorecard --aggregate` prints to the terminal on demand; this fires weekly and writes a durable dated report (`pipeline/audit/periodic-review-<date>.md`) a later reader can grep for trends.
2. **Delivery dimension.** `/scorecard --aggregate` is pipeline-meta only. This also reviews **what shipped using V** in the window — the tickets completed (from `usage-stats/`, one file per land) — so the review covers both the pipeline's self-improvement AND the project work it produced.
3. **Actioned.** Each recommendation is routed to a concrete action (auto-file a pipeline-ticket / bug, or propose a craft-revision), review-mode `auto`, exactly as `/harvest-feedback` routes — not left as prose.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`. Missing → `/ticket-flow-init`, STOP.
- Required: `scopeLabel`, `standaloneProject` (the pipeline-ticket destination — "Standalone (V)"), `bugBucket` (`{ name, team, id }` — the bug destination). Resolve each destination to a project **ID** once (prefer the pinned `bugBucket.id`; for `standaloneProject` resolve the name to an id via one `get_project` and reuse it) and use the ID for every dedupe + filing call — a display-name rename resolves to *no project* without erroring, silently orphaning filings.

## The inputs (read, never re-implement)
All paths are absolute, main-checkout — global, gitignored, per-machine (`pipeline/audit/README.md`). Never read a worktree-relative copy (gitignored-empty). This command runs from `~/.claude` itself.
- **The aggregate — `node ~/.claude/bin/scorecard.mjs --aggregate --json`** (allow-listed via `Bash(node ~/.claude/bin/*.mjs)`). This single call is the reader of **usage-stats** (`costTickets`, `costTools` — token economics), **session reports** (`reviewAttribution` — the `review-session` rows in `errors.jsonl`), **tool-fit** (`ceremonySteps`), **produced-code** (`qualOffenders`), and **gate friction** (`gateRows`, `pruneCandidates`, `loadBearing`), plus a ready `recommendations` block (each naming a concrete pipeline change with cited evidence) and `_sinks` (per-lens population, for the degrade note). Consume its JSON; do not re-derive any of it. It degrades gracefully on empty sinks — a lens with no data yields an empty array, not an error.
- **Delivery — `usage-stats/` files completed in the window.** `~/.claude/.claude/usage-stats/<YYYY-MM-DD-HHMMSS>-<TICKET>.json`, one per landed ticket, each carrying `ticket`, `completed_at`, `pr`, `totals`. The set with `completed_at ≥` the window start IS "the tickets completed using V" this window. List them cheaply (`ls` / a bounded `find` by mtime); parse only those in-window. Cross-reference `produced-review.jsonl` (the quality verdicts scorecard surfaces as `qualOffenders`) for the ones reviewed. Optional Linear enrichment: `get_issue` per in-window ticket for its title/state — keep it to the in-window set, never a broad `list_issues`.

## 1. Resolve the window
- Window **start** by flag:
  - `--since <ISO8601>` → that timestamp.
  - `--all` → epoch (`1970-01-01T00:00:00.000Z`) — reconsiders the whole history; safe, §5 dedupe prevents double-filing.
  - else → read `~/.claude/pipeline/audit/.periodic-review-watermark` (a single ISO line; absent → default to 14 days ago, a sensible first-run window rather than all-time).
- Window **end** = now. The watermark is an **optimization** for the delivery/recency lens, not the correctness guard — §5's dedupe against open tickets is. (The `scorecard --aggregate` half is all-time by design: trends need the full history; the window scopes only the delivery review and the "what's new since last review" framing.)

## 2. Read the aggregate + the delivery set
- Run `scorecard.mjs --aggregate --json`, capture the object. Note `sessionsAnalyzed` and `_sinks` (if a lens is empty, say so in the report's degrade line — don't silently present a hole as "nothing to improve").
- List `usage-stats/` files with `completed_at ≥` window start; parse them into the delivery set (ticket, PR, token totals). Join each to `qualOffenders` / `produced-review.jsonl` where a produced-review exists.
- 0 new lands AND an all-time-empty aggregate → report "nothing to review since `<watermark>`; re-run with `--all` to reconsider." STOP (advance nothing).

## 3. Synthesize the review (the judgment pass)
Build the review from the aggregate + delivery set — this is what the ritual exists to do; a JSON dump is not a review. Reason over the data, don't restate it:
- **Pipeline recommendations** — take `recommendations` (already cited) and, for each, decide a concrete **action + route** (§4). Add any recommendation the raw lenses imply that the aggregate under-weighted (a `costTools` re-read spike, a `ceremonySteps` candidate, a gate perennially in `pruneCandidates`).
- **Cost & tool-fit trends** — the top `costTickets` / `costTools` offenders and any `ceremonySteps` — is spend trending up, is a tool over-used, is a step ceremony?
- **Gate friction (ceremony vs load-bearing)** — `pruneCandidates` (perennially-`p'd` gates — prune candidates) vs `loadBearing` (regularly-intervened gates — earned their keep). Name the specific gates.
- **Delivery review (tickets completed using V)** — per in-window land: what shipped (ticket + PR), its produced-review verdict if any (met/partial/missed), its token cost against the median. Surface the outliers (a partial/missed acceptance, a cost outlier), not a flat list.
- Hold the review against `craft/judgment.md`'s constraints before emitting: name the real signal, don't fill the silence, cite the evidence (the lens + the number), don't manufacture a recommendation to look thorough — an empty lens is "no signal this window," not an invented finding.

## 4. Route + weight each action (inherited from /harvest-feedback §4)
Assign exactly one route per actionable item, grounded in `craft/governance.md`:
- **pipeline-ticket** — an actionable command/skill improvement that isn't a bug (a ceremony gate to prune, a re-read hotspot to fix, a recommendation from the aggregate). → **auto-file** a ticket into `standaloneProject` ("Standalone (V)").
- **bug** — the finding is an objective failure (a lens is broken, a helper is erroring). → **auto-file** into the `bugs` bucket.
- **craft-revision** — the finding is about *how the work reads / feels* (a judgment rail, a command's craft). → **propose** `/review-skill <subject>` (never auto-retire a rail — the irreversible judgment stays human, per `governance.md`).
- **drop** — a trend worth recording in the report but below the actionable bar. → no filing; the report still notes it.
Weight (→ priority + ordering): a material, evidence-backed finding → High; a mild/one-window signal → Medium/Low.

## 5. Dedupe filed routes (re-finding is not a duplicate)
For the auto-file routes (bug / pipeline-ticket), key each with `review-key: <route>:<short-hash of the finding's stable framing>` (carried on the filed ticket's body, the dedupe handle — the `harvest-key` pattern). Against open tickets in the destination (`list_issues` `project: <destId>`, `state` in `[Todo, Backlog, In Progress]`):
- **No open ticket with the key** → file a new one (§6).
- **An open ticket already carries the key** → do **not** file a duplicate: `save_comment` on it with the new window's evidence ("recurs in the <date> review — now also: <n>"), and re-rank its priority up if the trend strengthened. Count the update; report it.
For **craft-revision**, dedupe a *proposal* against an already-open `/review-skill`-candidate note for the same subject the same way — bump, don't duplicate.

## 6. Emit the durable report + act (gated by mode)
**Always write the durable report** to `~/.claude/pipeline/audit/periodic-review-<YYYY-MM-DD>.md` (absolute, canonical checkout — stamp `<date>` from `date +%F`), with these sections (headings stable so a later reader can grep across reports):
```
# Periodic review — <date>
review-mode: auto   ·   window: <start> → <end>   ·   sessions analyzed (all-time): <n>   ·   sinks: <per-lens population>

## Pipeline recommendations
- <recommendation> — evidence: <lens + number> — action: <file new / update <ID> / propose /review-skill <subject> / note>

## Cost & tool-fit trends
- <top offenders + trend read>

## Gate friction (ceremony vs load-bearing)
- prune candidates: <perennially-p'd gates>
- load-bearing: <regularly-intervened gates>

## Delivery review (tickets completed using V)
- <TICKET> (<PR>) — <what shipped> — produced-review: <met|partial|missed|none> — cost: <output tok vs median>

## Actions
- <route> · <weight> · <one-line> · <file new / update <ID> / propose /review-skill / drop>

Tally: filed <F> · updated <U> · proposed <P> · dropped <D> · via auto
```
(The report is runtime output — `pipeline/audit/` is gitignored per-machine, like every sink it summarizes; the committed artifact is this skill + the scripts, not the report.)

Then act, by mode:
- **Interactive (default):** print the report path + the action tally + the dedupe/update counts. **Confirm gate (convention 11)** — a `needs input:` stop, no Linear writes until the human proceeds. `p` files the auto-file routes + posts the craft proposals as stated; anything else is an instruction.
- **`--yes` (the weekly cron / headless):** skip the gate and act directly — **auto-file** bug/pipeline routes (§5 dedupe is the correctness guard, not the gate) and **surface** craft-revision proposals (write them into the report for a human `/review-skill`; never auto-act on a craft rail). Hold a quality bar: file only findings that clear the genuine-signal bar; leave weak trends noted-but-unfiled (the watermark still advances).
- **`--dry-run`:** write the report (so the synthesis is inspectable) but STOP before any Linear write and advance nothing. `result: dry-run — report at <path>; <K> would file/update, <C> craft proposals, watermark unchanged.`
- **Filing (on go / `--yes`):** `save_issue` `team` + `project: <destId>` (the resolved ID, never a name), `labels: [<scopeLabel>]`, `priority`, the body (with the `review-key:` line + a `## Acceptance` derived from the route + a pointer to the report date), and the **review-mode marker** `review-mode: auto`. After each create/update **read back** the response and assert the returned `id` is real and `projectId === destId` (convention 8) — a mismatch → STOP loudly, do not advance the watermark.

## 7. Advance the watermark + report
- Advance to the window end (now) — **only on a real (non-dry-run) pass** — via the sanctioned writer: `node ~/.claude/bin/advance-periodic-review-watermark.mjs --ts <end>` (the helper writes the dotfile via fs — never a `Write`/`>`, which trips the sensitive-file prompt and freezes the unattended cron).
- Report: the report path, filed (count + IDs), updated (count + IDs), craft proposals (count + subjects), dropped (count), the review-mode tally, watermark advanced to `<ts>`.
- **Next step (convention 4):** `/review-skill <subject>` for each craft proposal; `/bulk-fix --project "<bucketName>"` or `/next-ticket <ID>` for the filed tickets.

Emit `result:` on its own line: `result: /periodic-review — report at pipeline/audit/periodic-review-<date>.md; filed <F>, updated <U>, proposed <P> craft reviews, dropped <D> (review-mode: auto); watermark → <ts>. Next: /review-skill for craft proposals, /bulk-fix for filed.`

## Hard rules
- **Consume, don't re-implement:** the aggregate comes from `scorecard.mjs --aggregate --json`; never re-derive the lens joins or the ranking (that engine + its test own it).
- **Runs locally from the canonical checkout:** reads per-machine gitignored sinks; never a cloud `/schedule` routine (it can't see them). launchd only.
- **Propose, never auto-retire, for craft:** the craft-revision route is surfaced for a human `/review-skill`; auto-retiring/reinforcing a rail is never done unattended.
- **Auto-file is dedupe-guarded (convention 8):** read back every created/updated issue's `projectId` against the destination ID; abort loudly on mismatch; never fabricate an ID.
- **Watermark only via the `.mjs` helper** (fs write), never a `Write`/`>` to the dotfile (sensitive-file prompt freezes the cron).
- **An empty lens is "no signal," not an invented finding** (`craft/judgment.md`): don't manufacture a recommendation to fill a section.
- One invocation = one review pass. `--dry-run` writes the report but no Linear + advances nothing; it overrides `--yes`.
