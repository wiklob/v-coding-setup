---
description: Turn an idea — a promoted ticket ID or free text — into a ticketable plan via real discussion. Frames the capability in ConOps/outcome terms, researches the codebase, decides stack collaboratively, authors a system-validation criterion, exits with a sliced manifest ready for /spawn-tickets.
argument-hint: "<a promoted ticket ID (e.g. ENG-123) or the idea in a sentence or two>"
allowed-tools: Bash, Read, Write, Grep, Glob, EnterPlanMode, ExitPlanMode, AskUserQuestion, Agent, mcp__linear
---

# /plan — idea → discussed plan → ticketable manifest

Read `~/.claude/workflow-conventions.md` first (its §12 selects your model profile — the `research-depth` knob governs §3 here), then `~/.claude/craft/README.md` and, for shaping the manifest, `~/.claude/craft/planning.md`. **Human-default plan command** — interactive, research-driven, opens in plan mode. For subagent-dispatched fast planning (e.g. from `/triage-findings`), `/plan-quick` is the plumbing variant; humans should never need to type that one directly.

`/plan` is the **ConOps rung** of the left wing of the V: it turns a (usually promoted) idea into a discussed plan that carries its **why** (the objective it advances), its **what** (the ConOps capability), and — authored here, on the way *down* — **how we'll know it worked** (a system-validation criterion). The funnel promotes an idea via `/align`; its ticket ID is the seed for `/plan`.

## 1. Frame (briefly) — resolve the input, then frame in ConOps terms

**Resolve the input — ticket ID or free text:**
- Trim `$ARGUMENTS`. Matches `^[A-Za-z]+-[0-9]+$` (e.g. `ENG-123`) → **try the ticket-ID path**; anything else → **free-text path** (today's behavior: the argument *is* the idea; ask for it in one line if missing). A ticket-shaped arg is only *attempted* as a ticket — if `get_issue` returns not-found / errors, **fall back to the free-text path** with `$ARGUMENTS` as the idea, so a free-text idea that happens to look like `foo-12` degrades gracefully instead of hard-failing.
- **Ticket-ID path** — the idea was promoted from the Intake funnel by `/align`:
  - `mcp__linear get_issue <ID>` → the issue **body is the verbatim idea**. `mcp__linear list_comments` on the issue → find the **promote comment** `/align` left, whose format is `Promoted → objective: <name>. <rationale>. Next: /plan …` (owned by `commands/align.md`). **Resolve `<name>` against the registry, not by punctuation:** read the objectives registry at `~/.claude/pipeline/objectives.md` (canonical KB hub, resolved independent of CWD; override via `objectivesRegistry` in `.claude/ticket-flow.json`; never the bare repo-relative `pipeline/objectives.md`) and pick the objective whose name appears in the comment (longest match wins if several do) — the registry is the source of truth and `/align` writes an exact registry name, which may itself contain `.`/`,`. Only if no registry name matches, fall back to the text after `objective:` up to the line end and confirm it with the user.
  - **No promote comment** → the issue isn't a promoted Intake idea: **warn** ("not a promoted Intake idea — proceeding with the issue body as the idea; objective unnamed") and proceed with `Objective: unnamed` (do **not** stop).
  - Team-agnostic: take any issue by ID (any team's prefix) — never filter by team/project.
  - Carry `Seed: <ID>` and `Objective: <name>` into the plan doc (step 6).
- **Free-text path** — `Seed: direct`; the objective is named during discussion (§4) if it isn't already obvious from the idea.

**Frame in ConOps / outcome language** (not implementation-first): in 2-3 lines state the **capability** (what becomes possible), **for whom**, and **why** (the objective it advances). Outcome language — what "done" *delivers*, not how it's built. Note any constraints inferable from the repo (`CLAUDE.md`, key dirs) — quick scan, no deep reads yet.

## 2. Enter plan mode
- Call `EnterPlanMode`. Plan mode is the design environment for this command — research and discussion happen **inside** plan mode, not before. The user implicitly consented by typing `/plan`; if the tool surfaces a prompt anyway, surface it and proceed on yes.

## 3. Research (inside plan mode)

**Depth is the planner's judgment, exercised per your profile's `research-depth` knob** (`pipeline/profiles/<active>.md`). The rubric's first principle is *research before sizing* (`craft/planning.md`); the knob governs who decides how deep:
- **Own-call profiles** (e.g. `fable-5`): weigh the signals — point count, net-new vs pattern-following, cross-cutting coupling — pick the depth yourself, state the choice in one line, proceed. No gate.
- **Recommend-then-gate profiles** (e.g. `opus-4-8`): weigh the same signals, recommend **full** or **small** with a one-line rationale citing them, and stop at a convention-11 gate (`needs input:`); execute the human's chosen depth. Under `/go`, `p` proceeds with the recommendation.

**Full depth is an outcome contract, not a ritual.** When the work warrants it (several plan-points, genuine unknowns, cross-cutting coupling), the research must produce: an *observed-not-asserted* **findings block** — `file:line` per convention 8, findings per plan-point (parallel per-point `Agent` dispatch is the natural mechanism; gate profiles prescribe it, own-call profiles scope their own sweep) — and a **spike proposal for each genuine unknown** (the spike-proposal pattern: an unanswered question — e.g. "verify the API cap" — becomes a `route:research` part, never a hope buried in an impl part's Acceptance). **Small depth** is a light single pass over the directly-touched code. Either way, §6's sizing cites what was found here.

What to actually read:
- Glob/grep to find affected files. Read them.
- Check `CLAUDE.md` (root + relevant subfolder ones) and any system docs the idea overlaps (`docs/architecture.md`, `docs/schema.md`, etc.) for steering rules / context.
- Look at existing patterns the idea should follow (similar features already shipped). Don't reinvent.
- For broad searches across the repo, spawn an `Explore` subagent (Haiku-routed per `~/.claude/memory/feedback_subagent_haiku_routing.md`) to keep parent context clean.
- Note constraints found during research that the idea didn't anticipate.

Output to the user: a short "what I learned" message — current shape of the affected code, relevant patterns, constraints found, anything that changes the framing of the idea. Two paragraphs max, with `file:line` pointers so the user can verify.

## 4. Discuss (multi-turn — this is a conversation, not a form)
After research, open a real dialogue:
- **Scope**: which parts of the idea are in / out for this plan? Surface ambiguities.
- **Objective** (free-text path): if the idea didn't arrive via a promoted ticket, name the objective it advances here — the outcome it serves (cross-check the objectives registry at `~/.claude/pipeline/objectives.md`). A plan that can name no objective is suspect — the funnel's own kill/park test (`/align`) applies; surface that rather than inventing one.
- **Direction**: present 2-3 plausible approaches when warranted, with one-line pros/cons. Use `AskUserQuestion` for discrete forks; freeform message turns for open-ended back-and-forth.
- **Risks**: what could go wrong, what's unknown, what depends on info you don't have.
- **Shape** (see workflow-conventions §1): is this `slices` (N independent PRs), `procedure` (1 ticket with N-step checklist), or `mixed` (research + impl steps in one project)? The choice matters because `/spawn-tickets` reads it and produces very different ticket sets.

Iterate until the user signals readiness. **Do not batch questions** — one topic at a time, real exchange.

## 5. Stack Decision (dialogue, not a table-dump)
- Enumerate every stack-affecting choice the idea forces: new dependency/library, data store, external service, runtime/build, architectural seam, deviation from the repo's baseline (`CLAUDE.md` / lockfile).
- For each, present options with real tradeoffs (cost, lock-in, maintainability, fit with existing stack). Use `AskUserQuestion` when the user's preference materially matters; freeform when one option is obvious enough to recommend with reasoning. Don't dump a table — talk through each choice.
- **For any net-new choice** (a new dependency/library/service, or a novel capability/protocol/algorithm/security surface — not a choice that follows an existing in-repo pattern), call `/research <the solution>` for a prior-art brief: the industry standard(s) + candidate implementations + an explicit import/adapt/build-fresh call per candidate, cited. Let that evidence inform the stack pick rather than deciding on first instinct — prior art *should* shape the stack, not just the later `/scope`. (`/scope` auto-runs the same recon for net-new tickets; calling it here means the stack ADR already reflects it.)
- If the idea needs nothing new: record `Stack: unchanged — builds on existing <X, Y>` and move on.
- Record decisions as `## Stack Decision` ADR section in the plan file (written in step 6).

## 5.5. Validation criterion — author the system-validation test
The left wing of the V authors each altitude's test **on the way down**. `/plan` sits at the ConOps altitude, so it emits the **system-validation criterion**: the answer to *"how will we know this project served its objective?"* — "did we build the right thing?", not just "did we build it right?".
- Derive it **from the objective**, not from the Manifest — it is the project's *top-level* acceptance, above any single ticket's. A restated Goal is not a validation criterion.
- It must be **non-trivial, verifiable, and objective-tied**: a concrete signal an observer could check after delivery — a behavior present end-to-end, a measurable move in the objective's Direction (`~/.claude/pipeline/objectives.md`), an artifact that exists and does X. Avoid "works well" / "users happy."
- This is the seed the right-wing close-out (`/validate`, M5) checks; without it the project ships with no top-level test.
- Settle it with the user in one focused exchange, then record it as `## Validation` in the plan doc (step 6).

## 6. Decompose into the Manifest
Build the Manifest on the agreed stack, honouring the declared `Shape:` — and **shape it against `craft/planning.md`** (hold the proposal to its `## Constraints` before writing; the default instinct to resist is the uniform lattice):
- **`slices`**: vertical slices, each independently shippable in one `/next-ticket` → build → `/land-ticket` cycle — **fewer, fatter tickets**: a part is an end-to-end verifiable deliverable with a runnable acceptance check; slicing finer lives at the milestone layer (`/spawn-tickets` §2), not in confetti parts. Each part: one-line intent + concrete artifact produced + short Acceptance checklist (verifiable from diff/tests, per convention 3).
- **`procedure`**: each step a checkpoint; the whole manifest becomes ONE ticket's Acceptance list. Useful for setup/runbook work (provider config, DNS, dashboard clicks, smoke tests).
- **`mixed`**: each Manifest line declares `[slice]` (becomes its own ticket) or `[checkpoint → P<n>]` (folds into ticket P<n>'s Acceptance).
- **Per part, emit the shaping fields** (consumed by `/spawn-tickets`, routes consumed by Initiative II):
  - **`route:<build|fix-bug|research>`** — classified by deliverable per the rubric's route taxonomy (spikes → `research`; bugs-bucket-origin parts default `fix-bug`; else `build`). Exactly one per part.
  - **Size `S|M|L`** — by discovered difficulty (§3's findings), not symmetry; all-M is a smell to re-examine.
  - Manifest line shape: `- [ ] P<n>. <intent> — route:<x> — <S|M|L> [— blockedBy P<m>]`.
- Order by dependency, **rooted on the spine** (the shared contract/mechanism the rest hangs off — say why it's the spine); dependencies follow coupling, not narrative order (feeds `blockedBy` later in `/spawn-tickets`).
- **Design-core check — recommend a spike-first design part, waivably** (`craft/planning.md` "Design-core → spike-first"). After shaping + ordering the parts, judge whether the project is **design-core**: its spine is an *unproven structural premise* — a layout/composition/arrangement, a data/interface contract, a schema shape, or an interaction model that ≥1 build part hangs off, such that if the premise is wrong the dependents cascade-rework. If it is, **and** the Manifest doesn't already lead with a `route:research` design/spike part the build parts are `blockedBy`, surface a recommendation before writing the plan (a discrete insert-vs-waive fork — `AskUserQuestion` is fine here, `/plan` is human-present):
  `recommend: this project reads design-core (<the unproven structural premise>) — lead with a route:research design spike the build parts blockedBy, so the premise is proven before build. Insert it, or waive.`
  - **Accept** → prepend a `route:research` design/spike part (deliverable: *prove the premise*, per the tier-mix spike rule) and set every dependent build part `blockedBy` it, then continue.
  - **Waive** → proceed with the Manifest unchanged and note the waive in `## Risks / unknowns` (the human declined — recorded, not silent).
  It is a **surfaced recommendation with a one-line rationale, never a silent hard gate** — a silent forced milestone on a clear-cut project is the *Ceremony depth* anti-pattern (`craft/planning.md`). Don't fire when the core follows a proven in-repo pattern, the premise is already settled, or the design question is local to one part and resolvable in-build.
  *Worked example (encoded proof, test-less repo):* an idea whose core is "arrange N feeds into an unproven composite layout other views depend on" reads **design-core** → recommend a leading `route:research` "prove the layout contract" part with the view-build parts `blockedBy` it. An idea to "add a settings toggle following the existing toggles pattern" is **not** design-core (proven pattern) → recommend nothing, the Manifest is unchanged.

Write the full plan file to `docs/plans/<slug>.md` (slug = kebab-case derived from the title) per convention 1's structure, **extended for the ConOps rung**. Header:
```
Status: ready
Shape: <slices | procedure | mixed>
Created: <YYYY-MM-DD>
Objective: <name>                 # from the promote comment, or named in §4 (free-text path); "unnamed" if none
Seed: <CB-NNN | V-NNN | direct>   # the promoted ticket ID, or "direct" for free text
```
Then the sections: `## Goal` (ConOps framing — the capability, for whom, and why, in outcome language), `## Scope`, `## Validation` (the system-validation criterion from §5.5), `## Stack Decision`, `## Manifest`, `## Risks / unknowns`, and an empty `## Deviations`.

## 7. Exit plan mode + hand off
- Call `ExitPlanMode` — this surfaces the plan to the user for explicit approval.
- On approval: plan file is on disk. **Do not commit here** — `/spawn-tickets` commits atomically with its Linear writes (convention 1).
- **End — name the next step:** print exactly `/spawn-tickets docs/plans/<slug>.md` plus a one-line note that it creates the Linear project + tickets.

## Hard rules
- Always enter plan mode before research — research happens *inside* plan mode, with discussion as the medium.
- Resolve the input first: a ticket-ID-shaped arg is fetched from Linear (idea = body, objective = `/align` promote comment); anything else is the free-text idea. Both paths feed the same plan-mode flow.
- ConOps framing and a non-trivial, objective-tied system-validation criterion are **required outputs** — the plan doc is incomplete without `Objective:`, `Seed:`, and a `## Validation` section.
- Stack Decision is a real options analysis with the user's input where it matters, not a foregone conclusion shipped unilaterally.
- Multi-turn dialogue, not batched questions. `AskUserQuestion` for discrete forks; freeform turns for open-ended discussion.
- Honour `Shape: slices | procedure | mixed` in the manifest — wrong shape produces wrong tickets at `/spawn-tickets`.
- Every Manifest part carries exactly one `route:` and an S/M/L size — `/spawn-tickets` stamps the route as a Linear label (Initiative II consumes it); sizing cites research findings.
- A **design-core** project (spine = an unproven structural premise ≥1 build part hangs off) gets a **surfaced, waivable** spike-first recommendation at §6 — a leading `route:research` design part the build parts `blockedBy` — never a silent forced milestone, and never fired on a settled/pattern-following core (`craft/planning.md` "Design-core → spike-first").
- The research-depth decision follows the active profile's `research-depth` knob — own-call profiles state the choice and proceed; gate profiles stop at the convention-11 gate. The depth chosen is always visible in the plan.
- Plan file is written but NOT committed here — `/spawn-tickets` owns the commit (convention 1).
- `/plan` writes **no** Linear project metadata — project creation, `description`, and initiative-attach are `/spawn-tickets`' job (§3). Never call `save_project` to push the ConOps/`## Validation` text into a project `description`: it is hard-capped at 255 chars (over-limit → `projectUpdate` Argument Validation Error, no mutation — V-241). The long framing lives in this plan doc, and post-spawn in the project's content body / a status update.
- For subagent-dispatched parallel planning, the dispatcher uses `/plan-quick`, not this command. This command requires a live user.
