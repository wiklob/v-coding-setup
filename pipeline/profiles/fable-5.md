# Profile: Fable 5

Source basis: Anthropic, *Prompting Claude Fable 5* + the Fable 5 announcement (2026-06-09). Posture: **high process trust, unchanged claims skepticism.** This model plans, scopes, self-verifies, and dispatches subagents well by default — rails that force those behaviors degrade it. What did *not* improve: fabrication-adjacent status claims ("verified" on checks never run). So the profile removes process scaffolding and keeps every evidence rule.

## Knobs

- **`design-check`** — self-check by default. When the plan lacks a `## Thesis-check` block, red-team the design yourself against the 7-item bar (`thesis-check.md` §1) and append the standard block with `Verdict: sound (self-checked)` (or the non-`sound` verdict, which gates exactly as ever). Fire the full `/thesis-check` subagent only when the work is **net-new architecture** (no in-repo pattern to follow, a new dependency/service/protocol) or the human/ticket asks for it.
- **`scope-plan-depth`** — minimal. Write the always-required contract (header, `## Goal`, `## Pre-build validation` with artifact-kinds + verified-semantics, `## Deviations`); add `## Implementation design` only when `design-check` will route it to the subagent check or the change is cross-cutting/migration-bearing. Skip the Approach/Implementation-steps/Verification-strategy prose when the change shape is obvious — derive it while building.
- **`research-depth`** — your own call, no gate. Weigh the work (point count, net-new vs pattern-following, cross-cutting coupling), pick full or small research depth yourself, state the choice in one line, and proceed. Scope the investigation your own way (parallel per-point dispatch is available, not prescribed) — but full depth's *outputs* are the model-independent contract (`/plan` §3): an observed-not-asserted findings block with `file:line`, and a `route:research` spike per genuine unknown.
- **`re-grounding`** — trust planning-time findings. Re-verify a finding only on a staleness signal: the code moved under the plan, or what you observe contradicts what it asserts. Do not re-run research ritually.
- **`autonomy`** —
  - When you have enough information to act, act. Do not re-derive settled facts, re-litigate made decisions, or plan past the point of usefulness — overplanning is this model's failure mode, not underplanning.
  - For minor choices (naming, defaults, equivalent approaches), pick a reasonable option and note it. Stop only at the core gate set.
  - Before ending a turn, check your last paragraph: if it states an intent ("I'll now run X") without having done it, do it now.
  - Audit every status claim against a tool result from this session — "tests pass" means you ran them here and read the output.
  - State boundaries you're honoring; don't take unrequested actions (no unasked side-deliverables, no defensive git acrobatics).
- **`review`** — fresh-context verifier subagents (core rule). No extra filtering instructions needed; this model's review recall is strong by default.

## Reading the commands under this profile

Command bodies still carry rails written for earlier models. Under this profile: treat enumerated procedure as a contract on **outcomes and order** (what must be true, what must be recorded, what gates) — where a step prescribes *how to think* (mandatory rituals of re-derivation, manufactured adversarialism, defensive double-checks of things you observed once already), exercise your own judgment. Evidence rules and gates are never in this discretionary class.
