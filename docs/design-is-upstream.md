# Design is upstream of the pipeline, not a route through it

> Status: adopted — Initiative II (Differentiated Execution Paths), V-222 / P3.
> Type: Decision doc (convention 6 — records *why*, append-only after adoption).
> Source: `docs/plans/differentiated-execution-paths.md` §Decisions; sibling research `docs/plans/depth-and-legibility.md`, `plans/adaptive-pipeline-overhaul.md` §1 obs-5.

## The decision

**Design is upstream of the pipeline, not a route through it.** The ticket machinery is for **convergent, decomposable, verifiable** work; design is **divergent, visual, taste-judged**. A "creative ticket route" — a fourth chain alongside `build` / `fast` / `fix-bug` — is a **category error**, and Initiative II deliberately does **not** build one.

Design happens in the human's hands / in design tools / in the browser — **outside** the ticket flow. The pipeline picks up at the **implementation boundary**: a *settled* design becomes input to `/plan`, which ticketizes the convergent build/integration work that follows from it. What the pipeline is good at (decompose → acceptance-checklist → verify → land) is exactly what design is not.

## Why a creative route was rejected

The eliminative/convergent skills (the `/impeccable`-class craft tooling) work for simple, rule-checkable tasks and **break on designer-grade, unorthodox solutions** (`adaptive-pipeline-overhaul.md` obs-5). The flagship-artefact attempt of that class (the CB-183 class) was cancelled for "too low a quality ceiling and too slow a loop." The lesson isn't "build a better creative chain" — it's that taste-driven divergent work doesn't ticketize at all. Forcing it into acceptance-checklist machinery lowers its ceiling; the machinery's strength (convergence to a verifiable target) is the wrong tool for an open-ended visual search.

## `/riff` — the un-ticket mode

`/riff` is the lightweight **"not in ticket-mode"** affordance: a craft-led, loosely-structured session driven by judgment rather than the fixed `next → scope → build → land` chain and its gates (which, on exploratory work of unknown shape, are ceremony rather than help). It is where divergent/exploratory work lives *before* there is a settled design to hand the pipeline. `/riff` is the seed of the "design lives outside the chain" stance — it is explicitly **not** a route through the pipeline, and it never enters the router's `build | fast | fix-bug` set.

## Flagship live artefacts — right tool, then pipeline as playback

Flagship live artefacts (the CB-183 class — bespoke interactive/animated pieces) exceed the ceiling of code-against-rules generation. The right path is a **proper authoring tool** (Rive / Spline / Blender → glTF) **or a commission** — a human or specialist designer producing the artefact in a medium built for it. The pipeline's role for these is the **playback / integration layer**: it wires the finished artefact into the app, ships it, and maintains it — it is **not** the designer. Convergent integration of a divergent artefact is exactly the implementation-boundary handoff above.

## Consequences

- The router (`/next-ticket §5`, V-220) emits `build | fast | fix-bug` (and `research`, V-223) — **never** `creative`. That set is closed by this decision, not by omission.
- `/riff` stays the deliberate escape from the chain for exploratory work; it is documented as such, not treated as a missing route to be filled.
- A settled design enters via `/plan` → `/spawn-tickets`; the convergent build it implies runs the normal chain.
