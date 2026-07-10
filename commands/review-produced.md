---
description: Retrospective produced-code review of one landed ticket — merged diff vs each Acceptance item (met/partial/missed) + a quality verdict (clarity, reuse, over/under-engineering) with evidence. Prints the review and appends a structured record to pipeline/audit/produced-review.jsonl for the MA5 scorecard. Read-only on source.
argument-hint: "<TICKET-ID>  (a landed/merged ticket, e.g. ENG-76)"
allowed-tools: Bash, Read, Grep, Glob, mcp__linear
---

# /review-produced — retrospective produced-code review (lens e)

Reviews the **code that actually landed** for one ticket: the merged diff judged against each Acceptance item, plus a quality lens (was it *good* code, not merely passing). This is lens (e) of the Pipeline self-review loop; its output is one of the four lenses the MA5 scorecard rolls into a per-ticket verdict.

**Retrospective, not advisory.** Distinct from its two siblings:
- `/review-pr` — **pre-merge** advisory review of an open PR (blocks/informs the merge).
- `/review-session` — **post-land** review of the *session* (routing, tool-fit, correctness of the pipeline's own work) — analyzes the transcript, **not the merged code**.
- `/review-produced` (this) — **post-land** review of the *merged code itself* against what the ticket promised, feeding the scorecard.

Read `~/.claude/workflow-conventions.md` first (esp. convention 8 — observed state over asserted: every verdict cites a real diff hunk, never speculation). This skill **reviews only — never edits source, never merges, never changes Linear state.** Its one write is an append to the audit sink (§4).

## Load config + resolve the landed ticket

- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (`scopeLabel`, `baseBranch`).
- `$ARGUMENTS` = the ticket ID (required). No ID → STOP, ask for one.
- `mcp__linear get_issue <ID>` — capture title, the `## Acceptance` checklist, state, `gitBranchName`, and `attachments`.
- **The ticket must be landed.** It should be Done/merged. If its state is not Done (and no merged PR is found below), STOP: `result: <ID> is not landed (state: <state>); /review-produced reviews merged code. Use /review-pr for an open PR.`

### Resolve the merged PR + diff (robust order — never guess a PR number)
Try in order until one uniquely resolves; per convention 8B never fabricate a PR number to fill the slot:
1. **Linear attachment** — a `github.com/.../pull/<n>` URL in the issue's `attachments`.
2. **Branch name** — `gh pr list --head "<gitBranchName>" --state merged --json number,url,title,mergeCommit -q '.[0]'`.
3. **ID search** — `gh pr list --search "<ID>" --state merged --json number,url,title,mergeCommit`.

If none resolve, or >1 distinct merged PR matches and you can't disambiguate from the ticket, STOP with `needs input: could not uniquely resolve the merged PR for <ID> — candidates: <list or none>. Name the PR#.`

On a resolved PR `<n>`:
- `gh pr view <n> --json number,title,url,state,mergedAt,mergeCommit,baseRefName,additions,deletions,files`
- `gh pr diff <n> --patch` (full unified diff) and `gh pr diff <n> --name-only` (changed paths).

## 1. Read the landed code (ground truth)
- For each non-trivial changed file, read the **merged state** of the file (not just the diff context — surrounding code reveals whether a change is clean or a hack). Skip lockfiles, generated output, vendored dirs.
- Read repo `CLAUDE.md` + `.claude/rules/*.md` once — they are the convention contract; violations are quality findings.
- If the diff is very large (≳1500 changed lines or >25 non-trivial files), read the highest-risk files first and **state which files you did not read** in §3's Coverage line. Don't pretend full coverage.

## 2. Acceptance vs merged diff (three-valued, cited)
For **each** item in the ticket's `## Acceptance` checklist, emit one verdict with `file:line` proof drawn from the actual diff:
- **met** — the diff fully delivers the item; cite the hunk(s) that prove it.
- **partial** — the item's intent is addressed but incompletely: a gap, a TODO, a narrower scope than the item states, or delivered for some cases but not all. Name the gap.
- **missed** — no diff delivers the item, or what landed contradicts it. Cite "not in diff" or the contradicting hunk.

Rules:
- A verdict of **met with no citable hunk is itself a partial/missed signal** — if you cannot point at the diff, the item was not demonstrably built (convention 8A applied to your own claim).
- Honor artifact-kind the same way the rest of the flow does: a `migration`/`dashboard-config`/`manual-verify`/`invariant` item is **met only by its real artifact** (a migration file; an encoded proof of the negative for `invariant`) — enforcement code alone does not make an `invariant` item met. If the ticket has a `docs/plans/<id-lowercased>-build.md`, read its Pre-build validation section for the recorded kinds.

## 3. Quality verdict (was it *good* code, not just passing)
Beyond met/missed — judge the **quality** of what landed, each dimension carrying concrete evidence (a cited hunk), terse:
- **Clarity** — names, structure, comments that match the code, readable control flow. Misleading names / comments that lie / dead code are findings.
- **Reuse** — did it reuse existing helpers/patterns, or duplicate/reinvent? Cite the existing thing it should have used, if any.
- **Engineering fit** — over-engineered (premature abstraction, unused generality, ceremony) or under-engineered (copy-paste, missing obvious factoring, fragile shortcut)? Name which and cite it.
- **Convention adherence** — cite the specific `CLAUDE.md` / `.claude/rules/*` line any violation implicates (not personal preference).

End §3 with a **Coverage** line: what you did NOT cover (files skipped on a large diff; "did not run the code/tests — verdicts are from reading the merged diff").

## 4. Emit — print, then append the scorecard record
1. **Print the full review** to the user: Summary (1–3 lines: what landed, PR#, scope) → Acceptance verdicts (§2) → Quality verdict (§3) → Coverage.
2. **Append one JSONL record** to `pipeline/audit/produced-review.jsonl` (gitignored by the existing `/pipeline/audit/*.jsonl` rule — global to the main checkout, same as the other sinks) **via the sanctioned helper — never an inline append that names the sink path.** A `node -e`/`python3 -c` whose command text names `pipeline/audit/…` (or a bare `mkdir pipeline/audit`) trips the sensitive-file permission prompt on that guarded tree; `bin/log-audit-record.mjs` buries the path inside the script (allow-listed by `Bash(node ~/.claude/bin/*.mjs)`), creates the dir with its own `mkdirSync`, stamps `ts` from a real clock when omitted, and redacts secret-shaped free-text — so the append raises no prompt (conventions 5, 7, 8). Build the object with a **real JSON serializer** (`node -e` / `python3 -c` — never hand-assemble JSON strings, convention 8B) and pipe it to the helper:
   ```bash
   python3 -c 'import json; print(json.dumps({ ... }))' \
     | node ~/.claude/bin/log-audit-record.mjs --sink produced-review.jsonl
   ```
   Schema:

   ```json
   {
     "ts": "<ISO8601>",
     "session": "<session_id|null>",
     "subject": "review-produced",
     "ticket": "<ID>",
     "pr": <number>,
     "mergeCommit": "<sha|null>",
     "acceptance": [
       { "item": "<verbatim acceptance text>", "verdict": "met|partial|missed", "evidence": "<file:line | 'not in diff'>" }
     ],
     "quality": {
       "clarity": "<one-line verdict>",
       "reuse": "<one-line verdict>",
       "engineering": "<over|under|fit> — <one line>",
       "conventions": "<clean | rule violated: <rule>>",
       "notes": "<short overall>"
     }
   }
   ```

   `subject: "review-produced"` keys the record for the scorecard exactly as `feedback.jsonl` keys off `subject`; `ticket` is the per-ticket join key the scorecard's rollup groups on. Keep `subject` byte-stable — the scorecard matches on the literal string.

   **Redaction.** Evidence strings are short `file:line` citations + brief quotes; in a repo whose diffs may carry secrets, the append helper passes every free-text leaf through the same `redact()` the other sinks use (`bin/transcript-resolver.mjs`) — so secret-shaped tokens are masked automatically and you run no separate redact step. Citations themselves (paths/line numbers) are safe and pass through untouched.

### Worked example record
A real entry as written by this skill (pretty-printed here; one line in the file):
```json
{ "ts": "2026-06-03T16:00:00.000Z", "session": "abc123", "subject": "review-produced", "ticket": "ENG-76", "pr": 54, "mergeCommit": "c92fe0e", "acceptance": [ { "item": "build calls usage-stats.mjs with a valid --session arg", "verdict": "met", "evidence": "commands/build.md:147" }, { "item": "no BadShort error on land", "verdict": "partial", "evidence": "bin/usage-stats.mjs:31 — guards empty but not malformed id" } ], "quality": { "clarity": "clear — arg flow is explicit", "reuse": "reused existing arg-parse helper", "engineering": "fit — minimal targeted change", "conventions": "clean", "notes": "tight fix; one residual edge left as partial" } }
```
The scorecard ingests this as lens (e): per-ticket it shows acceptance met/partial/missed + the quality verdict; aggregated it counts partial/missed rates and recurring quality smells across tickets.

Emit `result:` on its own line: `result: /review-produced <ID> — acceptance <met>/<partial>/<missed>, quality <one-word overall>; record appended to pipeline/audit/produced-review.jsonl.`

## Hard rules
- **Review-only on source.** No `Edit`/`Write` to code, no merge, no Linear-state change. The single write is the append to `produced-review.jsonl` (§4). Describe fixes in prose; don't patch.
- Every verdict cites a real `file:line` against the merged diff/file you read. No speculative findings, no "consider whether…" filler.
- Never fabricate a PR number or a merge SHA — they come from `gh`/Linear responses only (convention 8B). Can't resolve → STOP and surface.
- Don't run the landed code or its tests — verdicts are from reading the merged diff; say so in Coverage.
- Be terse. A clean dimension is one line; absence of findings is fine, padding is not.
- One ticket per invocation.
