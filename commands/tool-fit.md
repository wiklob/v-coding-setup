---
description: Tool-fit lens — grade a past session's pipeline steps (scope / recon / build) as right-sized | overkill | underdelivered with one-line evidence, flag ceremony steps, append one aggregable verdict record per session to pipeline/audit/tool-fit.jsonl for the MA5 scorecard.
argument-hint: "[TICKET-ID | --session <id>]  (defaults: resolve the session from the ticket)"
allowed-tools: Bash, Read, Grep, Glob, mcp__linear, Agent
---

# /tool-fit — did each pipeline step earn its cost?

Read `~/.claude/workflow-conventions.md` first. Lens **(b)** of the *Pipeline self-review* loop: a per-session **judgment** lens that asks, for one session, whether each pipeline step earned its cost — was `/scope` necessary or ceremony? was `/research` overkill for the ticket? did `/build` underdeliver against the Acceptance?

**Advisory, never a gate.** Like `/review-pr`, this lens *informs* — it never blocks, merges, or changes Linear state. Its only write is one appended line to its sink (§4). Be fact-rooted: every verdict cites a concrete signal (a file, a count, a diff item) or is dropped — no speculative grading.

## What it is NOT
- Not a token census — that's lens (c) / `usage-stats.mjs` (A3); this lens *consumes* that census as one input.
- Not a correctness/code review — that's lens (e) / `/review-pr` (A4); this lens grades *tool fit*, not the code.
- Not interactive — it runs autonomously over a finished session and emits one record.

## Load config + resolve the session
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (`linearTeam`, `scopeLabel`, `baseBranch`).
- Resolve the target session **without bulk-loading any transcript** — route all transcript access through the existing redacting/streaming scripts:
  - `$ARGUMENTS` is `--session <id>` → that session; derive the ticket from it.
  - `$ARGUMENTS` is a `TICKET-ID` (the default) → `node ~/.claude/bin/transcript-resolver.mjs resolve <TICKET-ID> --json` → take the top-ranked `session_id` / `jsonl_path`. (`--session` of `/tool-fit` pins a non-top session when the ranking is wrong.)
  - Neither resolvable → STOP, `result:` naming what was missing. One session per invocation.

## 1. Gather evidence (read-only, redacted, no bulk transcript load)
Collect the mechanical signals the verdict rests on — never re-implement transcript reading:
- **Transcript shape** — `node ~/.claude/bin/session-review.mjs --session <id> --json` (tool census + Lens-B correctness flags: error-swallow, failed-then-claimed) and/or `transcript-resolver.mjs read <id> --json` (message/tool counts). Redaction + streaming are already solved there.
- **Token/tool census** — the `usage-stats.mjs` record for the ticket at `$root/.claude/usage-stats/<…>-<ticket>.json` (read the latest if present; else `node ~/.claude/bin/usage-stats.mjs --ticket <ID> --dry-run` to compute without writing). Use `totals.output`, `tool_calls`, `compound_bash`, `failed_calls` as cost/thrash signals.
- **Gate ledger** — `grep -i "<TICKET-ID>" pipeline/audit/gate-audit.md` for the `/go` run's gate resolutions (forced halts, intervened gates) on this ticket, if any.
- **Acceptance** — one `mcp__linear get_issue <TICKET-ID>`: its `## Acceptance` checklist (the build-delivery contract) + whether the parent project is parallel/standalone.
- **Scope plan** — `docs/plans/<ticket-id-lowercased>-build.md` (lowercase, the canonical casing): does it exist (did `/scope` run)? does it carry a `## Prior art & standards` section (did `/research` run)? what does its "Pre-build validation" say each item's artifact-kind is?
- **The diff** — `git -C "$root" diff --name-only origin/<baseBranch>...HEAD` (or `gh pr diff <n> --name-only` for a landed PR) to judge what `/build` actually produced vs the Acceptance.

## 2. Grade each step (the rubric)
Reconstruct the three pipeline steps for the session and emit, per step, one of `right-sized | overkill | underdelivered` (or `n/a` when the step correctly did not run), each with **one line of evidence** citing a signal from §1.

The scope-necessity criteria are **not restated here** — `commands/next-ticket.md` §5 is their single source (restating risks the two drifting, the exact failure convention 5 / `/research` warn about). Grade *against* that rubric:

- **`scope`** —
  - `overkill` — `/scope` ran on a ticket the §5 rubric would have said *skip* (≤5 well-specified items, no sensitive-path/external-service/migration/unverified-premise signal) **and** the diff doesn't follow the plan's implementation steps (the plan was written then ignored).
  - `underdelivered` — `/scope` was skipped (or written thin) on a ticket that *tripped* §5, and `/build` then floundered (high `failed_calls`, rework commits, a mid-build `needs input`).
  - `right-sized` — ran when §5 said scope and the diff follows its steps, or correctly skipped on a skip-eligible ticket (then emit `n/a` for the run, `right-sized` for the call).
- **`recon` (`/research`)** —
  - `overkill` — a `## Prior art & standards` brief was produced for a ticket that merely follows an existing in-repo pattern (existing code was the prior art).
  - `underdelivered` — a net-new surface shipped (new dependency / novel capability / security-crypto surface) with **no** recon brief.
  - `n/a` — correctly skipped for a pattern-following ticket; `right-sized` — ran for a genuinely net-new surface and the chosen approach landed in the plan/diff.
- **`build`** —
  - `underdelivered` — the merged diff misses Acceptance items: an item's artifact-kind (`code`/`migration`/`invariant`/… per the scope plan or `scope.md` §3) is absent from the diff (a `migration` item with no migration; an `invariant` item with no encoded proof of the negative). Cite the unmet item.
  - `overkill` — the diff ballooned well past the Acceptance (large unrelated blast radius, scope creep beyond the items) — cite the file count / lines vs the item count.
  - `right-sized` — every Acceptance item's artifact is present and the diff stays scoped to them.

## 3. Flag ceremony candidates
A step is a **ceremony candidate** when it **ran but produced no downstream value** — the build-chain analogue of a perennially-`p'd` gate in `gate-audit.md`. Mark `ceremony: true` with evidence when, e.g.:
- a `/scope` plan exists but the diff ignores its implementation steps (planned, then unused);
- a `## Prior art & standards` brief was produced but never threaded into the approach/diff;
- a step's output is referenced by nothing later in the session.
Ceremony is orthogonal to the verdict (an `overkill` step is usually also ceremony; a `right-sized` step never is). One ticket can't prove a step is dead weight — the sink (§4) is what lets a later reader see a step that is *perennially* ceremony across sessions.

## 4. Emit — human report + one aggregable record
**Print** a terse report first (review-pr style), then **append exactly one line** to the sink.

Report:
```
/tool-fit <TICKET-ID> · session <id>
- scope  — <VERDICT> (<ran|skipped>) — <evidence>
- recon  — <VERDICT> (<ran|skipped>) — <evidence>
- build  — <VERDICT> (<ran|skipped>) — <evidence>
Ceremony candidates: <step(s) | none>
```

Sink — `pipeline/audit/tool-fit.jsonl`, one self-describing JSON object per session, keyed `ticket`+`session`, mirroring the `errors.jsonl`/`feedback.jsonl` envelope (`ts`, `session`) so the **MA5 scorecard** aggregates it by line without a bespoke parser. **Append via the sanctioned helper — never a bare `mkdir pipeline/audit`.** A `mkdir -p pipeline/audit` (or any command whose text names the sink path) trips the sensitive-file permission prompt on the guarded `pipeline/audit` tree; `bin/log-audit-record.mjs` buries the path inside the script (allow-listed by `Bash(node ~/.claude/bin/*.mjs)`), creates the dir with its own `mkdirSync`, stamps `ts` from a real clock when omitted, and redacts secret-shaped free-text — so the append raises no prompt (conventions 5, 7, 8). Build the record with a real serializer (never hand-assembled JSON — convention 8B) and pipe it in:
```bash
python3 -c 'import json; print(json.dumps({ "lens": "tool-fit", "ticket": "<ID>", "session": "<session-uuid>", "steps": [ ... ] }))' \
  | node ~/.claude/bin/log-audit-record.mjs --sink tool-fit.jsonl
```
The record schema (one line in the file; `ts` is stamped by the helper when omitted — never fabricate one, convention 8):
```json
{ "lens": "tool-fit", "ticket": "ENG-78", "session": "<session-uuid>", "ts": "<ISO8601>", "steps": [ { "step": "scope", "ran": true, "verdict": "right-sized", "ceremony": false, "evidence": "tripped next-ticket §5 (ambiguous premise, unbuilt MA5 contract); diff follows the plan" }, { "step": "recon", "ran": false, "verdict": "n/a", "ceremony": false, "evidence": "skipped — pattern-following, in-repo prior art" }, { "step": "build", "ran": true, "verdict": "underdelivered", "ceremony": false, "evidence": "acceptance item 3's artifact absent from diff" } ] }
```
The sink is gitignored by `pipeline/audit/`'s `*.jsonl` rule (per-machine runtime data, redacted-but-not-source) — only the README registers it.

## Hard rules
- **Advisory, read-only except the one sink append.** No `Edit`/`Write` to source, no merge, no Linear-state change (`allowed-tools` already forbids edits). Verdicts are inputs to the scorecard, never gates.
- **Never bulk-load or dump a transcript.** All transcript access goes through `transcript-resolver.mjs` / `session-review.mjs` (redaction + streaming already solved); a fresh reader re-opens the secret-leak surface those scripts close.
- **Evidence or drop.** Every step verdict cites a concrete §1 signal (file, count, diff item) — no speculative grading, no padding.
- **Never fabricate an identifier or timestamp.** `session`, `ts` come from real resolution / `date`, never invented to fill a slot (convention 8).
- **Don't restate the scope rubric** — reference `next-ticket.md` §5; it is the single source.
- One session per invocation.
