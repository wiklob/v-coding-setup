---
description: Implement the active ticket end-to-end — follow /scope plan if present (else inline plan), code per Acceptance, /verify-tests, commit, push. Full autonomy by default; flags introduce checkpoints.
argument-hint: "[--stop-after-plan | --stop-after-implement | --no-push | --no-commit | --force]  (no args = run all phases to /land-ticket hand-off)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, mcp__linear, Skill, Agent, AskUserQuestion
---

# /build — implement the active ticket end-to-end

Implements the ticket's Acceptance, verifies, commits, pushes. Sits between `/next-ticket` (or `/resume-ticket`) and `/land-ticket` in the chain:

```
/next-ticket → [/scope] → /build → /land-ticket
```

`/scope` is the upstream planning + tech-stack research step. **Whether it runs is decided upstream by `/next-ticket`'s scope-necessity gate, not here.** When a per-ticket plan exists at `docs/plans/<ticket-id-lowercased>-build.md` (gate said *scope*), `/build` reads + follows it; when it doesn't (gate said *skip*, or `/scope` was never run), `/build` runs its own inline plan (§3). `/build` **never errors on a missing scope plan nor demands one** — it proceeds either way.

**Default = full autonomy, no stops.** Flags additively introduce checkpoints (§0). Preflight failures stop unconditionally — they are precondition checks, not mid-run interruptions. Mid-run, the only stops are documented retry-budget exhaustion (verify) and structural impossibility (Acceptance turns out wrong).

Read `~/.claude/workflow-conventions.md` first (esp. conventions 3, 4, 5, 12) and follow it — convention 12 means also reading the **active model profile** (`pipeline/profiles/`): it keys §3.5's design-check routing, plan-trust posture, and autonomy. (**Under `/go`** both are already in context from the chain's top-of-run read — skip this re-read per the `read-discipline` knob (V-293); a standalone `/build` reads them here.) Then `~/.claude/craft/README.md` — the craft register (the judgment substrate; see conventions §10). For the §4.5 / §4.6 "is this actually done?" self-check, load `~/.claude/craft/judgment.md`: its `## Constraints` + `## Anti-Patterns` are the rail each "done" claim is critiqued against. And load `~/.claude/craft/building.md` — the building-domain rail for §4's "am I building the best version of the *goal*, or just satisfying the literal Acceptance text?" judgment, and the §4.7 follow-up-reflex call (in-scope-cheap ⇒ do now; spin out only the genuinely separable).

## Linear MCP call discipline

One `get_issue` per invocation (the ticket being built). In feature mode, one `list_issues` (`project: <bound> state: "In Progress" assignee: "me" limit: 3`) to find the active ticket via current branch. No other list calls.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). Use `linearTeam`, `scopeLabel`, `baseBranch`, `requiredCheck`.
- Use `WT_ABS="$root"` (this skill assumes the session is already inside the ticket's worktree, established by `/next-ticket` or `/resume-ticket`; we don't re-enter).

## 0. Parse flags

From `$ARGUMENTS`, capture any of:
- `--stop-after-plan` — stop after §3 inline planning (only meaningful when no `/scope` file exists; with a `/scope` file §3 is skipped, so this flag is a no-op).
- `--stop-after-implement` — stop after §4 (committed but unverified).
- `--no-push` — stop after §5 (verified + committed locally; skip push).
- `--no-commit` — stop after §5 with the working tree dirty for user inspection (also implies `--no-push`).
- `--force` — proceed past a `needs-eyes` scope plan's unresolved validation items without stopping in §4 (the user has already decided to build despite them), **and** the human's ack to build despite a present non-`sound` `## Thesis-check` block at §3.5 (same deliberate-override role), **and** the human's standalone pre-ack of the §3.5 **deep-ticket pre-code architecture ack-gate** (V-325 — a `depth-class = deep` ticket's `sound`-verdict checkpoint; `--force` keeps a human-present `/build --force` from having to answer that gate interactively). Deliberate use only; the ack is never auto-injected, and **`/go` never injects `--force`** — so under `/go` the deep architecture gate always fires and `/go` drives it per `go.md §2`. (There is no longer a scope-existence gate to override — a missing scope plan never blocks `/build`; see §2.)

Multiple flags compose. Default (no flags) = run all phases through §7 hand-off.

## 1. Load context

- Run `node ~/.claude/bin/ticket-worktree.mjs migrate-binding --worktree "$WT_ABS"` before reading binding state; malformed/conflicting legacy state hard-STOPs. Then read with `node ~/.claude/bin/ticket-worktree.mjs read-binding --worktree "$WT_ABS"`. Branch on the returned JSON mode (no direct legacy-marker access):
  - **Standalone mode** (`mode: "standalone"`): active ticket = `binding.linearIssue`.
  - **Feature mode** (has `linearProject` + `planSlug`): active ticket = the In Progress issue in the bound project assigned to me. One `mcp__linear list_issues` (`project: <bound> state: "In Progress" assignee: "me" limit: 3`); match the issue whose `gitBranchName` equals `git -C "$WT_ABS" branch --show-current`. Per `/next-ticket`'s In-Progress guard there should be exactly one — 0 means preflight will fail at §2, >1 means drift (STOP, surface).
- `mcp__linear get_issue` on the active ticket. Capture: title, description (Goal + Acceptance), `gitBranchName`, state, parent project.
- **Resolve the ticket's route** (`build | fast | fix-bug` — the chain-entry router; `/build` reads, never re-decides): from the in-session hand-off when `/next-ticket`/`/go` ran in this session; else from the `Route:` line in the ticket's comments (one scoped `list_comments` — the only extra list call this skill permits, and only on this cross-session path). No `Route:` record (pre-router ticket) → default `build`. The route keys §5's fast-lane verify-skip; nothing else in `/build` branches on it.
- Read parent plan at `$root/docs/plans/<planSlug>.md` if feature mode and `planSlug` set. Locate the ticket's Manifest part + Stack Decision section.
- Read per-ticket plan at `$root/docs/plans/<ticket-id-lowercased>-build.md` if present. **This is `/scope`'s output** — when it exists, follow its implementation steps in §4. Read its **`## Implementation design`** section (the critiqued *how* — approach + named seams + intended change shape + alternatives + premises, defined in `docs/implementation-design-rung.md` §1): this is the build contract §4 follows, not a hint. If the plan has no `## Implementation design` section (a legacy plan predating B4, or a skip-gate ticket), don't fail — degrade per §2.
- Read repo root `CLAUDE.md`. Do NOT pre-open subdir CLAUDE.mds or feature files — they load on demand in §4 when implementing (preserves the per-subdir cascade discipline `/next-ticket` is also careful about).

## 2. Preflight (convention 4 soft prerequisites)

Stop on any failure. All checks are precondition-level.

- **Linear state must be In Progress.** Else → name `/next-ticket <ID>` or `/resume-ticket <ID>`, STOP.
- **Current branch matches the ticket's `gitBranchName`.** Else → drift; surface and STOP. Don't auto-switch — uncommitted work elsewhere is the user's to absorb.
- **Working tree clean.** `git -C "$WT_ABS" status --porcelain` empty. Dirty → STOP and ask user to commit/stash. (Resuming mid-build with prior uncommitted work happens via `/resume-ticket`; `/build` itself assumes a clean start.)
- **Scope plan — informational, never blocking.** `/next-ticket`'s chain-entry router + scope-necessity decision already decided scope-or-skip for this ticket (route `fast` guarantees the skip; the rubric in `next-ticket.md` §5 is the single source of the criteria — `/build` does not re-derive or re-decide). Honor the outcome:
  - **Plan present** at `docs/plans/<ticket-id-lowercased>-build.md` (gate said *scope*, `/scope` ran) → follow it in §4; §3 inline planning is skipped. If that plan carries a `## Implementation design` section, it is the build contract §4 follows. If it doesn't (a legacy plan predating B4), **degrade gracefully — never STOP:** print a one-line warning (`scope plan has no ## Implementation design section — following its ## Approach / ## Implementation steps as the design (legacy plan; /scope <ID> re-captures the full design)`) and build from the plan's `## Approach` + `## Implementation steps` as today. This mirrors `/thesis-check`'s own degrade-on-missing-design path (its §0) so the chain behaves consistently for pre-B4 tickets.
  - **Plan absent** (gate said *skip*, or `/scope` was never run) → proceed with §3's inline plan, **regardless of ticket size or sensitivity**. For a ticket that `/next-ticket`'s rubric would flag as scope-worthy, print a one-line note (`no scope plan; proceeding with inline plan — /scope <ID> available if a written plan is wanted`) and continue. **No STOP, no `--force` needed.** `/build` neither errors on a missing scope plan nor demands one. ("Plan absent" means no *`/scope`* plan — §3 itself materializes a lightweight design plan file on this path so the inline design can be adversarially checked before §4; see §3.)

## 3. Plan inline (skipped when `/scope` plan exists)

If `docs/plans/<ticket-id-lowercased>-build.md` exists → skip this phase entirely; §4 follows the `/scope` plan's steps.

Otherwise (no `/scope` plan — the gate decided *skip*, or `/scope` was never run):
- Print 3-5 lines: files I'll touch (best-guess from Acceptance), approach, verification strategy. A skip-decision ticket doesn't get a full `/scope` plan (convention 1's "non-trivial work writes a plan first" is satisfied upstream: if the work warranted one, the gate would have said *scope*) — only the lightweight design-plan §3 materializes below so the inline design can be adversarially checked.
- **Capture a lightweight inline implementation design** with those lines — the same five fields a `/scope` plan's `## Implementation design` section carries (`docs/implementation-design-rung.md` §1), one line each: **approach** (the concrete mechanism, not the goal restated), **affected seams/files** (named), **intended change shape** (refutable), **one alternative + why-not**, **any load-bearing premise + its probe**. This is the skip-gate path's design, so every ticket reaching `/build` — scoped or skipped — builds from a stated design rather than re-deriving the approach ad hoc in §4 (the drift this rung closes). §4 follows it as the contract and §7 surfaces any deviation from it.
- **Design-touching skip-gate tickets — detect-and-carry (V-281).** Run the same design-touching check `/scope` §1/§3 runs: if `ticket-flow.json` carries a non-empty `designDoctrine` array **and** this ticket is design-touching (the `design` label, or a user-facing-surface Goal/Acceptance), read the configured doctrine docs, fold the product requirements (full surface not a reskin/harness · existing shells/zones integrated · doctrine honored) into the five fields above, and stamp a `Design-touching: yes — doctrine: <paths>` line as the first line of the materialized `## Implementation design`. This is set at design-authoring time, **upstream of §3.5**, so the §3.5 thesis-check reads the carrier and applies its conditional product sub-bar (P1–P3) on the skip-gate path too. Engineering-only ticket (no `designDoctrine`, or no user-facing surface) → no carrier line, no product sub-bar.
- If `--stop-after-plan` was passed → STOP. Print `result: planned (no scope file); re-run /build to implement, or /scope <ID> for a written plan`. (The thesis-check below is skipped on this early-exit — it guards the §3→§4 boundary, and `--stop-after-plan` writes no code.)

**Then — materialize the design to the plan file (skip-gate path only).** A skip-gate ticket has no `/scope` plan, so persist the inline design here; §3.5 (below, **both paths**) then adversarially checks whatever design the plan now carries. The file is required because the design→build boundary owes a durable, re-readable design and a durable adversarial verdict for `/go`'s gate-audit (§7) — so the design is persisted, well-formed, not left only in the turn's output:

- **Write the inline design to a lightweight plan file.** Create `docs/plans/<ticket-id-lowercased>-build.md` (path lowercased — the same casing `/scope` writes and `/thesis-check` / `/land-ticket` read, so it resolves on a case-sensitive FS; the worktree write is permitted under `$WT_ABS/**`, convention 5) containing: a `## Goal` (from the ticket); a `## Implementation design` section carrying the five fields captured above (heading **byte-identical** to what `/thesis-check` §0 and `scope.md` §6 read — a divergent heading makes the critique read an empty design); and a minimal `## Pre-build validation` listing each Acceptance item with its inline-classified artifact-kind (the `scope.md` §3 rule — `code` / `migration` / `dashboard-config` / `manual-verify` / `invariant` — the same classification §4.5 computes, persisted here so the file is well-formed for §4.5 and `/land-ticket` §4.8). Header line `Created: <date> by /build (skip-gate inline design)` (stamp `<date>` from a `date +%F` Bash call) so a reader can tell this is the lightweight skip-gate file, not a full `/scope` plan.

## 3.5 Thesis-check the design (single owner; both paths)

The design→build boundary owes an adversarial thesis-check on **every** path and for **every** driver (`/go` or a human running `/build` directly), **before** §4 writes any code — the rung's "both paths" invariant (`docs/implementation-design-rung.md`). `/build` is its **single owner**: the check fires here, once, keyed on whether the plan already carries a verdict; `/go`'s separate step-4 invocation is retired (`go.md` §5).

By this point the build plan `docs/plans/<ticket-id-lowercased>-build.md` (path lowercased, the shared casing rule) exists on either path: `/scope` wrote it on the scope-gate path; §3 just materialized it on the skip-gate path. Resolve it, then:

1. **Idempotency trigger — grep the plan for a `## Thesis-check` block** (`grep -q '^## Thesis-check' <plan>`; match the literal heading — it is byte-identical to what `/thesis-check` §4 appends and `/go`'s gate-audit reads).
   - **Absent** → the design has not been checked. **Route per the active profile's `design-check` knob** (convention 12; `pipeline/profiles/`), **conditioned raise-only by the ticket's `depth-class`** (V-323; read from the hand-off / the comment's `Depth-class:` line the same way §1 resolves the route; absent ⇒ `standard`): **`deep` ⇒ the subagent check fires regardless of the profile's self-check setting**; `light`/`standard` leave the profile's routing unchanged — the conditioner raises rigor above the profile floor, never lowers a gate:
     - **Subagent check** (always under `opus-4-8`; under `fable-5` only for net-new architecture, a `deep` depth-class, or on request) → **invoke `/thesis-check <ID>`** via the `Skill` tool: it reads the `## Implementation design`, red-teams it against its 7-item bar, appends a dated `## Thesis-check` verdict block to the plan, and returns a verdict. (Unavailable in this session → degrade as §5 does for `/verify-tests`: print a loud one-line warning that the design was **not** adversarially checked, and proceed — `/build` does not hard-fail on missing in-repo tooling.)
     - **Self-check** (the `fable-5` default for pattern-following work) → red-team the design yourself against the same 7-item bar (`thesis-check.md` §1) and append the same dated `## Thesis-check` block, with `Verdict: sound (self-checked)` when all seven hold or the honest non-`sound` verdict when they don't. Same block format, same plan file — the gate below and `/go`'s gate-audit read it identically; `(self-checked)` is an annotation, not a different contract.
   - **Present** → a human, or a prior `/build` run, already ran it. **Do not re-run the check** (idempotent). Read the **latest** `## Thesis-check` block's `Verdict:` line for the gate below and §7's hand-off.
2. **Gate on the verdict — one contract, both paths, any driver.**
   - A **non-`sound`** verdict (`wrong-approach` / `simpler-alternative` / `missing-seam`) → STOP. Render the halt in the **convention-11 human-readable shape** — the same shape as the sibling deep-ticket ack-gate above: a `<TICKET-ID>: <goal>` restatement line on top, a legible verdict/reasoning line, then the `needs input:` line — never the bare verdict word:
     ```
     <TICKET-ID>: <one-line goal, from the plan's ## Goal>
     Thesis-check verdict: <verdict> — <reasoning> (bar: <triggering item(s)>)
     needs input: the design did not pass the thesis-check. It can be resolved in-session — amend the `## Implementation design` and re-run `/thesis-check <ID>` (§3.5 reads the latest block), or re-scope (`/scope <ID>`); or build the design as-is despite the verdict, a deliberate override (`--force`). Reply with how to proceed.
     ```
     Do **not** fall through to §4. The **amend** and the **re-scope** are drivable in-session — by the agent or the human — producing a fresh design the check re-runs against; the **build-despite ack** is the one deliberate override: `--force` (§0) is that ack, never auto-injected (mirrors `/thesis-check` §4 and `go.md`'s hard rule). When `/go` drives this build, the stop surfaces as a `/build` hard stop it logs `forced` — `/go` never injects `--force`, so the build-despite ack stays a human decision — and `/go` reads this same `## Thesis-check` block for its gate-audit verdict line (`go.md` §5).
   - A **`sound`** verdict → the design is sufficient to build from. **Then, the pre-code architecture checkpoint (V-325), keyed on the ticket's `depth-class`** (already resolved in step 1 — no second read, no parallel calibrator):
     - **`deep`** → render a convention-11 **`[HARD STOP]` ack-gate** presenting the *formed* architecture decision for human review **before §4 writes any code**. This is **not** a second stop — it *reuses* the thesis-check's already-formed-and-validated decision (the plan's `## Implementation design` + this `sound` verdict) as the thing reviewed; it is a branch of this same §3.5 verdict gate, one mechanism. Render it per convention 11 (the third gate kind — the `[HARD STOP]` ack gate):
       ```
       <TICKET-ID>: <one-line goal, from the plan's ## Goal>
       Architecture decision (thesis-check sound): <approach> · seams: <named seams> · shape: <intended change shape>
       needs input: [HARD STOP] deep ticket — review the formed architecture decision above before any code is written. Reply with an ack to build it as designed, or amend/redirect the design. A bare 'p' does not pass this gate.
       ```
       A bare `p` does **not** pass (convention 11 ack gate). Clear it only by explicit human engagement: an **ack** → proceed to step 3 and §4 as designed; an **amend** → edit the `## Implementation design` section (or re-run `/scope <ID>`) then re-run `/thesis-check <ID>`, which re-opens the check on the fresh block; or a standalone **`/build --force`** (§0) as the human's deliberate pre-ack — with `--force` the gate is **pre-cleared** (the flag *is* the ack): §3.5 records the ack and proceeds to step 3 / §4 **without rendering the interactive `needs input:` stop**. When **`/go`** drives this build, this is the ack gate it intercepts **inline** (the gate fires mid-`/build`, before §4) and drives per `go.md §2`'s ack-gate protocol — a bare `p` is re-stated, not passed; only explicit engagement clears it — logging `ack'd`/`intervened` to its gate-audit. `/go` never injects `--force`, so under `/go` this gate always fires on a deep ticket.
     - **`light` / `standard`** → proceed to step 3 and §4 (today's behavior — no gate is rendered). The `depth-class` conditioner is **raise-only**: it adds this checkpoint on `deep`, never on `light`/`standard`, and never lowers any other gate.
   - **Idempotent re-entry (deep, sound-block already Present).** When step 1 found a `## Thesis-check` block already `Present` with a `sound` verdict on a deep ticket, only render the ack-gate if §4 has not yet begun (no code commits on the branch beyond the plan commits — `git -C "$WT_ABS" diff --name-only origin/<baseBranch>...HEAD` shows only `docs/plans/<id>-build.md`). Once §4 has produced any code commit, treat the checkpoint as already cleared and proceed — do not re-block a resume on a decision the human already passed. (Under `/go` this never arises — `/go` does not re-enter `/build` mid-chain; it is the human-`/build`-resume corner.)
   - **Repeated-re-check escalation note (V-302) — surface only, never a verdict change.** A non-`sound` design that a human keeps amending-and-re-checking is the residual amend thrash (the materiality threshold removed the *build-surfaceable* rounds at their cause — `thesis-check.md` §1 — but a genuinely-material flaw can still draw a person back several times). When the plan already carries **≥2** `## Thesis-check` blocks (`grep -c '^## Thesis-check' <plan>`) and the latest is still non-`sound`, append one line to the `needs input:` above: `re-checked N times — the flaw is material across rounds; consider re-scoping (or `/scope <ID>`) rather than another amend.` This **changes no verdict and no gate decision** — it does not flip the stop to a proceed, does not `--force`, does not lower the verdict; it only surfaces a suggestion to the human, who still decides. (A counter that *flipped* the verdict was the rejected design — `thesis-check.md` §4's "the filter bounds them, a counter must not".)

3. **Commit the plan — durable verdict + clean tree (V-226).** Once the gate resolves to **proceed** (a `sound` verdict on a `light`/`standard` ticket; a `deep` ticket's `sound` verdict once the step-2 architecture ack-gate is cleared; or a human `--force` ack of a non-`sound` one), stage + commit the build plan so the `## Thesis-check` block step 1 appended (by either the subagent or the self-check route) — and, on the **skip-gate** path, the freshly-materialized plan file itself — is durable in the PR and the working tree is clean before §4. Without this the appended block stays an uncommitted working-tree edit: it never reaches the PR (the merged plan carries only the scope-time version), and at `/land-ticket` §7 the leftover-modified `docs/plans/<ticket-id-lowercased>-build.md` makes `worktree-remove.sh` refuse (exit 128), deferring teardown. `/build` owns this commit — not `/thesis-check` (which only *appends* the block; its hard rules scope it to writing, and it is also run standalone by humans) — because all other commits in this flow already live here and this is the one place that also covers the skip-gate file `/thesis-check` never created.
   - **Skip under `--no-commit`** (that flag's whole intent is to leave the tree dirty for inspection — §0 / §4).
   - Otherwise, **guarded commit** (no-ops when nothing is staged — the idempotent re-entry where the block is already committed, or a human pre-committed it): `git -C "$WT_ABS" add docs/plans/<ticket-id-lowercased>-build.md` then `git -C "$WT_ABS" diff --cached --quiet -- docs/plans/<ticket-id-lowercased>-build.md || git -C "$WT_ABS" commit -m "docs(plan): thesis-check verdict <verdict> for <ID>"` (path lowercased; `<verdict>` is the resolved verdict word; match the repo's commit style; the subject names only this ticket's own open ID, per the bare-closed-sibling-id hard rule below).

(`--stop-after-plan` exits within §3 before reaching here, so an early exit that writes no code is never gated — the check guards the design→§4 boundary, which `--stop-after-plan` never crosses; the plan-commit above likewise only runs once the gate is reached.)

**Worked example — the pre-code architecture checkpoint (V-325; encoded proof, test-less repo).** Two runs demonstrate the `depth-class` branch on step 2's `sound` path (a worked example is the proof analog for a shell/markdown repo, per `scope.md` §3 / `thesis-check.md` §5):

- **Deep ticket → the gate fires before edits.** A `depth-class = deep` ticket reaches §3.5; the subagent check returns `sound`. Step 2's `deep` arm renders, before §4:
  ```
  V-325: add the pre-code architecture ack-gate to /build §3.5
  Architecture decision (thesis-check sound): extend §3.5 step-2's sound arm with one deep branch · seams: build.md §3.5 + go.md §1/§3/§5 · shape: a [HARD STOP] ack-gate reusing the formed decision, no second stop
  needs input: [HARD STOP] deep ticket — review the formed architecture decision above before any code is written. Reply with an ack to build it as designed, or amend/redirect the design. A bare 'p' does not pass this gate.
  ```
  §4 does not run until the human acks — so no file is edited before the architecture decision is reviewed (**Acceptance 1**). Under `/go` a bare `p` is re-stated, not passed (`go.md §2`); an ack logs `ack'd`, a redirect logs `intervened` (**Acceptance 4**).
- **Light ticket → no gate.** A `depth-class = light` (one-line, well-specified) ticket reaches §3.5 with the same `sound` verdict; step 2's `light`/`standard` arm proceeds straight to step 3 and §4 — no ack-gate is rendered (**Acceptance 2**). The checkpoint is raise-only: it exists only on `deep`.

Both runs share the **one** §3.5 gate — the ack-gate is a branch of the existing verdict gate, not a duplicate pre-code stop (**Acceptance 3**).

## 4. Implement

**Follow the implementation design as the build contract.** The design — the `## Implementation design` section of the `/scope` plan, or the inline design from §3 — names the agreed approach, the seams it touches, and the intended change shape (and, when `/go` or the user ran `/thesis-check`, it survived that adversarial bar). Build to *that*: implement the named seams with the stated shape, rather than re-deriving a fresh approach inline. This is what closes the drift gap thin plans left — the design is the decision, §4 executes it. (For a legacy plan with no design section, §2 already degraded to following its `## Approach` / `## Implementation steps`.)

**When implementation must diverge from the design, record it — never silently.** If a named seam turns out wrong, a materially better approach surfaces, or a step is reordered/dropped, log a convention-2 deviation the moment it happens (don't reconstruct at the end):
- **Plan-backed ticket** → append to the build plan's `## Deviations` section (`docs/plans/<ticket-id-lowercased>-build.md`, path lowercased):
  ```
  ### <YYYY-MM-DD> — <short title>
  Designed: <what the ## Implementation design said>
  Did instead: <what actually happened>
  Why: <the discovered constraint / better approach / blocker>
  ```
  Stamp the date from a `date +%F` Bash call; the worktree write is permitted under `$WT_ABS/**` (convention 5).
- **Skip-gate ticket** (inline design, no plan file) → carry the same Designed / Did-instead / Why into the §7 hand-off, so the divergence is visible going into `/land-ticket`.

A deviation that invalidates a later design step → note that and adjust. The design is the source of intent (conventions 1/2); an unrecorded drift from it is the exact failure this rung exists to prevent.

Iterate Acceptance items in order (or a `/scope` plan's `## Implementation steps` when that section is present — the skip-gate lightweight plan §3 materializes has only `## Implementation design`, no steps, so it falls back to Acceptance-item order; either way §4 follows the `## Implementation design` as the contract). For each:
- Read the files implicated by the item. **This is the moment to pay the per-subdir CLAUDE.md cascade cost** — building requires reading the code. For a **large component / CSS / lib file** where the edit targets a known region, read a targeted `offset`/`limit` range (or grep to the line first) rather than pulling the whole file — CB-284's build spent 438.7k Read tokens, 44% of its context, on whole-file re-reads (`read-discipline`, `pipeline/profiles/opus-4-8.md`). Pull the whole file only when the change genuinely spans it. On a **large design build** (many files, the CB-284 class), follow the context-budget + hygiene playbook — `docs/large-build-context-budget.md` (digest-then-act · narrow reads · drop stale reads · a cumulative Read-footprint budget checked with `bin/read-footprint.mjs`).
- Edit / Write per the change. Stay within the worktree (`$WT_ABS/...`); never write across worktrees.
- **Create any migration with `sb-new <name>`, never a hand-authored timestamp (V-330).** A migration's `YYYYMMDDHHMMSS` prefix is the PK in `schema_migrations`; a hand-authored round-number `…000000` prefix collides across parallel worktrees — git merges the distinct filenames cleanly, so the clash is invisible until `db push`/`db reset`. `sb-new` mints a collision-free monotonic prefix (`max(now, latest+1s)`) and writes a stub you then edit to add the DDL. The `guard-migration-authoring` PreToolUse hook rejects a hand-authored round-number / non-monotonic prefix at write time, and `/land-ticket` §4 + the CI guard re-check the merged set across sibling branches (`docs/migration-collision-guard.md`).
- **No routine doc upkeep when `cfg.docs.maintenance` is `"daily"` (V-284):** don't fold freshness headers, changelog lines, or incidental doc-drift fixes into the build — the daily `/docs-refresh` pass batches all of it into one reviewed PR. A doc change the ticket's *goal* genuinely requires is in-scope work, not upkeep (convention 9's dual) — do that one.
- Run cheap inline sanity checks as warranted (e.g. `npx --no-install tsc --noEmit` after a TS change if the change is small and the check is fast; full verify is §5).
- Commit when the item is logically complete (skip this step entirely if `--no-commit` is set; leave the working tree dirty and proceed): `git -C "$WT_ABS" add <files> && git -C "$WT_ABS" commit -m "<conventional message — verb-first, references the ticket ID>"`. Match the repo's existing commit-message style (`git -C "$WT_ABS" log -5 --oneline` if unsure). One commit per Acceptance item when items are atomic; one final commit when items don't decompose cleanly (e.g., a single-file refactor satisfying 4 Acceptance items at once).
- Never `--no-verify` (the repo's pre-commit hooks exist for a reason; if one fails, fix the underlying issue).

**If implementation reveals the Acceptance item is wrong, unimplementable, or premised on an incorrect understanding of the code** → STOP with `needs input: Acceptance item N looks wrong because <specific reason citing file:line>. Suggest /scope <ID> for a re-plan, or edit the ticket to correct.` Do NOT silently reinterpret — the ticket's Acceptance is the contract, and a mismatch is signal. (Exception: if the scope plan flagged this item `needs-eyes` and `--force` was passed, the user already chose to build despite it — proceed per the plan's suggested resolution instead of stopping.)

> **Origin-recovery exception — read the origin transcript before acting on a suspected-wrong premise (any bucket).** On **any** ticket (any bucket), when the "premised on an incorrect understanding" conclusion is that the ticket's scope/premise is wrong in **either** direction — *the bug looks made-up / stale / non-reproducible*, **or** the premise reads true but the framing/scope feels off and you're unsure you're building the right thing — do **not** discard/close/build on that conclusion yet: first apply `next-ticket.md` §6's origin-transcript recovery (`/ingest-convo` the handle resolved from the ticket's `conversations:`/`sessions:` line, its `/capture` `Source:`, or a stated provenance pointer such as a `report-bug` `errors.jsonl` entry) and re-decide from the source. Degrade safely per that section when no handle is recoverable or the transcript is GC'd. (The build-time premise/scope safety net.)

If `--stop-after-implement` was passed → STOP. Print `result: implemented + committed on <branch>; not yet verified. Run /verify, or re-run /build to continue from §5`.

## 4.5 Acceptance reconciliation (never tick an unbuilt artifact)

Done is what you **observed**, not what you intended (convention 8; craft rail: `craft/judgment.md`). Reconcile each Acceptance item against what's actually in the diff — the check that stops an item being treated as done when its real deliverable is missing (a `migration` item ticked without its migration is caught only after an irreversible merge).

- Changed paths: `git -C "$WT_ABS" diff --name-only origin/<baseBranch>...HEAD`.
- For each Acceptance item, read its **artifact-kind** from the plan's "Pre-build validation" section at `docs/plans/<ticket-id-lowercased>-build.md` (derive the path lowercased — same casing rule the rest of `/build` uses). This section is present both for a `/scope` plan and for the lightweight plan §3 materialized on the skip-gate path, so read it from either. No plan file at all (e.g. `--stop-after-plan` ran without materializing, or a legacy run) → classify inline with the same rule `scope.md` §3 defines (`code` / `migration` / `dashboard-config` / `manual-verify` / `invariant`).
- An item is **done only when its kind's artifact is present in the diff**:
  - `code` → the file(s) the item implies are in the changed-paths list.
  - `migration` → a `supabase/migrations/*` file is in the changed-paths list. Absent → **the item stays explicitly open, never ticked.**
  - `invariant` (asserts a negative/security property — *X is denied*, *Y cannot happen*; keyword-gated per `scope.md` §3) → **diff-presence of the enforcement code does NOT satisfy it.** Done only when an **encoded regression test/probe asserting the negative** is in the changed-paths list (in a test-less repo, a committed probe script or a worked example demonstrating the property). Enforcement code present but no such test → **the item stays explicitly open, never ticked** (`open — invariant, no encoded proof in diff; needs-eyes at land`). A shipped resolver "proves" nothing about "raw reads still denied" — only a test exercising the raw read does.
  - `dashboard-config` / `manual-verify` → no artifact ever lands in the diff, so `/build` **cannot** verify these; they stay explicitly open with a note (`open — manual-verify, confirm at land`). `/build` never claims them.
- Do NOT edit the Linear acceptance checklist here (`/build` is silent in Linear). The reconciliation result is reported in §7 so the still-open items are visible going into `/land-ticket`, which gates on them (§4.8).

This phase never blocks — it records truth, it doesn't fix. But if an item's kind is `migration` and the migration it promises *should* exist yet isn't in the diff, that's the signal the build is incomplete: finish it back in §4 before handing off, rather than handing a known-incomplete ticket to `/land-ticket`'s hard gate.

## 4.6 External-mutation read-back gate (convention 8)

Whereas §4.5 reconciles Acceptance items against **the diff**, this gate covers any **external / live mutation the build performs** — a POST/PUT to a provider, a dashboard API call, a resource created in Supabase/Grafana/Cloudflare — whose success cannot be proven by the diff because it lands in a live service, not a file. Same craft rail as §4.5 (`craft/judgment.md` `## Anti-Patterns`: *a fabricated identifier* standing in for one the response never returned) — the read-back is how you **observe** the mutation instead of reporting the intent to perform it. Per `~/.claude/workflow-conventions.md` convention 8, before claiming such a mutation succeeded (or writing any doc that asserts it):

- **Read it back.** GET (or otherwise observe) the artifact and assert it exists, using the **real returned identifier**, before claiming "done/active" or committing docs that assert live state. A docs claim about external state cites the verifying GET, not the intended outcome.
- **Never fabricate identifiers.** IDs/UIDs/handles come from the actual response only — never invented to fill a slot. A missing ID is a failure to surface, not a blank to fill.
- **Never swallow error bodies.** Check HTTP status before piping through `jq`; on non-2xx, surface the body. (The Grafana-2026-05-30 class: a swallowed 400 + fabricated UIDs shipped a false "built + active" while the real list was `[]`.)

This gate has no effect on the common ticket that performs no external mutation (a pure code/markdown change) — it fires only when the build actually creates or mutates live external state. It never blocks the diff; it blocks the **claim**.

## 4.7 Out-of-scope defect discovered mid-build — triage, don't fix

When build or manual-test surfaces a defect **outside the current ticket's Acceptance scope** — a systemic bug in an unrelated subsystem, or a gap a *prior* ticket never actually delivered — the move is **triage-not-fix**: capture enough to file a good spin-out ticket, file it, and return to the current ticket. Do **not** turn the session into the fix for the out-of-scope defect.

- **First place the realization on the ridge — do not reflex-spin-out an in-scope-cheap improvement** (`craft/building.md`, the follow-up reflex). The triage-not-fix rule below is for genuinely *out-of-scope* or genuinely *separable* (in-goal but large — its own design/blast-radius/verification) work. A realization that is **in-scope and cheap** — part of the best version of *this* ticket's goal, foldable in while your hands are already in the code — is not a follow-up: **do it now.** Filing it for later is the reflex mis-firing (the V-254 feedback: droids file follow-ups instead of doing in-scope-cheap improvements). The burden is on *genuinely separable*, not on *file it*; spin out only when separable is the honest call, and the spin-out names *why* it's separable.
- **Investigate only up to "enough to write a good ticket."** That means: the symptom, a minimal repro, and at most a *hypothesis* of the cause clearly flagged as unproven. A short diagnosis that *produces a good spin-out ticket* is fine and often necessary — that's where the line sits.
- **The line is crossed** (and the work belongs in the spin-out's own build, not here) when you: make live code edits to the out-of-scope area, run a full `/scope` / build-plan on the fix, or run repeated repro/diagnostic/PUT-poll cycles to *confirm* root cause. File the ticket first; investigate there.
- **File the spin-out**, then return: `mcp__linear save_issue` (new issue, `<scopeLabel>`, an Acceptance checklist per convention 3) — or for the standalone bucket, the same as any one-shot. Capture the symptom + repro + unproven-hypothesis (the session itself is the evidence pointer). Then resume the current ticket's Acceptance.
- **Default is not a hard STOP** — most sessions never hit this, and a quick triage-then-resume keeps the current ticket moving. The **one** case that escalates to `needs input:` is when the out-of-scope defect **blocks** completing the current ticket's own Acceptance (you cannot finish without it): STOP with `needs input: <current-ticket> is blocked by an out-of-scope defect <symptom>; filed <spin-out-ID>. Resolve there first, or advise how to proceed.`

Convention 9: the spin-outs were correct, the delay and depth before them was the cost — file the spin-out first, investigate inside it. (This is the build/manual-test-*discovery* face; §5 below carries the same rule for a defect surfaced by *verify*, and `/scope` carries the *spec-correctness-before-build* face.)

## 5. Verify

**Fast-lane skip (route `fast` only, diff-checked).** When the ticket's route is `fast` (§1) AND the actual diff is docs/test-only — every path in `git -C "$WT_ABS" diff --name-only origin/<baseBranch>...HEAD` matches `docs/**`, `*.md`, `*.test.*`, `*.spec.*`, or `__tests__/**` — skip the `/verify-tests` invocation entirely and print the recorded line: `verify-tests skipped: route fast + docs/test-only diff`. The condition is checked against the **diff**, not the prediction: any non-docs/test path in the diff → run verify as normal (and by construction a docs/test-only diff contains no `supabase/migrations/*`, so this skip can never mask a migration — the §4.8 land gate stays route-invariant regardless). Any other route, or a mixed diff → no skip:

Invoke `/verify-tests` via the `Skill` tool — it's scoped (only runs checks touching changed paths), classifies failures internally, and is designed to cost ~0 tokens on green. Clean composition.

**Always-on user-visible-surface rail (CB-326 / V-257).** When this build's diff *introduces a genuinely-new reusable user-visible surface* (a new route, screen, or shared component), authoring its regression proof is **required** — `/verify-tests` §5's always-on rail mandates option (a) for exactly this case (in a test-less repo, the committed probe / worked-example analog). This costs nothing on the common build with no new user-visible surface (§5 never prompts), and it is the one place the chain guarantees a new user-facing surface lands with a durable regression proof rather than an ad-hoc post-deploy check. `/build` does not re-implement the rail — it flows into `/verify-tests`, which owns it; this note just names the guarantee so a builder does not treat the e2e as optional.

- **Green** → proceed to §6.
- **Red** → classify the failure:
  - **Code defect I introduced** (real bug, real type error, real failing assertion against new behavior): fix it. Edit, commit (`fix: <one-line>` matching repo style), re-invoke `/verify-tests`. **Cap at 3 fix attempts.** After 3, STOP with `needs input: verify failed 3 attempts at <last failure summary>; surfacing for review rather than thrashing.`
  - **Pre-existing failure unrelated to this ticket** (the failing test/assertion existed on `origin/<baseBranch>` before any of `/build`'s commits): this is the verify-time face of §4.7 — triage, don't fix. STOP with `needs input: verify shows <failure> that pre-dates this branch; out of /build's scope to fix here. Suggest a separate ticket.` (or file the spin-out per §4.7 and resume, when it doesn't block this ticket).
  - **Infra / flaky** (DB unreachable, network, `tenant not found`, known-flaky test): STOP with `needs input: verify hit infra issue <details>; not blind-retrying — confirm root cause first.`

- **Fallback if `/verify-tests` isn't available** in this session: `npx --no-install tsc --noEmit` (the repo's `<requiredCheck>` if it's local-runnable; never bare `npx` — see `/land-ticket`'s warning about the wrong `tsc` package); targeted `npm test -- <changed files>`. Same classify-and-fix loop.

If `--no-commit` is set, do NOT commit verify-fix attempts — surface the issue and STOP with the working tree as-is (let the user decide whether to fold the fix in).

## 6. Push

`--no-push` or `--no-commit` set → STOP. Print `result: verified + committed locally on <branch>; not yet pushed`.

Else → `git -C "$WT_ABS" push -u origin <branch>`. Never `--force`. On rejection (remote moved, conflict): STOP with `needs input: push rejected — <reason>. Likely needs git pull --rebase or someone else pushed to this feature branch; surfacing rather than auto-rebasing.`

## 7. Hand off

Summarize, one block:
- Acceptance items addressed (N of M).
- **Design-stage outcome (§3.5 thesis-check):** the verdict read from the plan's `## Thesis-check` block (`sound`, or non-`sound`-then-amended/acked) — present on both paths, since §3.5 fires whenever the block is absent. This is the surface `/land-ticket` and `/go`'s gate-audit read. On a **`deep`** ticket a `sound` verdict additionally passed §3.5's pre-code architecture ack-gate (V-325) — note the ack (`ack'd`/`intervened` under `/go`).
- **Acceptance reconciliation (§4.5):** items ticked (artifact in diff) vs left open — name each open item and its kind (`migration` / `dashboard-config` / `manual-verify` / `invariant`) so `/land-ticket` §4.8 can gate them.
- **Design deviations (§4):** any divergence from the `## Implementation design` (or inline design) — recorded in the plan's `## Deviations` for a plan-backed ticket, or listed here for a skip-gate ticket. State "none" if the build followed the design as written.
- Files touched (count).
- Commits added.
- Verify status (green / fixed N times / fallback used).
- Push status.

**End — name the next step:** print exactly `/land-ticket` (run when ready to publish + merge).

Emit `result:` on its own line per bg-session conventions: `result: /build completed for <ticket-id> — N Acceptance items implemented, /verify green, pushed to origin/<branch>. Next: /land-ticket.`

## Hard rules

- Never changes Linear state. `/next-ticket` moves to In Progress; `/land-ticket` moves to In Review / Done. `/build` is silent in Linear.
- Never opens or merges PRs — that's `/land-ticket`'s job.
- On **both** paths, the design is checked at §3.5 **before** §4 writes any code — `/build` is the single owner of this trigger, keyed on the absence of a `## Thesis-check` block, idempotent, firing for any driver. *How* it's checked routes per the active profile's `design-check` knob (convention 12); either way a verdict block lands in the plan. A non-`sound` verdict gates (the ack is the human's via `--force`, never auto-injected). On a **`deep`** ticket, a `sound` verdict additionally renders a convention-11 `[HARD STOP]` **pre-code architecture ack-gate** (V-325) before §4 — a bare `p` does not pass it; it reuses the thesis-check's formed decision (one mechanism, no second stop) and `/go` drives it per `go.md §2`, logging `ack'd`/`intervened`. `light`/`standard` render no such gate. On the **proceed** branch §3.5 then **commits the plan** (the appended `## Thesis-check` block, and the skip-gate path's materialized plan file) so the verdict is durable in the PR and the tree is clean for `/land-ticket` §7 teardown — guarded to no-op when nothing is staged, skipped under `--no-commit` (V-226). `/go` reads §3.5's verdict from the plan block for its gate-audit.
- Never claim a created/POSTed artifact done/active without reading it back (convention 8, §4.6); never fabricate an identifier to fill a slot; never swallow a non-2xx response body.
- Never `--no-verify`, never force-push, never `reset --hard`.
- Preflight failures stop unconditionally; mid-run only stops at documented retry-budget exhaustion or structural impossibility.
- Stops always emit `result:` or `needs input:` on their own line — never silent. Confirm gates follow convention 11 — `needs input:` prose, never an `AskUserQuestion` modal.
- Match repo's existing commit-message style; don't impose a foreign convention (no auto-injected `Co-Authored-By` lines unless the repo's existing log style includes them).
- In a commit message, never emit a bare `V-<n>` identifier for an **already-closed** ticket — a commit subject can surface in the PR, where it re-fires Linear's "PR opened → In Progress" auto-attach and reopens the closed ticket (see `/land-ticket` §0). Reference a closed sibling in prose; bare identifiers are only for this ticket's own (open) ID.
- One ticket per invocation.
- Convention 4: at start, soft prerequisite check (§2); at end, name the next step (§7).
