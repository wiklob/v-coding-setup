# craft/ — wider-retrofit backlog (the commands beyond the pilot)

> The tracker that keeps "incrementally as touched" from silently becoming "never." P3 (V-119) retrofitted craft into the three pilot judgment commands; the plan defers the rest to adoption-on-touch (`plans/skill-craft-layer.md`, deliberate non-goal). Without a visible list, that deferral decays into permanent omission. This doc makes the remaining surface — and the rule for when to act on it — inspectable.

## The adoption rule (when a command must adopt craft)

A command adopts craft when it **exercises judgment** — makes a call that could go better or worse with more or less care (a review verdict, a scope/validation decision, an "is this actually done?" self-check, a gate, a promote/park/kill). Those are the commands where naming the default instinct and self-critiquing against the rail (`craft/judgment.md`) changes the output.

A command does **not** adopt craft when it is pure procedure or near-zero-friction capture (`/capture`, `/report-bug`, `/report-feedback`, `/ticket-flow-init`) or thin orchestration whose judgment lives in the commands it calls (`/go`, `/audit-cycle`). Wiring craft into these is the *Ceremony* anti-pattern (`craft/judgment.md` `## Anti-Patterns`) — a read-first line that carries no load, paid every invocation. Leaving them off is the rule working, not a gap.

**Trigger — when to actually do the retrofit** (don't batch-rewrite all 28; §10's "incrementally as touched" is deliberate):

- On a command's **next substantive edit** — if you're already reworking a judgment-bearing command's logic, add the craft rail in the same pass. This is the cheap moment: the file is open and the judgment step is what you're touching.
- When **`/review-skill` (P9 / V-124) flags it** — the self-review command grades a command against the craft register and emits `NEEDS FIXES` for a judgment-bearing command with no craft rail. That flag promotes the command from this backlog to a retrofit.

The rule is recorded here (the backlog authors consult when adding craft), pointed at from `workflow-conventions.md §10` and `craft/README.md` so it surfaces wherever an author reaches for craft.

## The pilot pattern (what "retrofitted" means — done = this)

Seeded from P3 (`/review-pr`, `/scope`, `/build`). A retrofit is complete when the command:

1. **Adds the read-first line** to its header — `then ~/.claude/craft/README.md … and, for <this command's judgment>, craft/judgment.md` (see `review-pr.md:9`, `scope.md:19`, `build.md:19` for the shape).
2. **Routes its judgment step through the craft rail**, not a bare checklist — names the default instinct that step is prone to, then self-critiques the output against `craft/judgment.md`'s `## Constraints` + `## Anti-Patterns` before emitting (e.g. `scope.md:67` names *trust-the-framing*; `review-pr.md:32` tests each finding against *Ceremony*).
3. **Shows the checklist→judgment shift** — the before/after diff replaces "tick these boxes" with "name the pull, weigh against the rail, say *why* diagnostically." That shift is the project's behavioral validation marker.

## Status

**Retrofitted (5) — reference implementations, not action items:**
`/build` · `/review-pr` · `/scope` (P3 pilot) · `/riff` · `/thesis-check` (authored craft-aware).

`/build` and `/scope` additionally route their goal-fidelity judgment through **`craft/building.md`** (V-254) — the building-domain rail (build the best version of the goal, not the literal ticket; the untangled follow-up reflex), paired with `craft/planning.md` the way building-*from*-a-ticket pairs with shaping-*into*-tickets. A craft *domain* file (like `planning.md`), not a command retrofit.

**Tier 1 — judgment-bearing, strongest fit (heirs to the review/decide pilot):**

- [ ] `/align` — promote / park / kill portfolio calls with a soft overridable lean.
- [ ] `/plan` — framing in ConOps terms, the collaborative stack decision, the slicing call. *Partially retrofitted (adaptive-planning): reads `craft/planning.md` for the slicing/shaping call; ConOps framing + stack decision still un-railed.*
- [ ] `/research` — the import / adapt / build-fresh verdict per candidate.
- [ ] `/review-claude-md` — accuracy / completeness / conciseness / AI-usefulness verdict (direct sibling of the planned `/review-skill`).
- [ ] `/review-produced` — met / partial / missed per Acceptance item + the quality verdict.
- [ ] `/scorecard` — synthesis of the review lenses into a ranked verdict that must name ≥1 concrete change.
- [ ] `/tool-fit` — the right-sized / overkill / underdelivered grade per step.
- [ ] `/triage-findings` — the route classification (auto-apply / standalone / cluster / defer / drop) per finding.
- [ ] `/sweep` — the judgment of what counts as a reviewed finding vs noise.
- [ ] `/gen-claude-md` — authoring judgment (accuracy + concision); pairs with `craft/authoring.md`.
- [ ] `/next-ticket` — the scope-necessity gate call (scope vs skip).
- [ ] `/land-ticket` — the §4.6 sensitive-path gate. **Tracked under P6 / V-122 (gate-as-craft), not this backlog** — listed here for completeness so it isn't double-counted as untracked.

**Tier 2 — judgment present but lighter or mostly engine-/plan-driven (retrofit when touched):**

- [ ] `/audit-docs` — drift / bloat / coverage-gap judgment.
- [ ] `/backfill-docs` — drafting judgment (already cites the authoring conventions; light lift).
- [ ] `/bulk-fix` — the group-into-coherent-PRs and batch-review judgment.
- [ ] `/harvest-pipeline-bugs` — the clustering / dedupe / route-weight judgment.
- [ ] `/plan-quick` — terse planning; mirror `/plan`'s rail in the lighter dispatched form. *Partially retrofitted (adaptive-planning): reads `craft/planning.md` for decomposition.*
- [ ] `/review-session` — Lens A/B judgment (largely engine-driven by `bin/session-review.mjs`).
- [ ] `/spawn-tickets` — decomposition from an already-judged plan (mostly mechanical). *Partially retrofitted (adaptive-planning): the milestone-grouping step reasons over `craft/planning.md`.*
- [ ] `/verify-tests` — the scoped failure-classification call.

**Tier 3 — pure procedure / capture / orchestration — craft would be Ceremony; out unless a judgment step appears:**

`/audit-cycle` · `/capture` · `/go` · `/ingest-convo` · `/report-bug` · `/report-feedback` · `/resume-ticket` · `/ticket-flow-init`.

These are listed (the rule's "every command not yet retrofitted") with an explicit *out* lean so the list is honest about why they're absent from the tiers above — not overlooked, deliberately excluded per the adoption rule. If one grows a real judgment step (e.g. `/go` starts making its own gate calls instead of delegating), it graduates to a tier.

## Links

- Plan: `plans/skill-craft-layer.md` (P10 / V-127 — this backlog is its artifact; structural-validation note references it).
- Register: `craft/README.md` (index entry) · `craft/judgment.md` (the rail a retrofit routes through).
- Convention: `workflow-conventions.md §10` (the incremental-adoption bullet points here).
