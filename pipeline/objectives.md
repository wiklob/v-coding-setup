# Objectives — the registry

> Part of the [pipeline KB](./README.md) — the index covers how this file stays fresh and who reads it.

**Objectives** are directional outcomes we drive toward: vertical nodes, the **roots of trace trees**. Unlike a Project, an objective can never be "done"; unlike a [Principle](./principles.md), it is one *domain*, not everywhere. An objective is usually a **principle applied to a domain** (`Frictionless` × `onboarding` → "onboarding is smooth").

This file is the **source of truth skills read**. Each active objective mirrors to a Linear **Initiative** so the trace tree is visible; the file is the enforceable trace-up, the initiative is the view.

> **Canonical path (V-96).** Consumers (`/spawn-tickets`, `/plan`, `/plan-quick`, `/align`) resolve this registry at `~/.claude/pipeline/objectives.md` — `~`/`$HOME`-expanded to an absolute path, **independent of the repo a command runs from** (override via `objectivesRegistry` in `.claude/ticket-flow.json`). Never the bare repo-relative `pipeline/objectives.md`: run from a product repo that resolves to a nonexistent `<repo>/pipeline/objectives.md`, so projects spawn unattached. The registry is co-mingled (all repos' objectives in one hub) by design, so a funnel command run from the pipeline checkout can read every product's objectives from one place.

> Objectives are provisional and will sharpen as you learn how the product should *feel*. Prune and merge freely.

## Schema

- **Name** — the directional outcome, in outcome language.
- **Derives from** — `Principle(s) × Domain`.
- **Direction** — what moves when we succeed (the signal we watch).
- **Initiative** — the Linear initiative it mirrors to (name / id), or `—` if not yet mirrored.
- **Status** — `active` | `parked` | `retired`.

A Project promoted from the funnel **must name the objective it advances** (trace-up). An idea that can name no objective is a new-objective candidate or noise — that is the kill/park test.

---

## <your pipeline domain>  (the pipeline itself)

<!-- Seed example — the shape one objective takes. Replace with your own. -->

### A traceable creative→action pipeline
- **Derives from:** Frictionless × the whole dev pipeline (ideas → action with no friction and no loss).
- **Direction:** every piece of work traces to a why and proves it served it; nothing built that no objective asked for, no objective left without verified delivery.
- **Initiative:** — *(mirror to a Linear Initiative, then record its name + id here)*
- **Status:** active

---

## <your product domain>

<!-- One `### <objective>` block per objective, following the Schema above.
     Cluster on axes (`### Axis: <name>` + `#### N. <objective>`) when the set grows. -->

---

## Parked

<!-- Ideas set aside at the objective altitude — one line each: **<name>** — why parked. Mirrors parked.md. -->

---

## Buckets & funnels (objective-less by design)

These Linear projects are **intentionally not attached to an Initiative** — they are perpetual buckets or intake funnels, not feature work that traces up to a directional outcome. `/trace-audit`'s "project without an Initiative" check (trace-up) should treat membership here as the resolution, not a broken edge.

<!-- One line per bucket/funnel: **<project name>** (`<project uuid>`) — what it holds. Typical set:
- **bugs** — perpetual bucket for patch-tickets harvested from the errors.jsonl pipeline-error sink.
- **Standalone (<pipeline team key>)** — perpetual bucket for atomic pipeline fixes.
- **Intake — <product>** — the idea funnel (capture → align → promote / park / kill); upstream of objectives, not a child of one. -->
