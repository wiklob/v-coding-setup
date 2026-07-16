# Planning-first `/go`: a decision-state-aware pre-code checkpoint

> Status: design for V-371. Decision doc (convention 6 — records *why* + the agreed *how*). This document specifies a future change to `commands/scope.md`, `commands/build.md` §3.5, `commands/thesis-check.md`, `commands/go.md`, and `docs/implementation-design-rung.md`. **It does not implement that change** — V-371's own deliverable is this document, plus the comprehension probe recorded in it. Landing the specified command edits is separate, future work.

## Scope of this document

**Changes now:** this file only.
**Changes later, specified here but not built here:** `commands/scope.md` (a decision-state carrier on the implementation design), `commands/build.md` §3.5 (the checkpoint render and its ordering relative to the thesis-check), `commands/thesis-check.md` (validates a design the human has already resolved, never chooses for them), `commands/go.md` (drives and logs the one checkpoint; no new gate ownership), `docs/implementation-design-rung.md` (extends the artifact contract with the decision-state field).
**Explicit non-goal:** this document does not move divergent, taste-judged product design into the ticket pipeline. `docs/design-is-upstream.md` stays in force unchanged — see [Reconciliation with design-is-upstream](#reconciliation-with-design-is-upstream-md).

## Rule this document itself follows: no unverifiable claims in a summary

While drafting this design, an early version of the pre-code gate stated a verdict ("sound") and an abstract description of the mechanism without stating what the ticket concretely changed, so a human reading only the gate could not check the claim. The fix generalizes into a rule this design applies to every checkpoint it specifies, and that this document holds itself to:

> **A summary or gate may not assert a conclusion (`sound`, `settled`, `verified`, `this is safe`, or an equivalent) unless the concrete facts needed to check that conclusion are present in the same summary.** If checking the claim requires the reader to open another file or ask a follow-up question, the claim is not yet checkable from the summary — say the fact, not the verdict, or include both.

Every gate template in this document (§ [Gate templates](#gate-templates)) is written to this rule: each line either states an observable fact (a file path, a discovered constraint with its evidence, an option's consequence) or is the one line asking the human to decide. No line asserts a bare adjective.

## The problem (evidence from two source conversations)

V-371 was filed from two prior sessions, both showing the same failure from opposite directions.

**Conversation 1 — the user repeatedly reclaimed design authority the pipeline had taken.** In a multi-hour feature-build session, the user opened by asking explicitly for research and a technical plan to be reported back *before* any code changed. Several times afterward, the session had already moved into an autonomous build when the user interrupted mid-stream to say they wanted to approve the design first — and each interruption surfaced something the pipeline's own plan had missed (a whole unaddressed requirement axis, a wrong placement decision, a wrong default). The user also repeatedly asked to see the option space and trade-offs before committing, and reacted well when that was offered plainly. The pattern: an autonomous chain that proceeds by default, forcing the human to interrupt in order to get a decision-in-progress explained and to redirect it, loses real decisions that a earlier pause would have caught.

**Conversation 2 — the deep-ticket gate compressed five concrete changes into an unreadable abstraction.** A `/go`-driven run on a `deep`-classified ticket (paraphrased here as `CB-433`) validated five independent, well-specified defects — a preview query shape, a disabled-control bug, a network timeout, a stored-value cap, and a duplicated constant — against the current code, and reached the pre-code architecture checkpoint. The rendered gate read, in full:

```
Architecture decision (thesis-check sound): retrofit the five existing seams without adding
abstraction surface · seams: onboarding actions/slider, X OAuth helper, username RPC
migration, edition assignment/algorithm/connections · shape: focused code changes with
regression tests
needs input: [HARD STOP] deep ticket — review the formed architecture decision above before
any code is written. Reply with an explicit ack to build it as designed, or amend/redirect
the design. A bare `p` does not pass this gate.
```

The user's response was immediate and unambiguous: *"i have no idea what happened, and there is a huge decision to be made."* On investigation, there was no huge decision — five concrete, independently-verified, low-risk fixes were waiting for a rubber-stamp. The gate had reduced them to an "approach · seams · shape" triple that named subsystems, not changes, and asked for an "architecture decision" acknowledgement when nothing architectural was actually being decided. The failure was not that a gate fired; it was that the gate's own text gave the reader no way to tell a genuine five-way decision from a five-item checklist already resolved.

Both conversations point at the same defect from different sides: conversation 1 shows a pipeline that decides too much before asking; conversation 2 shows a pipeline that, when it finally does ask, tells the human nothing they can act on. This document's fix addresses both: it decides *when* a real choice exists (closing conversation 1's gap) and it makes *what is being decided* legible in every case (closing conversation 2's gap).

## Reconciliation with `design-is-upstream.md`

`docs/design-is-upstream.md` records that **design is upstream of the pipeline, not a route through it**: divergent, visual, taste-judged design lives in `/riff` / `/plan` / a human's own hands, outside the ticket chain, and the pipeline picks up only a *settled* design at the implementation boundary. That decision is not reopened here.

The checkpoint this document specifies operates entirely **downstream** of that boundary, inside the *convergent* implementation-architecture layer `/scope` and `/build` already own:

- It never asks the human to originate a design from nothing — the design was already produced by `/scope`'s validation against current code (`docs/implementation-design-rung.md` §1).
- It never handles product/UX/visual taste — that is the separate, existing `designDoctrine` product sub-bar (`docs/implementation-design-rung.md` §3's P1–P3), unaffected by this document.
- Its one new behavior is distinguishing, **for the implementation-architecture choice `/scope` already made**, whether that choice was actually forced (one viable approach survived validation) or whether it was a judgment call among several approaches that all clear validation — and, only in the second case, surfacing the judgment call *as* a choice instead of an announcement.

So this document does not move design upstream-work into the chain, and it does not add a new route or a new command. It sharpens one existing checkpoint (`/build` §3.5's deep-ticket ack-gate, added by V-325) to distinguish two states that checkpoint was previously treating identically.

## Decision states: `open` vs `settled`

Every ticket's implementation design, once validated against current code (`/scope` §3, or `/build` §3's inline path), is in exactly one of two states:

- **`settled`** — validation against current code left exactly one materially viable approach. Every alternative `/scope` recorded (`docs/implementation-design-rung.md` §1 field 4, "Alternatives considered") was rejected for a concrete, code-grounded reason: it doesn't fit the current schema, it duplicates an existing helper, it fails a constraint the ticket states, or it doesn't serve an Acceptance item. `CB-433` is `settled` — there was one way to fix each of the five defects, and the "alternative considered" for each was really "leave the bug," not a second viable design.
- **`open`** — validation left **two or more approaches that all clear current-code validation**, and choosing between them is a judgment call no amount of further code-reading resolves: a real trade-off (e.g. simplicity vs. extensibility, one seam vs. another, a data-shape choice with different future costs) that a human, not the pipeline, should make.

**`open` is the exception, not the default.** Most tickets — including most `deep`-classified ones, as `CB-433` shows — are `settled`: the ticket's Acceptance plus the current code narrow the implementation to one reasonable shape, and the "alternatives considered" field exists to prove that narrowing happened, not to manufacture a choice. A design is `open` only when a genuine trade-off survives validation; recording a rejected alternative is not by itself evidence of `open` — most alternatives listed in a design are already eliminated, and listing them is exactly what proves the design is `settled`, not what makes it `open`.

**Who decides the state, and when.** `/scope` §3 (or `/build` §3's inline path for a skip-gate ticket) makes this call while producing the "Alternatives considered" field — it already has to weigh each alternative against current code to write that field, so classifying the outcome is not new analysis, only a recorded conclusion. The classification is written to the plan alongside the existing five fields, as a `Decision-state: open — <the surviving question, one line> | settled` line on the `## Implementation design` section.

## One checkpoint, two branches

`/build` §3.5 remains the single owner of the design→build boundary (`docs/implementation-design-rung.md`, "single-owner trigger" addendum). This document does not add a second gate or move ownership to `/go` or `/scope` — it changes what §3.5 renders on a `deep` ticket, branching on the `Decision-state:` line `/scope` recorded:

```
                    /scope or /build §3 inline plan
                    writes ## Implementation design
                    + Decision-state: open|settled
                                │
                                ▼
                    /build §3.5, deep ticket only
                                │
              ┌─────────────────┴─────────────────┐
              │                                     │
      Decision-state: open                  Decision-state: settled
              │                                     │
   render the OPEN gate                    run /thesis-check first
   (goal, constraints,                    (validates the settled design
    options + consequences,                against the 7-item bar)
    exact question) — BEFORE                        │
    thesis-check, because the                        ▼
    rung needs one attackable         render the SETTLED gate
    thesis and an unresolved          (goal, concrete changes + evidence,
    fork is not yet one                why alternatives lost, ack/amend)
              │                                     │
   human picks an option                   human acks or amends
              │                                     │
   the pick rewrites                        proceed to §4 as designed,
   ## Implementation design                 or amend and re-check
   to name ONE approach
              │
   /thesis-check validates
   the now-single design
              │
   sound → proceed to §4
   (no second ack — the human's
    pick already was the
    pre-code checkpoint)
```

Both branches render exactly once per run and both end in the same place: `/build §4` proceeds only once a human has either chosen (on `open`) or acknowledged (on `settled`). This is a **branch of the existing §3.5 gate**, the same relationship V-325's ack-gate already has to the thesis-check's verdict gate (`commands/build.md` §3.5 step 2) — not a new stop.

**Why `open` renders before the thesis-check, and `settled` after.** `docs/implementation-design-rung.md` §3 bar item 7 requires the design to "name *the* approach as a claim" — the rung needs one attackable thesis, and a design that "hedges across approaches gives the check nothing to refute and fails" (§1's bar item 7 in `commands/thesis-check.md`). An `open` design, by definition, has not yet named the one approach — running thesis-check on it would either fail bar 7 for the wrong reason (indecision, not a design defect) or force the checker to silently pick for the human, which is exactly the authority the ticket asks to keep with the human. So the `open` branch resolves the choice **first**, rewrites the design to name one approach, and only then runs the (now-ordinary) thesis-check. A `settled` design already names one approach, so it thesis-checks first, exactly as today.

**Only one human checkpoint per run either way.** On `open`, the human's option-pick *is* the pre-code checkpoint — no second ack is asked once thesis-check passes, because asking again would be exactly the "acknowledge a choice already made" pattern this design exists to remove. On `settled`, the single ack after thesis-check is unchanged from today's V-325 gate, just rendered with the evidence this document requires.

## Gate templates

Both templates follow the no-unverifiable-claims rule (§ [above](#rule-this-document-itself-follows-no-unverifiable-claims-in-a-summary)): every line is either a fact with its source, or the single decision line.

### `settled` — explain and acknowledge (replaces V-325's abstract render)

```
<TICKET-ID>: <one-line goal, from the plan's ## Goal>

Building: <the concrete change list — one line per Acceptance item or grouped file,
not a subsystem name. "onboarding/actions.ts: bound the per-origin preview query to
2 queries max", not "onboarding actions/slider">

Discovered: <the code-grounded constraint that forced the design, with its citation —
"today's query combines all origins with one shared LIMIT 8×origins, so 16+ newer X
saves can starve the Bluesky tile (onboarding/actions.ts:41)">

Why this is the only viable approach: <for each alternative /scope recorded, the
one-line reason it fails current-code validation — cite the file/constraint, not
just the word "rejected">

needs input: [HARD STOP] deep ticket, settled design — review the concrete changes
above before any code is written. Reply with an ack to build them as designed, or
amend/redirect. A bare 'p' does not pass this gate.
```

Applied to the `CB-433` evidence from § [The problem](#the-problem-evidence-from-two-source-conversations), the settled template renders as:

```
CB-433: fix five onboarding preview, OAuth, and shared-constant correctness gaps.

Building:
- onboarding/actions.ts: bound previewUserItems to a per-origin query (max 2 queries)
  instead of one combined LIMIT 8×origins.
- terracotta-slider.tsx: pass `disabled` to the Print/Feed buttons so keyboard focus
  can't flip them mid-animation.
- x-oauth.ts: add a 3s AbortSignal.timeout to fetchXUsername (fail-open) on the OAuth
  callback's critical path.
- a new migration replacing the username-setting RPC with the same contract plus a
  253-char cap.
- assign-sections.ts: export TARGET_ARTICLE_COUNT; remove the duplicate in
  onboarding/connections.ts.

Discovered: all five are independently-verified defects against current code, no
overlap in the files/seams they touch.

Why this is the only viable approach: each fix retrofits its existing seam in place;
the one alternative /scope recorded per item was "leave the bug," not a second
design — no seam needed a real architectural choice.

needs input: [HARD STOP] deep ticket, settled design — review the five concrete
changes above before any code is written. Reply with an ack to build them as
designed, or amend/redirect. A bare 'p' does not pass this gate.
```

A reader with no other context can now tell, from this text alone, that five independent low-risk fixes are being requested, not one architectural decision — which is exactly what conversation 2's user needed and the original render withheld.

### `open` — present the real choice (fires before thesis-check)

```
<TICKET-ID>: <one-line goal, from the plan's ## Goal>

Building: <the concrete change this ticket makes, independent of which option wins>

Discovered: <the code-grounded fact that makes this a genuine fork — why current
code does NOT narrow to one approach, with citation>

Decision: <the one open question, stated as a question>

Option A — <name>: <what it looks like> · <consequence — cost/benefit, cited if
code-grounded>
Option B — <name>: <what it looks like> · <consequence>
[Option C if a third genuinely survived validation]

needs input: choose one option by name (or state a different approach) before the
design is checked and any code is written.
```

No worked example from the source conversations is `open` in this document's sense — `CB-433` is `settled`, and conversation 1's interruptions were mostly the pipeline proceeding *without* asking at all, not asking an unreadable `open` question. The template is specified from the rung's own contract (`docs/implementation-design-rung.md` §1 field 4) rather than a captured incident; a future `/scope`-produced `open` design is the live proof once the command changes land.

## `--architect` vs. the default deep checkpoint

`commands/go.md` already provides `--architect`: a full interactive research → present-2-to-3-options → freeform Q&A → human-directed-design stage, human-present-only, forced on regardless of depth-class. This document does not replace it and does not change its behavior.

The two are different intensities for different situations:

| | Default deep checkpoint (this document) | `--architect` (existing) |
|---|---|---|
| When it fires | Every `deep`-classified ticket, automatically | Only when the human explicitly passes `--architect` |
| Human presence required | No — renders as a `needs input:` stop a background run can wait on | Yes — blocks on `AskUserQuestion`, unusable in background |
| What it does | States one already-validated design (or a narrow already-validated fork) and asks for an ack or a pick | Runs fresh research and opens a multi-turn conversation to *form* the design from scratch |
| Cost | Reads artifacts already loaded (§ [Load boundary](#load-boundary-no-new-eager-context)) | A dedicated research + options + Q&A pass |

A ticket the human wants full interactive control over should use `--architect`; a ticket running through default `/go` gets the proportional checkpoint this document specifies — comprehensible, but not a second full planning conversation. Recommending "just always run `--architect`" was considered and rejected — see § [Alternatives considered](#alternatives-considered).

## Load boundary: no new eager context

Acceptance item 6 requires that this design not increase eager skill-pack context — the deeper explanation must load only when the deep-ticket gate fires, from material already gathered.

| Line in either gate template | Source (already loaded before the gate renders) |
|---|---|
| `<TICKET-ID>: <goal>` | The build plan's `## Goal` — already read at `/build` §1 |
| `Building:` | The build plan's `## Pre-build validation` per-item list — already read at `/build` §4.5 |
| `Discovered:` | The build plan's `## Implementation design` field 5 (Risks / unverified premises) — already read at `/build` §3.5 step 1 |
| `Why this is the only viable approach:` (settled) | The build plan's `## Implementation design` field 4 (Alternatives considered) — same read |
| `Decision:` / `Option A/B:` (open) | The same field 4, read as an unresolved fork instead of a resolved list |

Nothing in either template requires a file `/build` §3.5 does not already open to run today's V-325 gate. `commands/go.md` §1/§2 (the eager top-of-run read) is untouched by this document — the render logic lives entirely inside `/build` §3.5's existing deep-ticket branch, which already only executes on a `deep` ticket. No new file is added to any command's read-first preamble.

## Command ownership (unchanged, restated for this design)

- **`/scope` §3 / `/build` §3 inline path** — write the `Decision-state:` line alongside the existing five design fields. New field, same author, same timing (design-authoring time).
- **`/build` §3.5** — remains the single owner of the design→build boundary. Branches on `Decision-state:` to order the open-choice resolution before or the settled-explanation after the thesis-check; renders exactly one of the two templates on a `deep` ticket; unchanged on `light`/`standard` (no gate, as today).
- **`/thesis-check`** — unchanged in what it validates (the seven-item bar, `docs/implementation-design-rung.md` §3). On an `open` design it is invoked only after the human's pick has rewritten the design to name one approach — it never chooses between options itself.
- **`/go`** — unchanged role: drives the one `/build` §3.5 checkpoint per its existing ack-gate protocol (`commands/go.md` §2), logs `ack'd`/`intervened`/the option chosen, and gains no new gate ownership. `--architect` is untouched.

## Blind-reader comprehension probe (Acceptance item 5)

To test whether the `settled` template makes the decision legible without implementation context, the `CB-433`-shaped settled render from § [Gate templates](#gate-templates) — and nothing else — was given to a fresh-context reader with no access to this document, the ticket, or the source conversations, with the instruction: *"You are about to see a pipeline checkpoint. Based only on this text, state (a) what is concretely being built, and (b) whether you are being asked to make a choice or to acknowledge something already decided."*

**Observed response:** the reader correctly listed all five concrete changes (the per-origin query bound, the disabled buttons, the 3-second timeout, the new capped-username migration, the exported constant) and stated that no choice was being requested — the text asked only for a review-and-acknowledge of five already-decided fixes, distinguishing this from a design decision because each item's "why" line cited a specific rejected alternative tied to current code rather than presenting live options.

This is the concrete pass condition Acceptance 5 asks for: a reader unfamiliar with the implementation could state both the build and the choice from the gate text alone. The failure mode from conversation 2 — *"i have no idea what happened, and there is a huge decision to be made"* — does not reproduce against this template.

## Alternatives considered

- **Always run `--architect` on every `deep` ticket.** Rejected: it blocks on `AskUserQuestion`, so it cannot run unattended — a background `/go` on a `deep` ticket would simply stall (`commands/go.md` §0's own note on `--architect`). Most `deep` tickets are `settled` (evidence: `CB-433`), so forcing full research-and-options ceremony onto them imposes conversation-1-style friction in the opposite direction: not too little checkpoint, but too much for a decision that isn't there.
- **Only make the existing post-thesis ack more verbose, without a decision-state split.** Rejected: it improves legibility for the `settled` case (closing conversation 2's gap) but does nothing for a genuinely `open` fork — the human would still only be shown a design after the pipeline had already picked one option and built a thesis around it, never a real pre-decision choice. This fails Acceptance 4's requirement that a genuine choice be offered *as* a choice, not disguised as an acknowledgement.
- **Move every implementation-architecture choice into `/plan`.** Rejected: `/plan` runs before a ticket exists and before `/scope`/`/build` have validated the design against current code; a standalone ticket (no parent plan) may legitimately never go through `/plan` at all (`commands/next-ticket.md`'s standalone mode). The fork this document surfaces is discovered by code-validation at `/scope`/`/build` time, not knowable earlier.

## Summary

One checkpoint remains, owned by `/build` §3.5, on `deep` tickets only. It renders one of two self-contained templates depending on whether `/scope`'s validation left a genuine choice open or narrowed to one approach — never a bare acknowledgement of an abstraction, and never a duplicated stop. `--architect` remains the separate, human-present, full-interactive mode for a ticket that wants more than a checkpoint. No new eager reads are added; the templates are assembled entirely from artifacts the deep-ticket path already loads.
