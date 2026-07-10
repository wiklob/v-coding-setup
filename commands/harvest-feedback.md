---
description: Harvest the feedback.jsonl subjective-feedback sink into routed action — read the single feedback log since a watermark, cluster by subject, judge EMPHASIS (a re-mention is signal, not dedup-noise), route each cluster (craft-revision / pipeline-ticket / bug / drop), auto-file the bug/pipeline routes + propose the craft ones, mark every artifact review-mode. The standing consumer of the feedback sink; daily launchd schedule + on-demand.
argument-hint: "[--yes] [--all] [--dry-run] [--since <ISO8601>]"
allowed-tools: Bash, Read, Grep, mcp__linear
---

# /harvest-feedback — turn subjective feedback into routed action

The **one** consumer of the `feedback.jsonl` sink. Captured `/report-feedback` impressions rot if nothing reads them; this is the standing reader that clusters the log and acts on it — **auto-filing** the objective routes (bug / pipeline-ticket) into their buckets and **proposing** the craft-revision route for a human `/review-skill`. Runs on demand and via a daily local **launchd LaunchAgent** (`claude -p "/harvest-feedback --yes"`, installed by `bin/install-feedback-harvest-launchd.sh`). It must run **locally** — the log is a per-machine file.

Read `~/.claude/workflow-conventions.md` first (esp. conventions 4 + 8), then `~/.claude/craft/README.md` and `~/.claude/craft/governance.md` (the routing taxonomy + the **emphasis-over-count** decision this command embodies), and `~/.claude/pipeline/decision-ledger.md` (the cross-project decision ledger, V-307 — so a routing/craft judgment reasons with the deliberate prior decisions, not blind; a re-mention that restates a decision the repo already settled routes to `drop`, not a fresh ticket). The sibling of `/harvest-pipeline-bugs` — it reuses that command's read→cluster→dedupe→report skeleton, with **two deliberate divergences** the feedback domain forces (below).

**Why this is not the bug harvester (the two divergences):**
1. **Emphasis over count (§3).** For *bugs*, a re-occurrence is noise to dedup. For *feedback*, a re-mention is **signal** — urgency, mounting annoyance, or "what I said before wasn't precise enough." So this command does **not** dedup-and-drop a re-mention; it reads the cluster's notes and lets **emphasis** drive priority, and it **updates** an already-filed item instead of dropping the re-mention. This is the mechanized form of `craft/governance.md` §41 trigger (a): the old **N≥3 count floor is replaced by emphasis judgment** — a single strong or precise impression registers; the user should not have to repeat themselves three times for feedback to count.
2. **Propose, don't auto-retire, for craft (§4).** The objective routes (bug / pipeline-ticket) auto-file; the **craft-revision** route is *proposed* (surface a `/review-skill`), never acted on unattended — `governance.md`'s "a wrong auto-retire is worse than a slow manual one" still governs the irreversible judgment even after the *surfacing* is mechanized.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`. Missing → `/ticket-flow-init`, STOP.
- Required: `scopeLabel`, `standaloneProject` (the pipeline-ticket destination — "Standalone (V)"), `bugBucket` (`{ name, team, id }` — the bug destination). Resolve each destination to a project **ID** once (prefer the pinned `bugBucket.id`; for `standaloneProject` resolve the name to an id via one `get_project` and reuse it) and use the ID for every dedupe + filing call — a display-name rename resolves to *no project* without erroring, silently orphaning filings.

## The sink (single source — read only this)
- **Log path is absolute, main-checkout:** `~/.claude/pipeline/audit/feedback.jsonl` — global, gitignored, per-machine (`pipeline/audit/README.md`). Never read a worktree-relative copy (gitignored-empty). The reader helper resolves the real path from its own `bin/` location.
- **Entry shape (verified at `bin/log-feedback.mjs`):** `{ ts, session, conversation, subject, note }`. `subject` is the command/topic the feedback is about (leading slashes stripped; **may be `null`** — ~20% of entries). `note` is the verbatim impression, already `redact()`-ed. `conversation` is the resume-chain root (the thread); `session` the run. This is the **single** feedback source — do not ingest errors.jsonl (that is `/harvest-pipeline-bugs`' sink) or session-review reports.

## 1. Read the new entries
- **Stream via the sanctioned reader — never a whole-file `Read`:** `node ~/.claude/bin/read-feedback-since.mjs` (allow-listed via `Bash(node ~/.claude/bin/*.mjs)`), which emits only entries with `ts >` the cutoff. Cutoff by flag:
  - `--since <ISO8601>` → `node ~/.claude/bin/read-feedback-since.mjs --since <ISO8601>`.
  - `--all` → `--since 1970-01-01T00:00:00.000Z` (reconsiders the whole log; safe — §5 dedupe/update prevents double-filing).
  - else → no flag (the helper reads `~/.claude/pipeline/audit/.feedback-watermark` itself; absent → epoch).
- Capture stdout as the new-entry set. 0 new entries → report "nothing new since `<watermark>`; re-run with `--all` to reconsider." STOP (advance nothing). The watermark is an **optimization**, not the correctness guard — §5's dedupe/update is.

## 2. Cluster (by subject, then note-shape)
Group the new entries by **`subject`** (the command/topic), then within a subject by **normalized note-shape** (strip volatile fragments — paths, timestamps, redaction tokens; collapse whitespace; keep a stable leading slice — the same normalization `/harvest-pipeline-bugs` §4a applies). One cluster = one *topic-grievance*, across however many entries voiced it.
- **Null-subject entries** (`subject: null`) cannot key on a command; cluster them by note-shape alone into an **"unsubjected" bucket** and surface it for a human glance in the digest — never force-route a subjectless impression.
- `subject` is the cluster key, **not** a divider that splits one grievance: two notes about the same `subject` with the same shape are one cluster, however many times said. Recurrence is counted (it feeds §3's emphasis), never used to split.

## 3. Emphasis-aware pass (the divergence — read the notes, judge intensity)
This is where feedback parts ways with the bug harvester. **Do not dedup-and-drop.** For each cluster, read its notes **in time order** (oldest→newest) and judge the **emphasis pattern** — what the recurrence (or a single sharp note) *means*:
- **urgency** — the same point pressed again → the user wants it sooner. Raise priority.
- **annoyance** — escalating tone across the notes → friction that's wearing; weight it up.
- **refinement** — a later note more specific than an earlier one → the earlier capture (or its filed ticket) was imprecise; carry the **sharper** framing forward, don't keep the vague one.
- **count is an input, not a gate** (governance §41, mechanized): a single strong or precise impression is enough to act on; recurrence *raises confidence* but is never required. A user should not have to say a thing thrice for it to register.
Record, per cluster: the mention count, the emphasis verdict, and (for the digest) a one-line `subject:X — Nth mention, <emphasis>`. This judgment is what the LLM harvest pass exists to do — a count threshold can't read tone or precision; reading the actual notes can.

## 4. Route + weight each cluster
Assign exactly one route, grounded in `craft/governance.md` **and `~/.claude/pipeline/decision-ledger.md`** (load both — the harvest pass reasons *with* the design context, not blind: governance.md gives the routing taxonomy, the decision ledger gives the deliberate cross-project decisions already settled, so feedback that pushes back on a recorded decision is weighed against it rather than re-filed as if new):
- **craft-revision** — `subject` resolves to a craft rail or a command's judgment step, and the cluster is craft-implicating (the note is about *how the work felt / read*, e.g. "`/scope`'s verdict read like box-ticking"). → **propose** `/review-skill <subject>` (+ the candidate `Status` direction: reinforce / retire). **Surfacing keys on the §3 emphasis judgment, not a count floor** — a single strong/precise craft impression qualifies. **Never auto-retire a rail** (the irreversible judgment stays human).
- **pipeline-ticket** — an actionable command/skill improvement that isn't a bug ("`/go` should print the route it picked"). → **auto-file** a ticket into `standaloneProject` ("Standalone (V)").
- **bug** — the impression is actually an objective failure ("`/land` crashed on the migration step"). → **auto-file** into the `bugs` bucket (it belongs in the bug loop).
- **drop** — praise / noise / a one-off below any actionable bar (the unsubjected bucket usually lands here unless it's clearly actionable). → no filing; the watermark still advances past it.

Weight (→ priority + digest ordering): emphasis-high (urgency/annoyance/refinement on a real grievance) → High; a single mild impression → Medium/Low; the §3 emphasis verdict is the weight.

## 5. Dedupe + UPDATE filed routes (re-mention is a bump, not a drop)
For the auto-file routes (bug / pipeline-ticket), key each cluster with `feedback-key: <route>:<short-hash of the normalized note-shape>` (carried on the filed ticket's body, the dedupe handle — the `harvest-key` pattern). Then, against open tickets in the destination (`list_issues` `project: <destId>`, `state` in `[Todo, Backlog, In Progress]`):
- **No open ticket with the key** → file a new one (§6).
- **An open ticket already carries the key** → **do NOT drop the re-mention** (the feedback divergence): `save_comment` on that ticket with the new mention + the §3 emphasis verdict ("3rd mention, escalating — now also: <new note>"), and **re-rank its priority up** if emphasis rose; on a **refinement**, sharpen the ticket's title/body to the more precise framing. Count the update; report it.
For the **craft-revision** route, dedupe a *proposal* against an already-open `/review-skill`-candidate note for the same subject the same way — a standing proposal is bumped, not duplicated.

## 6. Surface + act (gated by mode)
For each surviving cluster, build a digest line: `subject · route · emphasis (Nth mention) · weight · one-line note · action (file new / update <ID> / propose /review-skill / drop)`.
- **Interactive (default):** print the full digest + the route tally + the dedupe/update counts. **Confirm gate (convention 11)** — a `needs input:` stop, no Linear writes until the human proceeds. `p` files the auto-file routes + posts the craft proposals as stated; anything else is an instruction.
- **`--yes` (the daily cron / headless):** skip the gate and act directly — **auto-file** bug/pipeline routes (dedupe/update from §5 is the correctness guard, not the gate) and **surface** craft-revision proposals (write them to the digest/log for a human `/review-skill`; never auto-act on a craft rail). Hold a quality bar: file only clusters that clear the genuine-signal bar; leave bare praise/noise unfiled (the watermark still advances past them).
- **`--dry-run`:** print the digest + STOP. Write nothing, advance nothing. `result: dry-run — <K> would file/update, <C> craft proposals, watermark unchanged.`
- **Filing (on go / `--yes`):** `save_issue` `team` + `project: <destId>` (the resolved ID, never a name), `labels: [<scopeLabel>]`, `priority`, the body (with the `feedback-key:` line + the origin handle `conversations:`/`sessions:` from the cluster's entries + a `## Acceptance` derived from the route), and the **review-mode marker** (§7). After each create/update **read back** the response and assert the returned `id` is real and `projectId === destId` (convention 8) — a mismatch → STOP loudly, do not advance the watermark.

## 7. review-mode marker (full — provenance of who surfaced it)
Every artifact this command touches records that a **machine** surfaced it, so a later reader can tell auto-surfaced from human-read signal (and weigh the loop's autonomy):
- **Filed/updated tickets** carry a `review-mode: auto` line in the body (a human `/report-bug`/`/report-feedback`-then-files-by-hand would be `review-mode: manual`).
- **Craft Status lines** this loop influences gain a `via:` marker when a `/review-skill` it proposed lands (`evidence: feedback.jsonl subject:scope · via: auto-harvest`), distinguishing an emphasis-surfaced review from a human-initiated one.
- The **digest** ends with a per-pass tally: `filed N · updated N · proposed N · dropped N · via auto`.

## 8. Advance the watermark + report
- Advance to the max `ts` of the harvested entries (or now, if all dropped) — **only on a real (non-dry-run) pass** — via the sanctioned writer: `node ~/.claude/bin/advance-feedback-watermark.mjs --ts <max-ts>` (the helper writes the dotfile via fs — never a `Write`/`>`, which trips the sensitive-file prompt and freezes the unattended cron).
- Report: filed (count + IDs), updated (count + IDs), craft proposals (count + subjects), dropped (count), the review-mode tally, watermark advanced to `<ts>`.
- **Next step (convention 4):** `/review-skill <subject>` for each craft proposal; `/bulk-fix --project "<bucketName>"` or `/next-ticket <ID>` for the filed tickets.

Emit `result:` on its own line: `result: /harvest-feedback — filed <F>, updated <U>, proposed <P> craft reviews, dropped <D> (review-mode: auto); watermark → <ts>. Next: /review-skill for craft proposals, /bulk-fix for filed.`

## Worked example (the encoded proof — test-less repo, a `--dry-run` transcript)

Three feedback entries land over two weeks, two of them the same grievance:

```
{"ts":"2026-06-10T09:00:00Z","subject":"scope","note":"/scope's validation verdict read like a box-ticking checklist, didn't say why anything was off"}
{"ts":"2026-06-18T14:00:00Z","subject":"scope","note":"again — the /scope verdict is just ticks, I can't tell what it actually judged. getting annoying"}
{"ts":"2026-06-21T08:00:00Z","subject":"go","note":"/go should print which route it picked, I had to dig"}
```

`/harvest-feedback --dry-run` produces:

```
subject:scope · craft-revision · 2nd mention, ANNOYANCE · High · "verdict reads like box-ticking, doesn't name why" · propose /review-skill scope (candidate: reinforce judgment rail)
subject:go    · pipeline-ticket · 1st mention · Medium · "/go should print the route it picked" · file new → Standalone (V)
Tally would be: filed 1 · updated 0 · proposed 1 · dropped 0 · via auto.
dry-run — 1 would file, 1 craft proposal, watermark unchanged.
```

Note the divergence working: the `scope` cluster is **not** dropped for being only the 2nd mention (the old N≥3 floor would have shelved it) — the emphasis read ("again… getting annoying" = ANNOYANCE) makes it a High craft-revision proposal at mention #2. A single strong note would have done the same. The `go` cluster auto-files (pipeline-ticket) without a count gate. Neither acts on a craft rail unattended — `scope` is *proposed* for a human `/review-skill`.

## Hard rules
- **Single source:** reads only `feedback.jsonl` (the absolute main-checkout path); never errors.jsonl, never session reports.
- **Emphasis over count:** a re-mention is signal — never dedup-and-drop a feedback re-mention; read the notes, judge intensity, and **update** an already-filed item rather than discarding the re-mention (the mechanized `governance.md` §41).
- **Propose, never auto-retire, for craft:** the craft-revision route is surfaced for a human `/review-skill`; auto-retiring/reinforcing a rail is never done unattended.
- **Auto-file is dedupe/update-guarded (convention 8):** read back every created/updated issue's `projectId` against the destination ID; abort loudly on mismatch; never fabricate an ID.
- **Watermark only via the `.mjs` helper** (fs write), never a `Write`/`>` to the dotfile (sensitive-file prompt freezes the cron).
- One invocation = one harvest pass. `--dry-run` writes nothing and overrides `--yes`.
