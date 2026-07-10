---
description: System-altitude project validation + deferred-but-owed enforcement — the right-wing top of the V. Confirms a project genuinely validated (every milestone PASS-verified, every owed principle discharged, the system criterion empirically met) before moving it to a terminal validated state. Read-then-write; refuses to validate on any unmet gate, writing nothing.
argument-hint: "[PROJECT]  (project name/id; required when not inferable from the worktree binding)"
allowed-tools: Bash, Read, Grep, Glob, mcp__linear
---

# /validate — system validation + deferred-but-owed enforcement

The **top of the right wing** — "did we build the right thing?" The project-altitude close-out: given a project, confirm it is genuinely validated and, only then, move it to a terminal validated state. Sits **above** `/verify-tests` (leaf/diff) and folds the subsystem-altitude milestone close-out check (formerly a standalone command, folded in here) inline at §2:

```
/verify-tests  →  /validate
   (leaf/diff)      (system — principle conformance + owed discharge; computes the subsystem milestone close-out inline at §2)
```

It enforces two things: that **every** milestone is genuinely closed (all its issues Done **and** its verification criterion empirically met — the subsystem close-out, computed inline at §2), and that **every owed principle** (`pipeline/principles.md` §Deferred-but-owed) has been discharged — a *verified* honoring node or an explicit recorded waiver. A project cannot validate while either is unmet. On a full pass it records a verdict and flips the project's state; on any block it reports exactly what's unmet and **writes nothing** — no half-validated state.

Read `~/.claude/workflow-conventions.md` first (esp. convention 8 — observed-over-asserted state), then `~/.claude/craft/README.md` — the judgment substrate. The core judgment is the empirical one, applied at **both** altitudes this command spans — subsystem (§2, per milestone) and system (§4, the project): a criterion is met only by an **empirical probe**, never by an artifact's presence (`~/.claude/memory/verify-asserted-invariants.md`). The owed-discharge gate (§3) is the part with no lower analog — it is why this command exists rather than a one-line "all milestones closed?" check.

## Linear MCP surface (the reads this command depends on)

Narrow — encoded here so the command never re-probes it:

- **`get_project(query=<name|id>)`** → `{ id, name, description, status: { name, type } }`. The `## Validation` criterion lives in `description`; the terminal state is set on `status`.
- **`list_milestones(project)`** → each `{ id, name, description, progress, sortOrder }`. **`progress` is a percentage, never a closeable signal** — never gate on it. The milestone's `**Phase:**`, its **verification criterion**, and any `honors:` line live in `description`.
- **`list_issues(project)`** has **no `milestone` filter** — enumerate and **filter client-side** on `projectMilestone.id`; Done-ness = `statusType === "completed"`. **Paginate.** (§2 computes each milestone's all-issues-Done directly from this live enumeration — there is no verdict comment to read and no stale-PASS to corroborate, since Done-ness is read live each run.)
- **`save_project(id, state=<status-name>)`** — moves the project to a terminal state. `state` is **free-text resolved against the team's project-status set**; passing an unknown name errors. This workspace ("project v" team) has statuses `{Backlog, In Progress, Completed}` and **no native "Validated"** — so the validated terminal state is **"Completed"** (`completed` type), unless the workspace later defines a status literally named "Validated" (prefer it when present; resolve by name at runtime).
- **`save_comment(projectId=<id>, body=…)`** — the project verdict sink (a project discussion-thread comment). On a full pass this is the **only durable proof the project was *validated*** rather than merely all-issues-done (the `Completed` state alone is indistinguishable from `/land-ticket`'s auto-complete) — so keep the comment unambiguous.

## 0. Resolve the project

- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json` (missing → `/ticket-flow-init`, STOP). `WT_ABS="$root"`.
- Resolve the target, in order: the explicit `$ARGUMENTS` `[PROJECT]` (name or id) → the worktree binding (`$WT_ABS/.claude/active-project.json` → `linearProject`, feature mode) → otherwise STOP and ask (`needs input: /validate needs a project — pass it as the arg.`). A standalone-mode binding (`linearIssue`, no `linearProject`) is a single-ticket worktree, not a project to validate → take the issue's parent project (one `get_issue`) or ask.
- `get_project(query=<project>)` → capture `id`, `name`, `description`, `status`. Not found → STOP and surface (no verdict on a nonexistent project).

## 1. Read the system-validation criterion (Acceptance 1)

From `project.description`, extract the criterion block, **tolerating a degraded project**:
- Prefer a `## Validation` block (the format `/spawn-tickets` §3 writes verbatim from the plan).
- Fall back to a `## System validation criterion` heading (older projects created before `/spawn-tickets` wrote the `## Validation` block — e.g. "Build the left wing of the V" itself).
- Neither present → **warn and continue, do not crash**: `project <name> has no parseable validation criterion (no ## Validation or ## System validation criterion block) — degraded; milestone (§2) + owed (§3) gates still run, but the empirical criterion check (§4) cannot and counts as unmet.`

A missing criterion does **not** silently pass — it blocks the §4 pass (there is nothing to verify against), exactly as §2 blocks a criterion-less milestone. Capture the criterion verbatim for §4 and the verdict comment.

## 2. Milestone close-out gate (Acceptance 2) — computed inline

Every milestone must be genuinely closed: **all its issues Done** *and* **its verification criterion empirically met**. (the former standalone subsystem-close command is folded into this §2 — `/validate` computes the close-out itself.)

- `list_milestones(project)`. Zero milestones → degraded warning (`project <name> has no milestones — nothing to close at subsystem altitude; this blocks validation, it does not auto-pass`); this blocks, it is not a pass.
- For each milestone, compute its close-out from two checks — it **PASSes only if both hold**:
  - **(a) All issues Done.** `list_issues(project)` (paginate `cursor`/`hasNextPage` — a non-Done issue hiding past page 1 is the false-PASS to avoid), filter client-side to `projectMilestone.id === <milestone.id>`; Done-ness = `statusType === "completed"`. Zero matched issues → block (`<milestone-name> — no issues (orphaned/mis-grouped milestone)`). Any non-Done issue → block (`<milestone-name> — open: V-NN <status>`).
  - **(b) Verification criterion met.** Parse the milestone's criterion from its `description`, accepting **all** the markers real milestones use — `**Verification criterion:**` (the format `/spawn-tickets` §3 writes), `Criterion:`, `Verification:`, or an unbolded `Verification criterion:` — matched case-insensitively, bolded or not, so a real criterion is not spuriously read as absent, gating only the genuinely criterion-less milestone. No parseable criterion under any of those markers → block (`<milestone-name> — no parseable verification criterion`); a missing criterion does **not** silently pass — it blocks the same way an open issue does. Then **empirically probe** the property the criterion asserts (the §4 discipline at subsystem altitude — identify the negative/behavioral property, run the cheapest probe that *exercises* it, cite the evidence; never artifact-presence). Probe fails or criterion unprobeable → block (`<milestone-name> — criterion unverifiable: <reason>`).
- **Block** on any milestone failing (a) or (b), listing each offender with its reason. A milestone PASSes §2 iff both (a) and (b) hold; record that per-milestone PASS for §3's recursion.

This is a hard gate: no owed-discharge or system-criterion result lifts a block caused by a milestone that is not closed.

## 3. Owed-discharge gate (Acceptance 3) — the part with no lower analog

Enforce `principles.md:45`: a project cannot validate while an owed principle has neither a verified honoring node nor a recorded waiver. The mechanical schema is `pipeline/owed.md` — **read it, don't re-derive from the `principles.md` matrix** (owed.md is the purpose-built derived schema; reading the matrix directly is what owed.md exists to prevent drifting from).

**Build the owe-set.** For each milestone, parse `**Phase:**` from its description, then apply `owed.md`'s phase→owed derivation:
- Cell `high` / `mid` → actively held, not owed. Cell `0` / `*owed*` → **owed**. Cell `—` → n/a.
- Privacy (always-on) and Efficient (not yet ratified) never enter owe-tracking.
- Materialized today (re-read `owed.md` in case its matrix moved): **Backend** owes **Beautiful**; **Frontend v1** owes **Beautiful**; **Polish** owes nothing.

The owe-set is `{ principle → the milestone-tags that owe it }`.

**Discharge each owe.** An owed principle is discharged iff **either**:
- **(a) Verified honoring node** — some milestone's description carries a `honors: <principle> owed-by <tag…>` line covering the owing tags, **AND that honoring milestone itself passed its own §2 close-out** (all-issues-Done + criterion probe — re-use the per-milestone PASS §2 computed). The doctrine's word is *verified* (`owed.md` §"Verified" honoring): a `honors:` line on a milestone that has not passed its close-out is a *claim*, not a discharge.
- **(b) Recorded waiver** — `pipeline/decisions.md` carries a matching `### <YYYY-MM-DD> — WAIVER: <principle> owed-by <tag…> — not honored` entry (the `owed.md` §Waiver format) covering the owe.

**Block** on any owed principle discharged by neither, naming what's missing: `<principle> owed-by <tags> — no honoring node (no honors: line) | honors: line present on <milestone> but it failed its §2 close-out | no waiver in decisions.md`.

## 4. Empirical criterion check (Acceptance 4) — the core

Verify the §1 criterion by **observing the behavior it asserts**, not by noting an artifact exists — the `verify-asserted-invariants` discipline at system altitude (the same core as §2's per-milestone criterion probe, one rung up):

- Identify the **negative or behavioral property** the criterion claims (e.g. "no parent can close with unmet children or unhonored owed principles").
- Run the cheapest probe that actually **exercises** that property — a grep that confirms the guard *fires* (not merely that a guard file exists), a worked dry-run of the behavior, a read of the live state the criterion describes. In this shell + markdown repo the encoded-proof analog is a runnable/inspectable demonstration (a probe command's output, a worked example), never artifact-presence.
- **Cite the evidence** — the exact command + observed output, the file:line whose behavior you exercised, the live read. A verdict with no cited probe is not a verdict.
- Criterion unprobeable (too vague / references something absent) or absent (§1 degraded) → `criterion-unverifiable`, treated as **unmet** (blocks the pass), reason stated. Never upgrade "I couldn't check it" to a pass.

## 5. Verdict + terminal state (Acceptance 5)

**Refuse-VALIDATE rule.** A project validates only when **all** hold: §2 every milestone closed-out (all-issues-Done + criterion met), §3 every owed principle discharged, §4 the criterion empirically met with cited evidence. Any block in §2/§3/§4 → the project does **not** validate.

- **All pass** → two writes, in order (read-then-write, convention 8):
  1. `save_project(id, state=<validated terminal status>)` — resolve the status name at runtime: prefer a workspace status literally named "Validated"; else the `completed`-type status ("Completed"). Read it back (`get_project` → `status.name`) and assert the move landed before claiming success (convention 8 — never assert the transition from intent).
  2. `save_comment(projectId, body=<dated PASS verdict block>)` — the durable proof of validation (see the MCP-surface note: the `Completed` state alone does not distinguish *validated* from *auto-completed*, so this comment must be unambiguous).
- **Any block** → print the exact unmet set (which milestones, which owes, which criterion result) and **write nothing**: no `save_project`, no `save_comment`. A blocked validation leaves the project exactly as it was.

The verdict comment body:

```
**/validate — <VALIDATED | BLOCKED>** · <YYYY-MM-DD>
Criterion: <verbatim | ⚠ degraded — no parseable block>
Milestones: <n> PASS / <m> total<, unverified/failed: <names> if any>
Owed: <discharged: principle←honoring-milestone (verified) / waiver; OR blocked: principle owed-by <tags> — <what's missing>>
Empirical check: <PASS | unverifiable> — <cited evidence: command + observed output / file:line / live read>
Verdict: <one-line why>
```

Stamp the date from a `date +%F` Bash call (never fabricate it).

Emit `result:` on its own line:
`result: /validate <project> — <VALIDATED | BLOCKED>; milestones <n>/<m> PASS, owed <discharged|blocked: …>, criterion <met|unverifiable>; <state set to <status> + verdict comment posted | nothing written>.`

## Worked examples (the mechanism, demonstrated — the test-less-repo encoded proof)

The block-behaviors (Acceptance 2 & 3) are negative properties; these worked examples are the runnable/inspectable proof they fire, the encoded-proof analog `scope.md` §3 calls for in a repo with no test harness.

**(i) Block on an unclosed milestone (Acceptance 2).** A project whose milestone M5 has an open (non-Done) issue: §2(a)'s paginated `list_issues` filtered to `projectMilestone.id === M5.id` finds `V-NN` still `started` → **BLOCKED**, listing `M5 — open: V-NN started`. Nothing is written. (Sibling case: every M5 issue is Done but its verification criterion cannot be empirically probed → §2(b) blocks `M5 — criterion unverifiable`.) Building the project to all-issues-Done did **not** validate it; the criterion probe (§2b) must also pass.

**(ii) Block on an undischarged owe (Acceptance 3).** A project whose every Backend-phase milestone owes Beautiful (per `owed.md` — that is *every* Backend milestone, including a parallel `Self-instrumentation` one, not just the loosely-phrased "M1–M6"; `owed.md:80`) and whose sole Polish milestone M7 carries no `honors:` line, with no WAIVER in `decisions.md`: §3 builds the owe-set `{ Beautiful ← M1,M2,M3,M4,M5,M6,Self-instrumentation }`, finds no honoring node and no waiver → **BLOCKED**, listing `Beautiful owed-by M1,M2,M3,M4,M5,M6,Self-instrumentation — no honoring node (no honors: line), no waiver`. Nothing is written.

**(iii) Dogfood — this project today.** Running `/validate "Build the left wing of the V"`: §1 falls back to its `## System validation criterion` (degraded — no `## Validation` block — and tolerated). §2 finds M5/M6 milestones not yet closed (open issues / criterion not empirically met). §3 finds M7 carries no `honors: Beautiful owed-by …` line yet (M7.2 adds it). Result: **BLOCKED** on both, nothing written — the enforcer correctly refuses to validate the project that builds it, until its own milestones close and its owed Beauty is honored. (This is the negative property observed firing, not asserted.)

## Hard rules

- **Empirical, never presence.** An artifact existing is not proof its property holds — only exercising the property is (`verify-asserted-invariants`). This is the command's reason for being, applied at **both** subsystem (§2) and system (§4) altitude within this command.
- **Refuse-VALIDATE, no override.** Any unverified/failed milestone (§2), any undischarged owe (§3), or any unmet/unverifiable criterion (§4) blocks the pass — no other result lifts it. There is no `--force`: validation is the honest top-down judgment, not a rubber-stamp.
- **Write nothing on a block.** The only writes (`save_project` + `save_comment`) happen after **all** gates pass; a blocked validation mutates nothing in Linear. Read-then-write (convention 8): every read (§0–§4) precedes the two writes.
- **"Verified" honoring is recursive on §2.** A `honors:` line discharges an owe only if its milestone itself passed its §2 close-out (all-issues-Done + criterion probe); never accept the line at face value.
- **Resolve the terminal state at runtime.** `save_project` `state` is free-text against the workspace status set; never hard-code a name that may not exist — prefer "Validated", fall back to "Completed", and read back the move.
- **Paginate every `list_*`** — a missing PASS verdict, an undischarged owe, or a non-Done issue hiding past page 1 is the false-VALIDATE this command exists to prevent.
- **Never fabricate** a date, a verdict, a status name, or evidence (convention 8); the verdict comes from the actual gate reads.
- One project per invocation. Convention 4: name the next step (`/trace-audit` for the orphan sweep, or project-complete) in the `result:` line context.
