# Pipeline knowledge base — the reasoning-context layer

The curated-markdown picture of **what we're doing and why** that left-V commands reason over, instead of reconstructing it from Linear queries each time. Linear is the *ticket DB* (execution, source of truth for issue/project state); this KB is the *reasoning context* (the coherent portfolio picture).

**Scope:** the domains the objective registry covers — typically the pipeline itself plus your product(s). A workspace product is out of scope until added to [`objectives.md`](./objectives.md).

## Files (the index — read this first)

| File | Holds | Update model |
|---|---|---|
| [`objectives.md`](./objectives.md) | objective registry — trace-tree roots; mirrors to Linear Initiatives | **hybrid** — framing authored, Initiative anchored |
| [`principles.md`](./principles.md) | the constitution — phase-weighted quality bar | **manual** — slow, deliberate |
| [`owed.md`](./owed.md) | owed-obligation read-schema (phase→owed map, honoring-node + waiver formats) | **manual** — derived rule + dated map |
| [`landscape.md`](./landscape.md) | active/admitted projects + current directions | **hybrid** — project list derived from Linear (between markers), narrative authored |
| [`decisions.md`](./decisions.md) | recent decisions log (portfolio ADR log) | **append-only**, dated, newest-first (ADR-style) |
| [`decision-ledger.md`](./decision-ledger.md) | cross-project design-rationale **index/overlay** — pointers to plan `## Stack Decision`/`### Reconciliations` + convention-6 Decision docs; reviewers read it for grounding (V-307) | **append-pointer**, manual — index only, holds no original rationale (distinct from `decisions.md`, which is a *source* it may point at) |
| [`parked.md`](./parked.md) | parked ideas + why parked | **hybrid** — set anchored to Linear parked state, why-parked authored |
| [`roadmap.md`](./roadmap.md) | mission-control state (phase ladder, session log) | **append-only**, dated (state doc) |
| [`profiles/`](./profiles/README.md) | per-model posture layer (convention 12) — the knobs commands key gate/plan/autonomy behavior on | **manual** — re-derived per model release from its published guidance |

## Read contract

1. **Load `README.md` first** (this file — the map). It is the only file a consumer always reads.
2. **Follow links just-in-time** — read the leaf file(s) relevant to the task, not the whole KB. The set is small enough to read whole when portfolio-wide reasoning is needed (tens of items, well inside one context window); prefer the targeted read.
3. **Datestamps and freshness headers are load-bearing** — treat a stale `> Last verified` date or an old `<!-- linear:generated -->` stamp as a signal to re-derive or re-confirm, not as ground truth.

### `/align` v2 read contract (the first consumer)
`/align` v2 reasons over the **live portfolio** — judging an idea against not just objectives but what's *actually in flight*. It reads, in order: `objectives.md` (the roots), `landscape.md` (active/admitted projects + directions), `principles.md` (the bar), and may consult `parked.md` (has this been parked before?) and `decisions.md` (recent direction shifts). It reads the landscape **from this KB** — it does **not** live-reconstruct the portfolio by querying Linear at judgement time. Keeping `landscape.md` fresh (see its derive note) is what makes that read honest. Implementing `/align` v2 is a separate ticket; this KB is the substrate it consumes.

### Reviewer read contract (`decision-ledger.md`)
The review commands read [`decision-ledger.md`](./decision-ledger.md) for **cross-project grounding**: `/thesis-check` §0 (alongside its parent-plan reconciliation record) and `/harvest-feedback` §4 (alongside `governance.md`). A reviewer consults it to avoid re-flagging a deliberate decision another project settled — following a relevant row's link to the authoritative source (a plan block or Decision doc). It is an index/overlay, so the reviewer's authority is the linked source, not the ledger row. See `decision-ledger.md`'s own header for the read discipline and the worked example (V-307).

## Update story (how each part stays fresh)

The rule: **if Linear knows it, derive it; if only a human knows it, author it and date it.**

- **Derived-from-Linear** (the volatile, mechanically-knowable part): the active/admitted-project list in `landscape.md`, between `<!-- linear:begin -->` / `<!-- linear:end -->` markers. Regenerated **in-session via Linear MCP** (this repo has no CI and no out-of-session Linear access — every Linear call is an in-session MCP call from a command), by re-running the derive step that seeded it. Never hand-maintain this list — it rots within a sprint.
- **Authored + dated** (no tracker equivalent): principles, objective framing, narrative direction, why-parked notes. These reuse convention-6 freshness headers (`> Last verified …`); a stale date is the nag.
- **Append-only** (no staleness by construction): `decisions.md` and `roadmap.md` describe a *moment*, never "now" — you append, never rewrite.

## Design rationale (concise)

- **Markdown-in-git, not RAG/graph/memory-framework.** Tens of items read whole into one command's context is comfortably inside the "keep it in-context" zone; git diffs/commit-rationale/rollback are an auditable memory layer those don't give. Reconsider only if the active set grows past ~30–50k tokens (add grep/tag retrieval first) or queries turn genuinely multi-hop-relational.
- **MOC + atomic leaves + just-in-time loading**, borrowed from the `CLAUDE.md`/`MEMORY.md` index discipline and Zettelkasten maps-of-content. No free-form bidirectional link web — a consumer needs a stable load order.
- **Generated skeleton with authored islands** (markers), adapted from Backstage/docs-as-code, but driven by an in-session command instead of CI.

**Ontology note:** `objectives.md`'s `Principle × Domain → Objective` tree is **canonical** for trace — it is what `/align`, `/plan`, `/plan-quick`, `/spawn-tickets` actually read. `roadmap.md`'s "Axis" is a grouping *view* over objectives, not a competing root.

Full design + alternatives considered + research citations were recorded in the authoring project's build plan (V-51).
