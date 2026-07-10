# Design: the `/fix-bug` routed execution path

> Status: design for V-221 (P2 of `docs/plans/differentiated-execution-paths.md`, Initiative II). Decision doc — records the *why* + the agreed *how* of `/fix-bug`. Reviewed at a convention-11 `[HARD STOP]` ack gate before the command was authored.

## Purpose

Specify `/fix-bug`, the routed execution path for `route:fix-bug` (bugs-bucket) tickets, so the build phase implements an agreed design rather than re-deriving it. Today every ticket — a one-line harvested bug included — runs the identical `next → scope → build → land` chain; the only bug-specific behavior is three safety gates keyed on `bugBucket.id` (V-137/V-191), used as a **last resort** when a session is about to give up. The chain trusts the ticket's framing and reads the origin transcript only when about to discard the ticket, and there is **no reproduction step at all**. `/fix-bug` is the lighter, truer shape: **origin-conversation-first, reproduction-as-oracle**, scope plan and design thesis-check dropped, the irreducible safety core kept via the full unchanged `/land-ticket`.

## Re-grounding verification (Acceptance #1)

The active profile is `opus-4-8`; its `re-grounding` knob is *re-verify planning-time findings against current code before building* (convention 12; the V-137 lesson). The parent plan's findings were authored before V-220/V-191 landed, so each load-bearing finding was re-checked against the **current** command files (worktree on `origin/main` = df04d50, newer than the stale local main checkout):

| Plan finding | Re-verified against current files | Result |
|---|---|---|
| `/next-ticket §5` is a chain-entry router emitting `build\|fast\|fix-bug` | `next-ticket.md §5` (V-220), precedence `route:` label > `bugBucket.id` > small-rubric > `build` | **Confirmed.** Bugs-bucket already derives `fix-bug`; only a placeholder ("`/fix-bug` lands with V-221 — running the standard chain until then", ~lines 121, 132) remains to remove. |
| `/next-ticket §6` is the *last-resort* origin-transcript read `/fix-bug` inverts | `next-ticket.md §6` (V-191, bucket-agnostic) | **Confirmed.** Fires only on a *suspected-wrong* premise after normal verification; `/fix-bug` front-loads the same `/ingest-convo` read instead. |
| Every bugs ticket carries an origin handle | `harvest-pipeline-bugs.md §5` | **Confirmed with caveat.** Harvest emits `conversations:`/`sessions:` lines and omits the handle **only** for truly handle-less older entries (no `conversation` *and* no `session`). So a handle is present for current harvests but **not absolute** — `/fix-bug §1` must degrade safely when absent. |
| `/build §3.5` is the design→build thesis-check to drop | `build.md §3.5` (V-140, single owner, profile-routed) | **Confirmed.** Idempotent, keyed on a `## Thesis-check` block; dropping it for `/fix-bug` means the path never materializes a build plan nor invokes the check. |
| `/build §4.6` read-back + convention-8 no-fab rules to keep | `build.md §4.6` + Hard rules | **Confirmed.** Located; carried into `/fix-bug §3` by reference. |
| Convention-11 `[HARD STOP]` ack gate exists | `workflow-conventions.md` convention 11 (PR #166) | **Confirmed.** Third gate kind: `needs input: [HARD STOP] … A bare 'p' does not pass this gate.`; `/go` logs `ack'd`/`intervened`, never `p'd`. |
| `go.md §5` consumes the route | `go.md §1` captures the route; §5 hard-codes `/scope`→`/build` | **Gap confirmed.** `/go` captures `fix-bug` but has **no branch to run `/fix-bug`** — a `go.md §5` edit is required for the route to be live under the autopilot. |
| Commands register via frontmatter | `commands/*.md` are auto-discovered (no central registry) | **Confirmed.** A new `commands/fix-bug.md` with valid frontmatter registers `/fix-bug`. |

No planning-time premise probed false.

## The path

`/fix-bug` is a **peer of the `/scope`+`/build` pair** on the routed branch — invoked *instead of* them for `route:fix-bug` tickets, ending in the full `/land-ticket`. Body:

- **§0 — Load + resolve.** Config + active ticket (route `fix-bug`; bugs-bucket `projectId === cfg.bugBucket.id`). Resolve the **origin handle** in the `next-ticket.md §6` order: the ticket's `conversations:` line, else its `sessions:` line (harvest §5 format), else a `/capture` `Source:`, else a stated provenance pointer (e.g. a `report-bug` `errors.jsonl` entry).
- **§1 — Ingest origin (first).** `/ingest-convo <handle>` up front — the inversion of `next-ticket.md §6`'s last-resort read. The origin conversation is the richest truth about a harvested bug, so read it before deciding anything. **Degrade safely** (no recoverable handle / GC'd transcript → say so and proceed from the ticket prose) per §6's degrade rules; never block or loop.
- **§2 — Reproduce (the oracle).** Build a reproduction from the ticket's Occurrence + the origin context. The repro is the pass/fail oracle. **Three outcomes:**
  - **(a) reproduced** → proceed to the fix (§3).
  - **(b) can't-reproduce** → the V-137/V-191 made-up branch, reached *early* (not as a last resort): the bug looks made-up/non-reproducible — close citing the transcript, or re-scope with the recovered nuance. **No fix.**
  - **(c) stale-but-real** → the bug was genuine but no longer occurs (fixed upstream, code moved) — close citing the transcript.
- **§3 — Fix (repro-gated).** Only on outcome (a). Implement the fix. **Keep `/build §4.6`** external-mutation read-back and convention-8 no-fabrication hard rules (read back any live mutation with its real returned id; never fabricate an id; never swallow a non-2xx body). **No scope plan, no §3.5 thesis-check.** Commit per `/build`'s style.
- **§4 — Prove the repro gone.** Re-run the reproduction; it must now fail to reproduce — the oracle flips from reproduces→doesn't. This is the bug-specific verify that replaces the generic design review; `/verify-tests` may still run for regression coverage.
- **§5 — Hand off → `/land-ticket`.** The full, **unchanged** `/land` — its §4.8 migration/`invariant` and §4.6 security gates are diff-driven and route-invariant, so the irreducible safety core holds even though scope + thesis-check were dropped.

## Keep / drop (Acceptance #6)

| Element | Decision | Why |
|---|---|---|
| Upstream `/scope` plan | **Drop** | A bug fix's contract is its reproduction, not a written build plan; the repro + origin convo are the spec. |
| `/build §3.5` design thesis-check | **Drop** | The thesis rung guards *feature-design* drift; a repro-gated fix has no design to red-team — the repro is the oracle. |
| `/build §4.6` external-mutation read-back | **Keep** | A fix can mutate live state; convention 8 applies regardless of route. |
| Convention-8 no-fabrication rules | **Keep** | Never route-relaxable (a hard gate profiles/routes may never touch). |
| Origin-transcript read | **Keep, inverted** | From last-resort (`next-ticket §6`) to first step (§1) — the richest truth read up front. |
| Reproduction step | **Add** | New: the chain has none today; it becomes the pass/fail oracle. |
| Full `/land-ticket` | **Keep, unchanged** | Holds the irreducible safety core (diff-driven migration/`invariant`/security gates, the merge confirm gates). |

## Why not (alternatives)

- **`/build --fix-bug` flag instead of a new command.** Rejected: the control flow is structurally different (no scope/thesis-check, repro-as-oracle, origin-first); a flag bloats `/build` with a parallel path and blurs its contract. A peer command matches the parent plan's Stack Decision.
- **Keep the §3.5 thesis-check.** Rejected: see keep/drop — a fix's oracle is the repro.
- **No separate design doc (use the build-plan `## Implementation design`).** Rejected: Acceptance #1 names a "design doc" deliverable and the ack gate needs a durable, reviewable artifact.

## Routing + orchestration (Acceptance #3)

- `next-ticket.md §5`: remove the "until it exists / running the standard chain until then" placeholder so `route:fix-bug` prints `/fix-bug → /land-ticket`. (The routing logic + precedence already exist from V-220.)
- `go.md §5`: add a `route:fix-bug → run /fix-bug` branch (in place of the `/scope`+`/build` phases), honoring `/fix-bug`'s gates — the ack gate (classified via `go.md §1`'s ack-gate kind + catch-all), §4.6, and `/land`'s confirm gates.
- `workflow-chains.md`: point the existing `fix-bug` route mention at the now-existing `/fix-bug` command.

## The ack gate (Acceptance #2)

The design→build transition for V-221 itself is gated by a convention-11 `[HARD STOP]` ack gate: the human reviews **this design** before the command is authored. A bare `p` does not pass — only explicit engagement (an answer, an amendment, a named ack) clears it, logged in the `/go` gate-audit as `ack'd` or `intervened`, never `p'd`. This is the first systematic exercise of the freshly-landed ack gate (PR #166) and doubles as Initiative III P7 evidence.
