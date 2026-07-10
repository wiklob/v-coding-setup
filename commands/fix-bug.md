---
description: Repro-first routed execution path for a bugs-bucket (route:fix-bug) ticket — read the origin conversation first, reproduce the bug as the pass/fail oracle, fix only on a live repro, prove the repro gone, then hand to the full /land-ticket. Drops the scope plan + design thesis-check; keeps /build §4.6 read-back, convention-8 no-fabrication, and an unchanged /land.
argument-hint: "[ISSUE-ID]  (omit when already in the ticket's worktree — resolves the active ticket)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, mcp__linear, Skill, Agent
---

# /fix-bug — repro-first path for a routed bug ticket

The execution path for a `route:fix-bug` ticket: **`ingest-origin → reproduce → fix → prove-repro-gone → /land`**. It is a **peer of the `/scope`+`/build` pair** on the routed branch (V-220) — invoked *instead of* them for bug tickets — and ends in the full, unchanged `/land-ticket`.

Read `~/.claude/workflow-conventions.md` first (esp. conventions 8 and 9) and `~/.claude/craft/README.md` (the judgment substrate; for the §3 fix's "is this done?" self-check, load `~/.claude/craft/judgment.md`). (**Under `/go`**, `workflow-conventions.md` + the active profile are already in context from the chain's top-of-run read — skip that re-read per the `read-discipline` knob (V-293); a standalone `/fix-bug` reads them here.) The design rationale this command implements lives in `docs/fix-bug-path-design.md` (V-221).

**Why this shape.** Today every ticket — a one-line harvested bug included — runs the identical `next → scope → build → land` chain, which trusts the ticket's framing, has **no reproduction step**, and reads the origin transcript only as a *last resort* when about to discard the ticket (`next-ticket.md §6`). For a bug that is the wrong shape: the origin conversation is the richest truth, and a reproduction — not an adversarial design review — is the correct oracle for a fix. So `/fix-bug` **inverts** the origin read to the first step and makes the repro the pass/fail gate, dropping the scope plan and the `/build §3.5` design thesis-check (a repro-gated fix has no feature-design to red-team). The irreducible safety core is kept by routing through the full, unchanged `/land-ticket` and by carrying `/build §4.6` read-back + convention-8 no-fabrication into the fix step.

## When this runs

`/next-ticket` §5 routes a ticket to `fix-bug` (route precedence: `route:fix-bug` label > bugs-bucket `projectId === cfg.bugBucket.id` > … ). `/go` consumes that route and runs `/fix-bug` in place of `/scope`+`/build`. You can also invoke it directly on an In-Progress bug ticket. It does **not** re-decide the route — `next-ticket.md §5` is the single source (a ticket with no recorded `Route:` defaults to `build`, i.e. it would not reach here).

## §0. Load + resolve

- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). Note `bugBucket.id`.
- Resolve the **active ticket**: `$ARGUMENTS` if an ISSUE-ID (one `get_issue`), else the worktree's bound ticket (standalone binding `linearIssue`, or the In-Progress ticket of the bound project). Confirm it is In Progress.
- Confirm the route is `fix-bug` — the `Route:` line on the step-4 Linear comment, or the bugs-bucket membership (`ticket.projectId === cfg.bugBucket.id`). If the ticket is plainly **not** a bug (a feature ticket reached here by mistake), STOP and redirect to `/scope`/`/build` — `/fix-bug` is the wrong path.
- **Resolve the origin handle** in the `next-ticket.md §6` resolution order (first found wins): the ticket's `conversations:` line, else its `sessions:` line (the `harvest-pipeline-bugs.md §5` format), else a `/capture` `Source:` pointer, else a stated provenance pointer (e.g. a `report-bug` `errors.jsonl` entry). Record which handle (if any) you found — §1 consumes it.

## §1. Ingest origin (first)

The inversion of `next-ticket.md §6`'s last-resort read: read the origin conversation **up front**, before deciding anything, because it is the richest truth about a harvested bug.

- With a handle: `/ingest-convo <handle>` via `Skill` (take the id from the `conversations:` line, else the `sessions:` line). Read the Occurrence + the originating discussion into context.
- **Degrade safely** (per `next-ticket.md §6`'s degrade rules — never block, loop, or error):
  - **No handle** (older harvest entry that carried neither `conversation` nor `session`, or a non-harvested bug) → say so (`no origin handle on this ticket — proceeding from the ticket prose`) and continue from the ticket's own description.
  - **Handle present but transcript unrecoverable** (GC'd / `/ingest-convo` resolves nothing) → say so (`origin transcript <id> unrecoverable (GC'd) — proceeding from the ticket prose`) and continue.
- Now hold the best available understanding of *what actually went wrong* — carry it into the repro.

## §2. Reproduce (the oracle)

Build a **reproduction** of the bug from the ticket's Occurrence + the origin context. The repro is the pass/fail oracle for the whole path: a fix is meaningless until the bug is reproduced, and proven only when the repro stops reproducing (§4). Make it as cheap and deterministic as the bug allows (a failing test, a script, a documented command sequence with observed output — observe, never assert, per convention 8). Three outcomes:

- **(a) reproduced** — the bug occurs as described (or close enough to be the same defect). Record the exact repro (so §4 can re-run it) and proceed to **§3**.
- **(b) can't-reproduce** — the bug does not occur and looks **made-up / non-reproducible**. This is the V-137/V-191 made-up branch reached **early** (not as a last resort — §1 already read the origin). Re-decide from the transcript you ingested: either **close** the ticket citing the transcript (the premise was phantom), or **re-scope** with the recovered nuance if the real bug is different from the ticket's framing. **No fix on a bug you cannot reproduce.**
- **(c) stale-but-real** — the bug was genuine but **no longer occurs** (fixed upstream, code moved, dependency bumped). **Close** citing the transcript and the evidence that it is now inert.

**Outcomes (b)/(c) are a close/re-scope decision — gate it (convention 11).** Cancelling or re-scoping a ticket is irreversible/again-significant and the conclusion rests on a judgment ("I couldn't reproduce it"). Surface it as a `needs input:` confirm gate, leading with the ticket goal:
  `<TICKET-ID>: <one-line goal>`
  `needs input: <can't-reproduce | stale-but-real> after reading the origin transcript — proposing to <close citing the transcript | re-scope to <X>>. Reply to proceed, or correct the repro / outcome / disposition.`
Under `/go` this is a confirm gate driven by the one-token protocol (`p` = the proposed close/re-scope; anything else is an instruction). Do not auto-close a ticket. On `close`, set the Linear state to Canceled (made-up) or Done (stale-but-real, recording it inert) with a comment citing the transcript; the path ends here (no §3/§4, no `/land` of a code change). On `re-scope`, hand back to the human with the recovered framing.

## §3. Fix (repro-gated)

Only on outcome **(a)**. Implement the fix against the reproduced defect.

- **No scope plan, no §3.5 thesis-check** — the repro is the oracle, not an adversarial design review. Plan inline only as much as the fix needs.
- **Keep `/build §4.6` external-mutation read-back (convention 8).** If the fix mutates live/external state (a provider POST/PUT, a dashboard/API call, a resource created in Supabase/Grafana/Cloudflare), **read the artifact back with its real returned id and assert it exists** before claiming the mutation succeeded — never report the intent. This gate has no effect on a pure code/markdown fix; it fires only when the fix actually mutates external state.
- **Keep the convention-8 no-fabrication hard rules** verbatim: never claim a created/POSTed artifact done/active without reading it back; never fabricate an identifier to fill a slot; never swallow a non-2xx response body.
- Self-critique the fix against `craft/judgment.md`'s `## Constraints` + `## Anti-Patterns` before calling it done.
- Commit per `/build`'s style (a focused commit referencing the ticket).

## §4. Prove the repro gone

Re-run the **exact** reproduction recorded in §2. It must now **fail to reproduce** — the oracle flips from reproduces → doesn't. Observe the result (convention 8); do not assert it. This is the bug-specific verify that replaces the generic design review.

- If the repro still reproduces, the fix is incomplete — return to §3 (do not proceed to §5 on a still-failing oracle).
- `/verify-tests` may still run for **regression coverage** (a test that locks the fix in), scoped to what changed — but the repro flip is the primary proof.

## §5. Hand off → /land-ticket

Hand to the **full, unchanged `/land-ticket`**. Its diff-driven gates — §4.8 migration/`invariant` and §4.6 security — are route-invariant, so the irreducible safety core holds even though the scope plan + design thesis-check were dropped. Push as `/build` does (or let `/land` open the PR). Do **not** modify `/land-ticket`'s behavior for this route; `/fix-bug` ends by handing the reproduced-and-proven fix into the standard land flow.

## Degrade & safety summary

- Origin read degrades to ticket prose when no handle / GC'd — never blocks (§1).
- A bug that cannot be reproduced is never "fixed" — outcomes (b)/(c) close or re-scope behind a confirm gate (§2).
- Convention-8 read-back + no-fabrication are kept inside the fix (§3); they are never route-relaxable.
- The full `/land-ticket` carries the diff-driven migration/security floor (§5).
