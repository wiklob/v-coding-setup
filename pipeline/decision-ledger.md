# Decision ledger — cross-project design-rationale index (reviewer grounding)

> An **index/overlay**, not a source. Every row points at an *authoritative* rationale record that already exists — a plan's `## Stack Decision` / `### Reconciliations` / `## Deviations` block, or a convention-6 Decision doc under `docs/`. This file holds **no original rationale**: the "why" lives at the linked source; a row carries only a one-line gloss so a reviewer can decide whether to follow the link. That pointer-only shape is deliberate — it is what keeps the ledger from becoming "a third source of truth" that rots and diverges from the plans/docs it indexes (parent plan `si-feedback-loop-mechanization.md`, Risks line: *"design as an index/overlay, not a third source of truth"*).

## What this is for

`/thesis-check`'s V-190 fix lets a reviewer read **its own ticket's parent plan's** reconciliation record, so an already-reconciled collision can't drive a false `wrong-approach`. But that only covers the ticket's *own* project. A deliberate decision made in **project A** is invisible to a naive review of a **project-B** ticket — the reviewer re-flags a choice the repo already settled, in a different plan it never read. This ledger closes that blind spot: it is the one place a reviewer (or a `/harvest-feedback` routing judgment) reads to see the **cross-project** set of deliberate decisions, each linked to its authoritative source. Read a relevant row → follow its link → treat the decision as authoritative (do not re-flag it), exactly as `/thesis-check` already treats a reconciled collision.

## Not `pipeline/decisions.md`

`pipeline/decisions.md` is the **portfolio ADR log** — append-only, immutable, KB/portfolio-altitude decisions (KB ontology, KB adoption). It is a *sibling* rationale record, one of the repo's authoritative sources; when a portfolio ADR is design-relevant to a review, point at it the same way. This ledger is the **cross-project design/build-rationale overlay reviewers read for grounding** — a different altitude (a plan's build-approach decision, a design Decision doc) and a different reader (the adversarial design reviewer, the routing judgment). Two "decision" files, two charters: `decisions.md` = portfolio ADR *source*; this file = the design-rationale cross-project *index*.

## The ledger (deliberate decisions a reviewer should not re-flag)

Each row: the decision (one line) · why (one line, gloss only — full rationale at the source) · status (`live` = in force / `superseded` = a later decision replaced it, kept for history) · source (the authoritative record).

| Decision | Why (gloss — full reason at source) | Status | Source |
|---|---|---|---|
<!-- no entries yet — add a pointer row per §Adding an entry below -->

## How reviewers use this — worked example (the generalized V-190 catch)

> *Illustrative — the plans/rows it names come from the authoring project; your ledger starts empty.*

The encoded proof (test-less repo — a worked example is the proof analog per `commands/scope.md` §3) that reading this ledger turns a would-be false non-`sound` into the correct `sound` when the deliberate decision lives in **another project's** plan — the exact blind spot V-190's own-parent-plan read leaves open.

**Ticket (project B — say a KB tooling project):** add a helper that queries Linear for an initiative's projects.
**Acceptance:** the helper returns the initiative's projects via a Linear call.
**Implementation design (as written):** approach — hand-roll a raw GraphQL query in the helper (matching the existing wrapper's call style); seams — the new helper + the self-hosted MCP wrapper's GraphQL client; change shape — a new query string + result mapping; alternatives — import `@linear/sdk`, rejected (heavier dependency); risks — none load-bearing.

A reviewer of this **project-B** ticket, seeing hand-rolled GraphQL where `@linear/sdk` exists, is pulled toward `simpler-alternative`: *"why hand-roll GraphQL — import `@linear/sdk` instead?"* Under V-190 alone the reviewer reads only **project B's** parent plan, which says nothing about the SDK — so the pull stands and the reviewer false-flags a choice the repo already settled **in project A** (`self-hosted-linear-mcp-wrapper`).

**With the ledger:** the reviewer reads the row *"build-fresh raw GraphQL, deliberately NOT `@linear/sdk`"* (source: `self-hosted-linear-mcp-wrapper.md` § Stack Decision), recognizes the design's hand-rolled GraphQL as honoring that **cross-project** decision, and returns:

```
VERDICT: sound
BAR: 1:pass 2:pass 3:pass 4:pass 5:pass 6:pass 7:pass
REASONING:
- bar 4/1: the "why not @linear/sdk" objection is already reconciled cross-project — the self-hosted-linear-mcp-wrapper Stack Decision deliberately chose build-fresh raw GraphQL over the SDK. The design honors that agreed decision; it is not a missed simpler alternative.
TRIGGER: none
SUGGESTION: proceed-with-ack — sound; the SDK alternative was settled in another project, surfaced by the decision ledger.
```

Without the ledger the reviewer would have gated `simpler-alternative` on a decision it never saw — a false gate on a choice the repo made deliberately in a different plan. The ledger is the difference, and it is *cross-project* (project-A decision, project-B review) — the generalization of V-190's own-plan-only reconciliation read.

## Adding an entry

When a new deliberate cross-project decision is recorded (a plan `## Stack Decision` / `### Reconciliations` / `## Deviations` entry, or a new convention-6 Decision doc) that a reviewer of *another* project's ticket might re-flag, drop a one-line pointer row here — decision · why-gloss · `live` · source link. Keep it a pointer: the authoritative "why" stays at the source, so a row never diverges from it (a stale row degrades to a *missing* pointer, never *wrong* rationale). Mark a row `superseded` (don't delete it) when a later decision replaces it — the history is part of the grounding. Full auto-population from the plans/docs is a deliberate non-goal of this slice (its own tooling + verification surface).
