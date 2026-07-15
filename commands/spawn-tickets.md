---
description: Turn a ready plan into a Linear project + milestones + tickets — trace wired to the objective's Initiative, milestones carry phase + criterion, issues acceptance-checklisted and dependency-ordered. Preview, then gated bulk-create.
argument-hint: "[docs/plans/<slug>.md]  (defaults to the newest ready plan)"
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion, mcp__linear
---

# /spawn-tickets — plan → Linear project + milestones + tickets

Read `~/.claude/workflow-conventions.md` first and follow it (esp. conventions 3, 4, 5), then `~/.claude/craft/planning.md` — the shaping rubric governs the milestone grouping (§2) and the route labels (§1/§3).

`/spawn-tickets` is the **milestone-authoring + trace-wiring** rung of the left wing of the V: it turns a final plan into a Linear **project** (= the ConOps/feature boundary), **attaches it to the objective's Initiative** (trace-up), groups the Manifest into **milestones** (each declaring a `pipeline/principles.md` phase + a verification criterion — authored here, on the descent), and files the **issues** under them. Milestones are authored **at spawn** — after any manual post-`/plan` edits, once the plan is final — so the plan is read **as-is** from disk.

## Load config
- `cfg="$(git rev-parse --show-toplevel)/.claude/ticket-flow.json"`. Read it; missing → tell user to run `/ticket-flow-init`, STOP. Use `linearTeam`, `scopeLabel`, `baseBranch`.

## Start check (soft)
- Resolve the plan: `$ARGUMENTS`, else newest `docs/plans/*.md` with `Status: ready`.
- None found → warn, name the producer (`/plan "<idea>"`), offer to run it. Don't hard-block (the user may pass a plan path explicitly).
- Read the plan. If `Status` ≠ `ready`, say so and ask whether to proceed anyway.

## 0. Read the plan as-is (honor manual edits)

Read the plan **at spawn time** — it may have been hand-edited after `/plan`, so the file on disk is the source of truth; never re-derive from upstream. Capture, from the header + body:
- `Objective: <name>` — the objective the project advances (trace-up; resolved in §3).
- `Seed: <CB-NNN | V-NNN | direct>` — provenance (recorded in the project description).
- `## Validation` — the system-validation criterion (becomes the project's top-level acceptance; written in §3).
- `Shape:` — `slices | procedure | mixed` (drives §1; default `slices` if absent — backward-compatible with pre-Shape plans).
- `## Manifest` — the parts (drive issues in §1, milestone grouping in §2), including each part's **`route:<build|fix-bug|research>`** and **size `S|M|L`** when present (the `/plan` §6 shaping fields). A part with no `route:` defaults to `route:build` with a one-line note (pre-route plans stay spawnable); size absent → just omit it from the preview.

**Tolerance — never crash.** A **legacy or degraded plan** may lack `Objective:` / `Seed:` / `## Validation` — a pre-M3/M4 plan, or a `/plan-quick` plan that stopped at `stack-needs-review` or matched no objective (the backstop, not the common case). Each absent field **degrades its own dependent step with a one-line warning, independently**; a missing field never aborts the others:
- No `Objective:` (or `Objective: unnamed`) → warn, create the project **unattached** to any Initiative (§3).
- No `## Validation` → warn, write the project description **without** a top-level acceptance block (§3).
- No `Seed:` → omit the provenance line.
- `## Manifest` + `Shape:` are always present (no plan lacks them); an empty Manifest is handled per shape in §1.

## 1. Build the proposed issue set (no writes yet)

Read the plan's `Shape:` field (default `slices` if absent — backward-compatible with pre-Shape plans). Branch on it.

### Shape: slices (default)
For each Manifest part → one Linear issue:
- **Title**: the part's intent, imperative, concise.
- **Description**: the part detail + a `## Acceptance` checklist copied/derived from the part (convention 3 — verifiable items only).
- **Labels**: `<scopeLabel>` (so `/next-ticket` can find it) + the part's **`route:<x>`** label (exactly one; default `route:build` per §0 — Initiative II's consumer reads it).
- **Dependencies**: map plan part-order/blockers to `blockedBy`.
- One part = one issue landable in a single `/next-ticket` cycle — **fat tickets stay fat** (`craft/planning.md`: an end-to-end verifiable deliverable; don't shred it into fragments — finer granularity is §2's milestone layer). Only if a part genuinely cannot land in one cycle, split it and note the split as a Deviation in the plan.

### Shape: procedure
The entire Manifest collapses to **ONE Linear issue**:
- **Title**: imperative summary of the procedure (derived from the plan's title or `## Goal` first sentence). One ticket, no per-part splitting.
- **Description**: the plan's `## Goal` paragraph + a `## Acceptance` checklist whose items are the Manifest parts verbatim. **Preserve P-numbering as a prefix** so the build session can track which step they're on: e.g. `- [ ] P1. <part text>` … `- [ ] P<n>. <part text>`.
- **Labels**: `<scopeLabel>`.
- **Dependencies**: none (single issue, no blockers possible).
- The build session iterates the checklist top-to-bottom; `/land-ticket` verifies each item before closing (convention 3).
- Empty Manifest → STOP, report that the plan has no parts.

### Shape: mixed
Each Manifest part MUST declare its `kind` inline. Two forms accepted:
- `[slice]` — becomes its own Linear issue (per `slices` rules above).
- `[checkpoint → P<n>]` — folded into `P<n>`'s issue as an Acceptance item (prefix the item with the checkpoint's P-number for traceability: `- [ ] P<m>. <checkpoint text>`).

Validation — STOP on first violation, list all problems found:
- Any part missing a `kind` annotation → which lines.
- Any `[checkpoint → P<n>]` pointing at a non-existent `P<n>`, or pointing at another `[checkpoint]` instead of a `[slice]`.
- Manifest has zero `[slice]` parts (a `mixed` plan must have ≥1 slice; otherwise use `procedure`).

## 2. PREVIEW + confirm gate (mandatory)

Print the **project** to create (name = feature, derived from the plan title; team = `<linearTeam>`), the **trace**, the proposed **issues**, and the proposed **milestones**. No Linear writes until the user approves.

- **Trace line.** The resolved Objective + the Initiative it attaches to (`<name> (<id>)`), or `⚠ unattached — <reason>` (degraded/unnamed/unmirrored). The `## Validation` criterion that will become the project's top-level acceptance, or `⚠ none — degraded plan`.
- **Issues**, by shape:
  - `slices` / `mixed`: each proposed issue as `title — route — size — acceptance count — blockedBy`. For `mixed`, list each slice's folded-in checkpoints underneath it so the user sees the full Acceptance shape.
  - `procedure`: the single proposed issue with its **full Acceptance checklist visible** — the user must be able to verify every Manifest part made it in.
- **Milestone grouping (interactive — reasoned over `craft/planning.md`, not a default sort).** Propose a grouping of the Manifest parts into milestones, and show the **rationale** alongside it (the rubric's `## Constraints` are the self-check before proposing; the instinct to resist is the uniform lattice):
  - **Group by channel/concern** — the seam the work divides along (per-connector, per-surface, per-subsystem) — not uniform backend/frontend/polish strata applied regardless of the plan's shape. Milestone counts vary with scope; **small plans may be one milestone or none** — a tiny `procedure` plan needs no milestone layer; say so and skip it.
  - **Root on the spine** — the dependency graph hangs off the shared contract/mechanism the plan named; the grouping shows it landing first. Dependencies follow coupling (chain within a concern, parallel between concerns).
  - **Respect the tier mix** — spikes (`route:research`) come before the impl parts they de-risk; a guarantee part closes its concern's milestone.
  - **Render a leading design/spike part as its own design milestone (the spike-first forcing function).** When the Manifest **leads with a `route:research` design/spike part that the build parts declare `blockedBy`** (`/plan`'s design-core recommendation — `craft/planning.md` "Design-core → spike-first"), group that part as its **own leading milestone** — concern: *prove the structural premise* — placed **before** the build milestones it de-risks. Linear has **no milestone-level `blockedBy`**, so the "build milestones depend on the design milestone" relation is carried at the **issue** level: the build-milestone issues are `blockedBy` the design part's issue (transcribed from the Manifest's dependency map per §1 and §3 — no new transcription, the design part's `blockedBy` edges ride the existing path). Show in the preview that the build milestones depend on the design milestone; the human can re-group, drop, or keep it — the same editability as any milestone, so the forcing stays **waivable at spawn**, not only at `/plan`. A flat Manifest with no leading `route:research` design part forces **no** design milestone (the non-design-core case — grouping proceeds by concern as usual). *Worked example (encoded proof, test-less repo):* a Manifest leading with `P1. prove the layout contract — route:research` + `P2/P3` build parts `blockedBy P1` → a leading **"Prove the layout contract"** design milestone, with P2/P3's issues `blockedBy` P1's issue (the build milestones depend on it). A flat Manifest of independent `route:build` parts with no leading design spike → no forced design milestone.
  For each proposed milestone capture:
  - a **name** (the chunk's intent),
  - a **phase** ∈ `backend | frontend-v1 | polish` — the `pipeline/principles.md` phase that selects the milestone's principle-weight profile (default `backend` for pipeline/plumbing work; use `AskUserQuestion` for the phase fork when it isn't obvious),
  - a **verification criterion** — the milestone's subsystem-altitude test, **sliced from the plan's `## Validation`** (an empirical check an observer can run when the milestone lands — not a restatement of the milestone's name).
  Show which issues fall under each milestone. The user can re-group, rename, re-phase, edit the criterion, or **drop the milestone layer entirely** before any writes.
- **Execution mode (mandatory pick — convention 5; the V-309 fix).** A project's worktree/execution mode is set by its **project label**, and *label-absence silently defaults to feature mode* — the silent default V-309 reported. So make the mode an **explicit, required choice at creation**, never a silent default. Present the fork with `AskUserQuestion` (a discrete-choice fork — convention 11 §AskUserQuestion territory: planning-time, user present), **recommending one option from the plan's shape** but requiring the pick:
  - **`parallel`** — per-ticket parallel execution (standalone mode): independent, non-stage-dependent tickets, each in its own worktree. Recommend for a flat `slices` plan whose parts carry no cross-`blockedBy`.
  - **`milestone-parallel`** — per-milestone parallel execution: one worktree per milestone, sequential within it. Recommend when §2 grouped the work into **≥2 milestones**.
  - **single-thread (feature mode)** — one worktree, sequential tickets: the convention-5 default. Recommend for a `procedure` plan or a small plan with **0–1 milestone**. It carries **no** project label (convention 5: label-absence *is* feature mode) — the pick is still explicit and recorded, it just applies no label.
  Show the recommended mode + a one-line rationale in the preview; the user overrides before any writes. **No third `one-thread`/`single-thread` label is introduced** — the mode resolvers (`next-ticket.md` §1.B) key off the *presence* of `parallel`/`milestone-parallel`, so a feature project is defined by carrying neither; a third label would resolve identically to absence (redundant state, zero behavioral gain) and has no sanctioned API create-path (project labels are UI-created — convention 5). The mandatory pick alone removes the silent default. (V-309.)

Let the user edit titles, scope, splits, fold-targets, milestone groupings / phase / criterion, **and the execution mode** before creating.

## 3. Create (on approval)
- **Resolve the objective → Initiative.** Read the objectives registry — `cfg.objectivesRegistry` (default `~/.claude/pipeline/objectives.md`), `~`/`$HOME`-expanded to an absolute path and **resolved independent of CWD — never the bare repo-relative `pipeline/objectives.md`**. Find the objective whose **registry name** matches the plan's `Objective: <name>` (longest-match — registry names may themselves contain `.`/`,`). Read that objective's `Initiative: <name> (<id>)` line and pass the id via `save_project`'s `addInitiatives`. **Warn and proceed unattached** (never STOP) if: `Objective: unnamed`/absent, the name matches no registry entry, or the matched objective's `Initiative:` is `—`.
- Create the Linear **project** in `<linearTeam>` (`mcp__linear save_project`, `addInitiatives` = the resolved id when attached) — this *is* the feature/worktree boundary (convention 5). **Assemble a short `description` by construction (≤255 — see the cap below):** the plan link + a one-line goal + the `Seed:` provenance line (omit if absent). The plan's `## Validation` criterion is the project's **top-level acceptance**, but it does **not** go in `description` — write it to the project's **content body** (the uncapped project document) or a **status update**, so a long criterion never blows the cap (omit it, with a warning, on a degraded plan). The same short-stub assembly holds for an **update** of an already-existing project (a re-run, or a late initiative-attach): `save_project` with `id` + `addInitiatives` + a short stub `description`, the criterion in the body.
  - **255-char cap on a project `description` (Linear server-side).** Unlike *issue* descriptions (long-form markdown), a Linear **project** `description` is hard-capped at **255 characters**: any `save_project` over the limit — `projectCreate` *or* `projectUpdate` — fails with `Argument Validation Error … description must be shorter than or equal to 255 characters` (`userError`, no mutation applied) and burns retries before the cap is discovered (V-228; recurred on **`projectUpdate`** *after* this note existed — V-241 — because §89 still embedded the verbatim `## Validation` block in `description`, hence the short-stub-by-construction assembly above). **Meet the cap by construction, not by a failed retry:** keep `description` a short stub (plan link + one-line goal + `Seed:`), and put every long thing — the `## Validation` criterion, a cancel-with-rationale `## CANCELED …` note, any multi-paragraph rationale — in the project's **content body** (uncapped) or a **status update** (`save_status_update`), never `description`. The cap applies to **every** project-`description` write — create, update, re-attach, or cancel — not just creation.
- **Set the execution-mode project label (the §2 pick) and read it back (convention 8).** `save_project` **cannot** set a project label — its input carries no label field — so use the raw GraphQL escape hatch (`ProjectUpdateInput.labelIds`, verified V-309):
  - `parallel` / `milestone-parallel` pick → resolve the label id (`mcp__linear list_project_labels`, `name:` filter — **never fabricate the id**, convention 8B), then `mcp__linear linear_graphql` with `mutation($id:String!,$labels:[String!]){ projectUpdate(id:$id, input:{labelIds:$labels}){ success } }`, `variables:{id:<new project id>, labels:[<label-id>]}`. **Read back**: `get_project` on the new id and assert `labels[]` contains the picked label **before** claiming the mode is set (observe, never assert). If the label isn't in the workspace (project labels are UI-created — convention 5), **surface it** — `project label '<name>' not found — create it once under Linear → Settings → Labels → Project labels, then re-run` — rather than silently leaving the project untagged.
  - single-thread (feature) pick → set **no** label (convention 5's absence-is-feature); read back with `get_project` and assert the project carries **neither** `parallel` nor `milestone-parallel` (the deliberate feature-mode state).
- Create the **milestones** (one per approved milestone from §2): `mcp__linear save_milestone` with `project` = the new project, `name`, and `description` = the **phase** + the **verification criterion**. Capture each created milestone's id/name for issue attachment. (No milestones approved → skip; issues are created milestone-less.)
- **Ensure the route labels exist (create-if-missing, once per run).** The workspace issue-label set is `route:build` / `route:fix-bug` / `route:research`. Before the first issue write, check the labels exist (`mcp__linear list_issue_labels` or equivalent); create any missing one (`save_issue_label`, workspace-level so every team shares the set). Self-healing — a fresh workspace bootstraps on first spawn; an existing one is a no-op.
- Create each issue (`mcp__linear save_issue`) with `team`, `project` = the new project, **`milestone`** = its approved milestone (name or id; omit when the issue belongs to no milestone), `labels` = `[<scopeLabel>, route:<x>]` (the part's route; exactly one `route:` per issue), the Acceptance description, and `blockedBy` per the dependency map. **Pass `state: "Todo"` explicitly for the first unblocked slice in the dependency order** (so the Linear board shows it as "next up" without opening); all other issues default to the team default (typically Backlog). For `procedure` shape: the single issue ships as `state: "Todo"`.
- Record created issue IDs back into the plan under `## Tickets`. Format depends on shape:
  - `slices`: one line per part → issue id (`- P1 → ABC-101`).
  - `procedure`: one line for the whole procedure (`- All parts → ABC-101 (procedure)`).
  - `mixed`: one line per part, distinguishing slices (`- P3 (slice) → ABC-101`) from checkpoints (`- P1 (checkpoint → P3) → folded into ABC-101`).
  Also record a `## Milestones` block mapping each created milestone → `phase` → the issues filed under it (or `- none — milestone layer skipped`). Any divergence from the Manifest also goes into `## Deviations`. Set plan `Status: in-progress`.
- **Commit + push the plan to `<baseBranch>` (required — convention 1).** The plan must exist on origin's `<baseBranch>` *before* `/next-ticket` forks the project worktree from it; otherwise it strands on the main worktree and arrives only as a separate post-merge commit. This is a deliberate, docs-only direct-to-`<baseBranch>` exception (no code change). Soft-check: cwd is the main worktree on `<baseBranch>` and the only staged-eligible change is the plan file; if not, STOP and ask. Then: `git add docs/plans/<slug>.md` → `git commit -m "docs(plans): <slug> — Linear project <proj-name>"` → `git push origin <baseBranch>`. If the push fails (remote moved), refresh the **shared** checkout — but **drift-guard it first** (same pattern as `/land-ticket` §7): if `git status --porcelain` is non-empty, do **not** run `git pull --ff-only` — STOP and surface `main worktree has local drift (<files>) — pull/commit it manually, then re-run the plan push.` Clean → `git pull --ff-only origin <baseBranch>` then re-push. **Never** `git stash pop`/`git merge`/`git pull` (non-ff) over the dirty shared checkout — the corruptor. Never force-push.

## 4. End — name the next step
- State the project name, the **execution mode** set (`parallel` / `milestone-parallel` / single-thread, read back per §3), the Initiative it attached to (or that it's unattached + why), the milestones created (name + phase), and the first ready (unblocked) ticket.
- Print exactly: `/next-ticket` *(run it to start the project — for an ordinary repo it will create the project-bound worktree at `<repo>/.claude/worktrees/<repo>-wt-<project-slug>` on first use)*. Note that all subsequent `/next-ticket` in that worktree stay inside this project. The exact `~/.claude` legacy source checkout remains the temporary sibling-layout exception until V-376.
