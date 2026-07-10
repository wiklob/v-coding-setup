---
description: Subagent-dispatched plan flavor — terse, no interactive turns, used by `/triage-findings` for parallel cluster dispatch. Humans use `/plan` (interactive) for fresh ideas.
argument-hint: "<the scope, in a sentence or two>"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# /plan-quick — subagent-dispatched plan

Read `~/.claude/workflow-conventions.md` first and follow it (its §12 selects your model profile), then `~/.claude/craft/planning.md` — the shaping rubric governs §3's decomposition here exactly as in `/plan`. **Assume no live user** — this command is invoked from a parallel subagent dispatch (typically by `/triage-findings`), so you cannot ask questions. Decide all reasonable defaults yourself; honour the Stack auto-approve rule in §2 (stop only if the Stack Decision genuinely cannot be auto-approved). Produce a plan file ready for `/spawn-tickets`. Humans typing `/plan` get the interactive flavor — this command is the plumbing.

**Trace contract (parity with `/plan`).** A plan this command writes carries the **same trace schema** as `/plan` — header `Objective:` / `Seed:` lines and a `## Validation` section — but **authored non-interactively** (best-effort objective match or `unnamed`; `Seed: direct`; a lighter, single-criterion validation). `/spawn-tickets` consumes these when present and its §0 tolerance is the backstop for any plan still missing them (a `stack-needs-review` early-exit, or a genuinely objective-less scope). So: emit the fields, never block on them.

## Start check (soft)
- Need an idea: `$ARGUMENTS` or ask for it in one line. That's the only prerequisite.

## 1. Frame (fast)
- Restate the idea in 2-3 lines: problem, goal, what "done" looks like. Note constraints you can infer from the repo (read `CLAUDE.md`, key dirs) rather than asking.
- **Research depth — decide it yourself, under every profile** (no live user → no gate; this is the non-interactive counterpart to `/plan` §3's `research-depth` knob): weigh point count, net-new vs pattern-following, cross-cutting coupling, and pick **full** (read the touched code; findings with `file:line` per convention 8; a `route:research` spike part per genuine unknown) or **small** (light pass over directly-touched code). Record the choice + one-line rationale in the plan's `## Goal` or `## Risks` so the depth is visible. Never stall waiting for a depth approval.
- Ask **only** the questions whose answers would change the plan materially. Batch them; ≤3; skip if you can reasonably decide.
- **Resolve trace, non-interactively** (no user, no promoted ticket — this is a dispatched scope):
  - `Seed: direct` — a triage-dispatched scope has no promoted Intake ticket ID. (`/plan`'s ID path doesn't apply here; this mirrors its free-text path.) The findings provenance — the `<FINDING_REFS>` / `<FINDINGS_DOC>` the dispatch references — goes in the header's `Source:` line, **not** in `Seed:` (whose values are `<CB-NNN | V-NNN | direct>`).
  - `Objective: <name>` — read the objectives registry at `~/.claude/pipeline/objectives.md` (canonical KB hub, resolved independent of CWD; override via `objectivesRegistry` in `.claude/ticket-flow.json`; never the bare repo-relative `pipeline/objectives.md`) and best-effort match the scope to **one** registry objective by name/domain. Match **conservatively**: only when a single objective is a confident fit (a wrong attribution mis-routes the Initiative downstream in `/spawn-tickets` §3, which is worse than none). No confident match → `Objective: unnamed` with a one-line note. Mirrors `/plan`'s "proceed with `Objective: unnamed`" fallback — decide or default, never block.

## 2. STACK DECISION — dedicated stage (always run, its own checkpoint)
This is a first-class part of every plan, never skipped or folded in. It happens **before** decomposition because the slices depend on it. Stay concise — a table, not essays.

- Enumerate every stack-affecting choice the idea forces: new dependency/library, data store, external service, runtime/build, architectural seam, or a deviation from the repo's existing stack (read `CLAUDE.md` / lockfile to know the baseline).
- For **each** choice, one row: `Choice | Decision | Why (1 line) | Rejected alt (clause)`. Decide it yourself unless it's a genuine fork (cost, lock-in, irreversible, strong-preference) — then surface that specific fork.
- If the feature needs nothing new: still produce the section explicitly — one line: `Stack: unchanged — builds on existing <X, Y>`. The decision (to add nothing) is itself recorded.
- Write it as a `## Stack Decision` ADR section in the plan artifact (created now).
- **Checkpoint (mandatory, concise):** show the user the Stack Decision table and get an explicit go/adjust **before** step 3. Stack is hard to reverse; this is its own gate, separate from the final plan sign-off. One tight exchange — don't belabor.

## 2.5. Validation criterion (non-interactive)
Author the plan's **system-validation criterion** — the lighter, non-interactive counterpart to `/plan` §5.5. One focused criterion, written directly (no user exchange):
- Derive it from the resolved **objective** (its Direction in `~/.claude/pipeline/objectives.md`) when one is named; when `Objective: unnamed`, tie it to the **goal's outcome** instead.
- It must be **non-trivial, verifiable, and outcome-tied**: a concrete signal an observer could check after delivery — a behavior present end-to-end, an artifact that exists and does X. Not a restated Goal, not "works well."
- Keep it to one criterion (a dispatched scope is narrower than a `/plan` project). Record it as the `## Validation` section in the plan doc (§3).
- **`stack-needs-review` early-exit** (per `/triage-findings`'s dispatch rule): the plan stops before the Manifest and is not `ready`, so a full criterion is unwarranted — still emit `Objective:` / `Seed:`, but the `## Validation` section may be brief or omitted (it's authored once the scope is settled and decomposition proceeds).

## 3. Decompose (against the agreed stack)
Write the rest of `docs/plans/<slug>.md` per the Plan Artifact convention, **extended for trace parity with `/plan`** (`commands/plan.md` §6). Header carries the convention-1 fields plus the trace lines:
```
Status: ready
Shape: <slices | procedure | mixed>
Created: <YYYY-MM-DD>  ·  Source: <the dispatched scope / findings refs that spawned this>
Objective: <name>                 # from §1's registry match, or "unnamed"
Seed: direct                      # a dispatched scope has no promoted ticket
```
Then the sections in the **same order `/plan` uses**: `## Goal`, `## Scope`, `## Validation` (the §2.5 criterion), `## Stack Decision` (kept intact from §2), `## Manifest`, `## Risks / unknowns`, and an empty `## Deviations`. The **Manifest** is the core, built **on the stack just approved**:
- Vertical slices, each independently shippable and landable in a single `/next-ticket` → build → `/land-ticket` cycle. **Fewer, fatter tickets** (`craft/planning.md`): a part is an end-to-end verifiable deliverable with a runnable acceptance check — finer slicing lives at the milestone layer in `/spawn-tickets`, not in fragment parts.
- Each part: one line of intent + the concrete artifact it produces + a short `Acceptance` checklist (verifiable from diff/tests, per convention 3) + the shaping fields `/plan` §6 emits — **`route:<build|fix-bug|research>`** (by deliverable; spikes → `research`) and **size `S|M|L`** (by discovered difficulty, not symmetry). Line shape: `- [ ] P<n>. <intent> — route:<x> — <S|M|L> [— blockedBy P<m>]`.
- Order by dependency, rooted on the spine (dependency follows coupling, not narrative order); note blockers (feeds `blockedBy` later). Keep the `## Stack Decision` section intact.

## 4. Confirm + hand off
- Tight summary: goal (1 line), the ordered Manifest (titles only). The Stack Decision was already signed off in step 2 — don't re-litigate it; just note it's recorded. Ask for go/adjust on the manifest — concise.
- On go: set `Status: ready`. Do **not** commit the plan here — `/spawn-tickets` commits + pushes it to `<baseBranch>` as part of its atomic Linear-write transaction (convention 1; ensures origin's `<baseBranch>` has the plan before `/next-ticket` forks the project worktree).
- **End — name the next step:** print exactly `/spawn-tickets docs/plans/<slug>.md` and a one-line note that it creates the Linear project + tickets.
