# Pipeline roadmap — mission control

> **Read this first.** Any session (yours or dispatched) opens here to orient in ~30s.
> Last updated: <date of last edit>

## What this is

The append-only mission-control doc for the pipeline itself: the phase ladder you're climbing, the session log, and the idea backlog. It describes *moments*, never "now" — append, don't rewrite (see [README → Update story](./README.md#update-story-how-each-part-stays-fresh)).

The reference frame is the **NASA V-model**: a **center** (the ticket-execution chain `/next-ticket` → `/scope` → `/build` → `/land-ticket`, plus `/sweep` + `/review-pr`), a **left wing** (where good tickets come from — objectives → projects → gated tickets: `/capture` → `/align` → `/plan` → `/spawn-tickets`), and a **right wing** (proving the running system works and delivers — `/validate`, monitoring).

**Ontology note:** [`objectives.md`](./objectives.md)'s `Principle × Domain → Objective` tree is **canonical** for trace. Any "Axis" grouping here is a *view* over objectives, not a competing root.

## Tracker

<!-- Your pipeline's own Linear home:
- **Linear team `<name>`** (key `<KEY>`) — the pipeline's own ticket system.
- **Bucket `Standalone (<KEY>)`** — atomic findings (the steady stream of small fixes).
- Block projects — coherent multi-ticket work, created per block.
- Capture: spot something → file a ticket immediately. The bucket **is** the inbox. -->

## Phase ladder

<!-- The blocks you're building, in order, with checkboxes — e.g.:
- **Phase 0 — Foundation** — git-track the config dir, permissions model, this roadmap.
- **Phase 1 — <next block>** — …
Build ONE block → use it heavily → iterate the easy shortcomings → at ~80% start the
next block while pushing the prior to 90–95%. -->

## Session log

<!-- Append-only, newest-last: `### YYYY-MM-DD — <session headline>` + a few bullets of
     what was decided/landed and what a fresh session should pick up. -->

## Wings — idea backlog (discussed, not yet ticketed)

<!-- Loose capture for left-wing / right-wing / procedural ideas that aren't tickets yet. -->
