# Design: the `research` routed execution path

> Status: design for V-223 (research-route part of `docs/plans/differentiated-execution-paths.md`, Initiative II). Decision doc — records the *why* + the agreed *how* of the `research` route. **Absorbs** the canceled "Typed /go paths (ticket-type routing)" project (`plans/enchanted-foraging-torvalds.md`): one `route:*` taxonomy instead of a second `go-research`/`go-manual` label scheme.

## Purpose

Specify the `research` route — the fourth chain-entry route after `build | fast | fix-bug` (V-220) — so a `route:research`-labeled ticket runs a path matched to its **deliverable** (knowledge, not code) instead of being dragged through the build chain. A research ticket's output is a finding doc / a verdict / a prior-art brief (`craft/planning.md`'s route taxonomy: *the deliverable is knowledge*); it has no build design to red-team, no code to build, and nothing for `/verify-tests` to run. The live failure this closes: `/go V-174` (a research ticket — "why do `/thesis-check` and `/verify-tests` dominate token usage?") was forced through `/build §3.5`'s thesis-check, which halted on a `missing-seam` verdict against its *research method* — a category mismatch (`pipeline/audit/errors.jsonl:1533`). The gap became concrete when PR #167 made `/plan` emit `route:research` labels while the V-220 router only handled `build | fast | fix-bug`, so `route:research` fell through to `build`.

## Re-grounding verification

The parent plan and the absorbed `enchanted-foraging-torvalds.md` predate V-220/V-221; per the active profile's `re-grounding` knob (convention 12 — re-verify planning-time findings against current code before building), each load-bearing finding was re-checked against the **current** command files (worktree on `origin/main`, newer than the stale local main checkout):

| Plan finding | Re-verified against current files | Result |
|---|---|---|
| `/next-ticket §5` is a chain-entry router emitting `build\|fast\|fix-bug`, `route:research` currently maps to `build` | `next-ticket.md §5` (V-220), line 113 `route:research → build with a one-line note` | **Confirmed.** The route mechanism exists; only the `route:research` mapping + a `research` branch need adding. |
| Routing is one seam at `next-ticket §5`, execution paths selected there (the `fix-bug` precedent) | `next-ticket.md §5` + `go.md §5` `fix-bug` block + `commands/fix-bug.md` | **Confirmed.** `research` folds into the **same** seam — supersedes the absorbed plan's second routing surface (a `go-*` label read inside `/go`). |
| Investigate step is freeform inline, not `/research`, not a new `/investigate` command | `plans/enchanted-foraging-torvalds.md` Deviations (line 165) | **Confirmed.** Decision carried over: freeform inline, no new command. |
| The deliverable taxonomy classifies `route:research` as knowledge | `craft/planning.md` lines 27–33 | **Confirmed.** `route:research` = a findings doc / verdict / prior-art brief; classify by deliverable. |
| `/land-ticket` handles a doc-only PR safely | `land-ticket.md §4.8` (keys on `migration`-kind), §6.8 teardown (keys on `cfg.docs` ripple) | **Confirmed.** Neither gate fires on a `code`-kind finding doc; a markdown-only diff has no `migration`/`invariant` artifact to STOP on. |
| `route:research` label exists | Linear `list_issue_labels name:route:research` | **Confirmed** (id `eaeb2209…`). |
| The "Typed /go paths" project is to be canceled with a trace to V-223 | Linear `get_project` | **Already done** (Canceled 2026-06-11; summary points to V-223). No mutation owed; its Backlog tickets V-197–V-201 sit in the canceled project (won't be auto-picked — optional cleanup). |

No planning-time premise probed false.

## The path

The `research` route is driven **inline by `/go`** — the routed replacement for Phases 3–5, **with no peer command** (unlike `/fix-bug`). Investigate freeform inline → land a finding doc → the full unchanged `/land-ticket`:

- **Routing (`next-ticket.md §5`).** The `route:research` label maps to route `research` (precedence unchanged: label > bugBucket-derivation > small-rubric > build). The scope-necessity decision does not apply (like `fix-bug`). Recorded durably the same way as every other route — the hand-off print + the `Route: research — …` Linear comment.
- **Execution (`go.md §5`, route `research`).** Skip Phases 3 (`/scope`), 4 (design thesis-check), and 5 (`/build` + `/verify-tests`), each with a `skipped` banner + one `skipped` ledger line. Then:
  - **Investigate freeform inline** against the ticket's Acceptance — *not* `/research` (external-prior-art recon, the wrong tool for an internal analysis like V-174's), and not a new `/investigate` command (explicitly rejected in the absorbed plan).
  - **Write the finding doc** to `docs/<finding-slug>.md` (the `docs/` decision/state bucket per convention 6 — knowledge, not a build plan, so not `docs/plans/`), **opening with the structured Decision block** the land gate foregrounds — `## Question` · `## Candidate approaches` · `## Relevant standards` · `## Recommendation` (per-approach pros/cons + the pick) — followed by any deeper investigation notes. This block is the contract `/land-ticket` §4.10/§6.7's research foreground reads deterministically; without a required structure the foreground has no reliable source and falls back to dumping merge receipts (V-301 — the recurring "research spikes don't give proper overviews" feedback). Post the finding as a ticket comment carrying at least the question + the Recommendation.
  - Commit + push the doc-only diff (as `/build` would), then hand to **Phase 6 (`/land-ticket`)**.
- **Land (`/land-ticket`, unchanged).** The full land flow — its §4.8 migration/`invariant` and §4.6 security gates are diff-driven and route-invariant, so the irreducible safety core (branch/commit/push, merge confirm gates, evidence rules) holds even though scope/thesis-check/build/verify were dropped.

## Keep / drop

| Element | Decision | Why |
|---|---|---|
| Upstream `/scope` plan | **Drop** | A finding's contract is the question it answers + the evidence, not a written build plan; there is no code to design against. |
| `/build §3.5` design thesis-check | **Drop** | The thesis rung guards *feature-design* drift; a knowledge deliverable has no build design to red-team (the V-174 mis-route this route exists to remove). |
| `/build` implement phase | **Drop** | No code to write — the deliverable is the finding doc. |
| `/verify-tests` | **Drop** | No code to verify. (The doc-only diff also contains no `supabase/migrations/*`, so the §4.8 land gate stays route-invariant.) |
| `/build §4.6` external-mutation read-back | **Keep (conditional)** | An investigation rarely mutates live state, but if it does, convention 8 read-back applies regardless of route. |
| Convention-8 no-fabrication rules | **Keep** | Never route-relaxable (a finding must cite observed evidence, never fabricated ids/quotes). |
| Full `/land-ticket` | **Keep, unchanged** | Holds the irreducible safety core; lands the finding doc through the standard merge gates. |
| A peer command (à la `/fix-bug`) | **Drop** | The path is thin (investigate → doc → land) and the absorbed plan explicitly chose inline + no new investigation command. |

## Why not (alternatives)

- **A new peer command `/research-path` (à la `/fix-bug`).** Rejected: the absorbed plan explicitly rejected a new investigation command and chose freeform-inline; the path is thin (investigate → doc → land) and doesn't earn a ~75-line command file; the Acceptance scopes the behavior to `/go`. (`/fix-bug` earns its command because it carries substantial procedure — origin-ingest, reproduce, prove-repro-gone; research does not.)
- **Keep `route:research → build` and only no-op the thesis-check on research.** Rejected: that still drags a knowledge deliverable through scope, build, and verify — the mis-route waste is the whole chain, not just the thesis-check halt.
- **A second routing surface inside `/go` (the absorbed plan's `go-*` label read).** Rejected: it duplicates the `next-ticket §5` routing seam. Folding research into the one `route:*` taxonomy is the point of absorbing the old project.

## `go-manual` disposition (Acceptance #5)

**Drop it.** Refusing `/go` autopilot is orthogonal to deliverable-type routing — a category mismatch with the `route:*` taxonomy (which classifies by *deliverable*, while `go-manual` classifies by *who drives*); there is no live trigger for it (unlike V-174 for the research route); and not-wanting-autopilot is already served by simply running the individual commands (`/next-ticket`, `/build`, …) instead of `/go`. (`go-verify`, the absorbed plan's other deferred path, stays deferred — built when a real verify-only mis-route gives a case to test against, per `enchanted-foraging-torvalds.md` P5.)

## Worked example (V-174-shaped) — the encoded proof (Acceptance #2, #3)

Test-less repo: a worked example is the encoded-proof analog (`commands/scope.md` §3). Two runs, one diff:

**A `route:research` run** — a ticket "why do `/thesis-check` and `/verify-tests` dominate token usage?" carrying `route:research`:
- `/next-ticket §5` emits route `research` (label wins).
- `/go` skips Phases 3–5, printing `Phase 3 (/scope) — skipped: research route …`, `Phase 4 (design thesis-check) — skipped: research route …`, `Phase 5 (/build + /verify-tests) — skipped: research route …`.
- Investigates freeform inline, writes `docs/v-174-token-cost-thesis-check-verify-tests.md` + a finding comment, lands the doc via `/land-ticket`.
- The gate-audit block carries the routing line + the three `skipped` lines, **no** `design-thesis-check` verdict line, and **no `forced` halt** — the V-174 mis-route is gone. (Tallies count no skipped rung as `forced`/`intervened`.)

**An unlabeled run** (the no-regression proof) — any ticket with no `route:` label runs the unchanged `build` chain: `/scope` (if the gate says scope) → `/build` (which fires §3.5's thesis-check) → `/verify-tests` → `/land-ticket`, producing the full `scope→thesis-check→build→verify→land` ledger. The `research` branch is additive and guarded by the route, so the default/`build`/`fast`/`fix-bug` paths are byte-unchanged.

## Note for a future `route:research` ticket — finding-shaped Acceptance reconciliation

`/land-ticket §8` reconciles Acceptance items against the merged diff. A research ticket's Acceptance is finding-shaped ("the token-attribution table exists", "the verdict is recorded") — satisfied by **doc content**, not code. Such items are `code`-kind (the artifact is the finding doc in the diff); they reconcile cleanly because the finding doc *is* in the diff. There is no migration/`invariant` artifact, so §4.8 raises no false STOP. (This note discharges the thesis-check's non-blocking nudge; it bears on a *future* research ticket's land, not V-223's own — V-223's diff is command-markdown `code`.)
