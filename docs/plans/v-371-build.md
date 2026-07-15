# Build plan: V-371 — /go planning-first run design with real human design-choice checkpoints
Status: ready
Created: 2026-07-15 by /scope
Ticket: https://linear.app/wiklob/issue/V-371/go-planning-first-run-design-with-real-human-design-choice-checkpoints
Parent plan: none — standalone

## Goal
Produce a durable design for a default deep-ticket `/go` checkpoint that makes the implementation decision understandable and gives the human a real choice when multiple materially viable approaches remain, without moving divergent product design into the ticket pipeline or adding eager skill-pack context.

## Approach
Write a decision doc at `docs/planning-first-go-run-design.md`, grounded in both source conversations and the current command contracts. The design will preserve `/build §3.5` as the single owner of the design→build boundary, but split the deep-ticket checkpoint by decision state: an unresolved material fork is presented before thesis-check as a genuine choice; a settled design is thesis-checked, concretely explained, and explicitly acknowledged. Each run gets one pre-code human checkpoint, not an added verbose screen or a duplicated gate.

The doc will specify the eventual command-level seams (`commands/scope.md`, `commands/build.md`, `commands/thesis-check.md`, `commands/go.md`, and `docs/implementation-design-rung.md`) without implementing those command changes in this design ticket. It will keep `--architect` as the full interactive research/Q&A intensity while making the default deep path comprehensible and choice-aware at checkpoint intensity.

## Implementation design
1. **Approach** — author a decision doc defining a two-branch deep checkpoint. `/scope`'s implementation-design artifact records whether a material implementation fork remains open. If open, `/build §3.5` lazily renders goal → discovered constraints → decision → viable options/trade-offs → exact choice before thesis-check; the choice rewrites the design, then thesis-check validates it and proceeds without a second ack. If settled, thesis-check runs first and `/build §3.5` renders the same sequence as an explanation ending in explicit ack/amend, never a fake option choice.
2. **Affected seams/files** — this ticket writes `docs/planning-first-go-run-design.md`. The design governs future changes to `commands/scope.md` (decision-state carrier), `commands/build.md` §3.5 (single checkpoint owner and branch order), `commands/thesis-check.md` (validate the human-resolved design, not choose for them), `commands/go.md` (drive/log the one checkpoint while preserving `--architect`), `docs/implementation-design-rung.md` (artifact contract), and `docs/design-is-upstream.md` (reconciliation by reference; append-only decision remains unchanged).
3. **Intended change shape** — the doc opens with evidence from source conversation 1 (the user repeatedly interrupted autopilot to reclaim design authorship and requested research→plan→report→approval) and source conversation 2 (CB-433 reduced five concrete changes to an opaque `approach · seams · shape` ack). It then defines: decision-state criteria; the five-line decision brief; open-choice and settled-ack gate templates; one-gate state transitions; `--architect` vs default-deep intensity; lazy-loading budget; command ownership; and a completed blind-reader probe using a CB-433-shaped example.
4. **Alternatives considered** — (A) auto-run the full `--architect` stage on every deep ticket: rejected because it makes background `/go` unusable and imposes full research/Q&A where the architecture is already settled. (B) only make the current post-thesis ack more verbose: rejected because it improves comprehension but still asks the human to approve a choice already made, exactly the failure the ticket forbids. (C) move every implementation choice into `/plan`: rejected because implementation architecture depends on current-code validation at `/scope`/`/build`, and standalone tickets may legitimately enter without a parent plan. Chosen: one decision-state-aware checkpoint at `/build §3.5`, with divergent product/taste design still upstream and the explicit `--architect` mode available for full human-owned architecture.
5. **Risks / unverified premises** — risk: calling every rejected alternative an “open choice” would add ceremony; the design therefore defines open only when at least two materially viable approaches survive current-code constraints and the difference requires human judgment. Risk: an open fork cannot be thesis-checked while unresolved because the rung requires one attackable thesis (`docs/implementation-design-rung.md:63`); the choice branch must therefore precede thesis-check, while the settled branch remains post-thesis. Verified premise: `/build §3.5` is the single owner of the boundary (`commands/build.md:76-104`, `docs/implementation-design-rung.md:107-117`). Verified premise: the current deep gate exposes only goal plus abstract approach/seams/shape (`commands/build.md:95-101`). Verified premise: `--architect` already supplies full-interactive research/options/Q&A and remains human-present-only (`commands/go.md:13-16`, `commands/go.md:139-157`).

## Pre-build validation
- [x] Acceptance item 1 — implementable · kind: `code`. Both source conversations were recovered: conversation 1 records research→plan→report→approval and repeated user interruptions to reclaim design decisions; conversation 2 records the opaque CB-433 deep gate and the concrete explanation required to clear it. The decision doc is the ticket's requested artifact.
- [x] Acceptance item 2 — implementable · kind: `code`. `docs/design-is-upstream.md:9-11,29` keeps divergent product/taste design outside the ticket chain; the proposed checkpoint is limited to convergent implementation architecture after current-code validation, with full exploratory design remaining `/riff`/`/plan`/`--architect` territory.
- [x] Acceptance item 3 — implementable · kind: `code`. The design doc will specify the exact ordered brief: concrete goal → discovered constraints → decision state/question → options with consequences → exact response requested.
- [x] Acceptance item 4 — implementable · kind: `code`. The design branches on `open` versus `settled`: open requires a named option choice before thesis-check; settled explains why alternatives lost and requires ack/amend, not a disguised choice.
- [x] Acceptance item 5 — implementable · kind: `code`. The doc will include a CB-433-shaped deep-ticket gate and a fresh-context blind-reader probe recording whether the reader can state both the build and the choice without implementation context.
- [x] Acceptance item 6 — implementable · kind: `invariant`. Encoded proof: the doc will include a load-boundary table showing no new top-level `/go` read; the deeper brief is assembled only inside the existing deep branch from the already-loaded build plan, validation, and thesis-check artifacts. No eager skill-pack file is added.

(Build-check: no ticket-provided code snippets; not applicable.)

## Implementation steps
1. `docs/planning-first-go-run-design.md` — write the source-grounded decision, upstream-design reconciliation, decision-state algorithm, gate templates, one-checkpoint state machine, ownership map, and lazy-load proof. Satisfies Acceptance items 1–4 and 6.
2. Fresh-context probe — give only the proposed CB-433 deep-gate render to an unfamiliar reader agent; ask what is being built and what they must choose. Record the observed answer and any resulting doc correction. Satisfies Acceptance item 5.
3. Run the repository's docs/scrub checks and inspect the final diff for leaked private paths, identities, or source-transcript content beyond paraphrased evidence.

## Risks / gotchas
- Do not turn the default deep checkpoint into the full `--architect` conversation; the point is proportional control, not mandatory planning ceremony.
- Do not place the new logic in `/go` as a second design owner; `/build §3.5` remains the single owner and `/go` only drives/logs the checkpoint.
- Do not present the mandatory “Alternatives considered” field as proof that a choice is open; most alternatives are already eliminated. “Open” means two or more materially viable approaches remain after validation.
- Do not quote source transcripts verbatim beyond short, non-sensitive evidence; the public doc should describe the observed failure without exporting private conversation content.
- Do not implement the future command changes in this ticket; the accepted deliverable is the design that makes those changes unambiguous and verifiable.

## Verification strategy
- `/verify-tests` scope: repository docs/scrub test suite, especially public-repo sanitization and markdown/reference checks.
- Build check: `bin/run-tests.sh` and the scrub gate used by CI.
- Comprehension: fresh-context blind-reader probe over only the proposed deep gate; pass requires accurately naming the concrete build and whether the response is a choice or an acknowledgement.
- Manual: none if the fresh-context probe is recorded and the invariant load-boundary proof is present.

## Deviations
(none yet)
