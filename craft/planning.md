# craft/planning.md — shaping a project (the Connectors rubric)

> Status: hypothesis · since 2026-06-10 · evidence: docs/plans/adaptive-planning.md (exemplar: the Connectors-for-unmonitored-sources project, 54 tickets / 15 milestones, hand-shaped)
>
> Depth behind `craft/README.md`, read when a command turns an idea into tickets — `/plan`, `/plan-quick` (decomposition), `/spawn-tickets` (grouping). The default instinct this file exists to name and resist is the **uniform lattice**: a default sort, equal-feeling milestones, uniformly-sized tickets, a "propose a grouping" step with no judgment behind it. The result reads instrumental and programmed; the shape carries no information about the work. A well-shaped plan is the opposite — its sizing, grouping, and dependency graph *are* a record of what was discovered about the work.

## The seven principles (each with its why)

1. **Research before sizing.** Size what you observed, not what you imagine. A part's difficulty is an empirical question about the code it touches; sizing before looking produces the uniform-M lattice. How deep to look is the planner's call under its profile (`research-depth` knob, `pipeline/profiles/`); *that* depth was chosen is always visible in the plan.
2. **Spine-first dependency root.** Find the shared spine — the contract, schema, or core mechanism everything else hangs off — and root the dependency graph on it. A spine landed first de-risks every dependent; a flat graph hides that one part is load-bearing.
3. **Size by discovered difficulty.** S/M/L tracks what research found, not what symmetry suggests. Non-uniform sizing is the signal working: if every part came out M, that is a claim ("all parts are equally hard") which is almost never true — re-examine.
4. **Tier mix.** A healthy manifest mixes tiers: **spike** (resolve a genuine unknown — its deliverable is knowledge), **doc/contract** (pin an interface before implementations fan out), **impl** (the building), **guarantee** (a test/probe that locks an invariant). A genuine unknown gets a spike ticket — not a hopeful impl ticket with the unknown buried in its Acceptance.
5. **Dependency follows coupling.** Chain tickets that share state or a contract; parallelize tickets that don't. Dependencies model coupling, not narrative order — a `blockedBy` that exists only because "it felt sequential" serializes work that could fan out.
6. **Validation sliced per milestone.** The plan's system-validation criterion (`## Validation`) decomposes into per-milestone empirical checks — each milestone's verification criterion is a slice of the top-level one, checkable when that milestone lands. A milestone whose criterion restates its name is unverifiable.
7. **Plan as source of truth.** The plan doc carries the shape's reasoning and back-links (tickets → plan, milestones → criterion slices); divergence lands in `## Deviations` as it happens. A shape nobody can reconstruct the why of decays into the lattice on first edit.

## Fewer, fatter tickets

A ticket is an **end-to-end verifiable deliverable with a runnable acceptance check** — something a reviewer can exercise when it lands, not a step that only makes sense beside its siblings. **Slicing lives at milestones**: the finer granularity a big project needs is expressed by grouping fat tickets into milestones (per-channel, per-concern — see grouping below), not by shredding deliverables into ticket-sized fragments. The why: every ticket pays the full chain cost (worktree, scope, build, review, land) — a confetti ticket pays it for a fragment that can't even be verified alone, and the verification burden doesn't shrink with the ticket, it just loses its subject. If a part has no runnable acceptance check of its own, it is a checkpoint inside another ticket or a milestone boundary — not a ticket.

## Grouping (milestones)

Group by **channel or concern** — the seam the work actually divides along (per-connector, per-surface, per-subsystem) — not by uniform phase strata (backend / frontend / polish applied to every project regardless of its shape). Phases still exist *per milestone* (`pipeline/principles.md` phase-weighting — declare each milestone's phase; don't restate the principles). Milestone counts vary with scope: a small plan is one milestone or none; forcing a layer onto a tiny plan is the lattice again.

## Routes (the per-ticket execution path)

Every manifest part carries a route — which execution path Initiative II's consumer sends it down. Three values, extensible:

- **`route:build`** — net-new capability or change to intended behavior. The default when nothing below fits.
- **`route:fix-bug`** — a defect against already-intended behavior (harvested bugs, regressions). Bugs-bucket-origin parts default here.
- **`route:research`** — the deliverable is knowledge: a findings doc, a verdict, a prior-art brief. Spike tickets carry this route.

Classify by **deliverable**, not by effort or by where the idea came from: a big refactor is still `build`; a one-line investigation whose output is a verdict is still `research`.

## Design-core → spike-first (waivable)

Some projects rest on an **unproven structural premise** — a layout/composition/arrangement, a data/interface **contract**, a schema shape, or an interaction model that **≥1 build part hangs off**. When that premise is wrong, every dependent cascades into rework: Edition baked an unproven structural model straight into build tickets → 4 cancellations + a PR closed unmerged; Reader spiked the contract first → zero cancellations. A project like this is **design-core**: its spine is a question, not a settled shape.

For a design-core project, **recommend leading the Manifest with a `route:research` design/spike part that the build parts declare `blockedBy`** — the spike proves the premise before the build set is committed to it. This is principle #4 (a genuine unknown gets a spike, never buried in an impl part's Acceptance) applied to principle #2's spine (the shared structural contract everything hangs off): the spine is *unproven*, so the spine's ticket is a spike.

Two rails keep it honest:
- **Recommend, never silently gate.** Surface the recommendation with a one-line rationale and let the human **waive** it. "Core is an open design question" is a judgment call — a silent keyword gate that forced a design milestone onto a clear-cut project would manufacture exactly the *Ceremony depth* the anti-patterns name below. The human owns the call; the planner surfaces it.
- **Don't fire on a settled shape.** It is *not* design-core — recommend nothing — when the core follows a **proven in-repo pattern** (the pattern is the proof), the structural premise is **already settled**, or any design question is **local to one part and resolvable in-build**. Forcing a spike there is the same ceremony from the other side.

No new mechanism: it specializes `route:research` (a spike's deliverable is knowledge) and the existing spine-first `blockedBy` ordering — a surfaced recommendation, a waivable spike, not a new route value or a silent hard gate. `/plan` §6 surfaces it; `/spawn-tickets` §2 renders the accepted spike as a leading design milestone the build milestones depend on.

## Constraints — hold the proposed shape against these before emitting

- Sizing cites what was found (a file, a coupling, an unknown) — "M because medium-feeling" is the lattice talking.
- The dependency root is the spine, and you can say *why* that part is the spine in one line.
- Every genuine unknown surfaced by research has a spike ticket; no impl ticket's Acceptance quietly contains a research question.
- Each ticket's acceptance check is runnable on its own when the ticket lands — if it needs siblings, the part is a checkpoint or the milestone is the unit.
- Each milestone's criterion is an empirical slice of `## Validation`, not a restatement of the milestone's name.
- Exactly one `route:` per part, classified by deliverable.
- A **design-core** project (spine = an unproven structural premise ≥1 build part hangs off) surfaced a **waivable** spike-first recommendation — a leading `route:research` design part the build parts `blockedBy` — never a silent forced design milestone, and never fired on a settled/pattern-following core (the *Ceremony depth* anti-pattern from the other side).

## Anti-Patterns — the shapes to catch in your own proposal

- **The uniform lattice** — all-M sizing, equal-count milestones, phase strata applied to every project. Shape that carries no information about the work.
- **Confetti tickets** — deliverables shredded into chain-cost-paying fragments none of which can be verified alone. The fat-ticket rule exists because of this.
- **Narrative dependencies** — `blockedBy` chains that model the order you'd *tell* the story, not actual coupling; they serialize parallel work.
- **The buried unknown** — an impl ticket whose Acceptance hides a question nobody has answered. That's a spike wearing an impl ticket's clothes.
- **Ceremony depth** — running heavyweight research on a one-file fix to look thorough (`craft/judgment.md` *Ceremony*). Depth is proportional to genuine unknowns, and the depth chosen is stated, not silent.
