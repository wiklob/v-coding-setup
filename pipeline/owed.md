# Owed obligations — the deferred-but-owed read-schema

> Part of the [pipeline KB](./README.md). The **doctrine** lives in [`principles.md` §Deferred-but-owed](./principles.md); this file is its **mechanical encoding** — the parseable contract the right-wing close-out reads.

## Purpose

[`principles.md:45`](./principles.md) states the rule: *a Project cannot pass System Validation while an owed principle has neither (a) a verified honoring node, nor (b) an explicit, recorded waiver.* For a command to enforce that, it must mechanically answer three questions:

1. **What does a phase owe?** → the phase→owed map below.
2. **Where is an owe honored?** → the honoring-node line on a milestone.
3. **Where does a waiver live, and what does it look like?** → the waiver record in `decisions.md`.

This file defines all three formats. It is **read-only schema — no enforcement logic.** The reader is `/validate` (V-67, project-altitude), which enforces both the milestone-altitude close-out (its §2 — folded in when V-157 removed the standalone subsystem command) and the project-altitude owed-discharge (its §3). This file does not build it.

## Phase → owed

A phase **owes** a principle when that principle is deferred (not dropped) at the phase. The owe-status of each cell in [`principles.md`'s weight matrix](./principles.md) (`principles.md:27-33`) is read by this rule:

| Cell value | Owe-status |
|---|---|
| `high` / `mid` | **actively held** — not owed (it's being paid now) |
| `0` / `*owed*` | **owed** — deferred-but-owed (`principles.md:43`: "owed, not dropped"; the matrix writes the deferred cell as the literal token `*owed*`) |
| `—` | **n/a** — not applicable at this phase, not owed |

Two principles never enter owe-tracking:
- **Privacy** — always-on (`principles.md:35`), never weighted `0`, never owed.
- **Efficient** — "a working entry, not yet a ratified principle" (`principles.md:33`); excluded until ratified.

**Materialized map** *(derived from `principles.md:27-33` on 2026-06-04; re-derive when the matrix changes — do not hand-maintain):*

| Phase | Owes |
|---|---|
| **Backend** | Beautiful |
| **Frontend v1** | Beautiful |
| **Polish** | — (nothing; it is the phase that pays beauty back) |

> The map is **derived**, not authoritative — `principles.md`'s matrix is the source. If a row/column is added there, re-run this derivation and re-date the map. The *derivation rule* (the cell-value table above) is the durable contract; the materialized map is a dated snapshot.

## Honoring node

A deferral creates a **downstream honoring node** (`principles.md:44`): a later milestone — typically a Polish-phase one — where the owed principle is paid. A milestone declares it is a honoring node with a line in its **milestone description**:

```
honors: <principle> owed-by <milestone-tag>[, <milestone-tag>…]
```

- `<principle>` — the principle name as it appears in `principles.md` (e.g. `Beautiful`).
- `owed-by` — the milestone tag(s) whose owe this node discharges (e.g. `M1`, `M4`, `Self-instrumentation`). Use the milestone's short tag exactly as named in the project so a reader can resolve it.
- One `honors:` line per principle honored; a node honoring two principles carries two lines.

**"Verified" honoring** (the doctrine's word, `principles.md:45`) means the honoring milestone has itself **passed its own close-out check** (`/validate` §2's inlined milestone close-out — all-issues-Done + criterion probe) — i.e. the beauty was actually delivered, not merely promised by the line. A `honors:` line on a milestone that has not passed its own verification is a *claim*, not a discharged owe.

## Waiver

The escape hatch the doctrine allows instead of honoring (`principles.md:45` clause (b)): an **explicit, recorded waiver**. Its home is the existing **"Deferred (owed follow-up work — filed)" ledger in [`decisions.md`](./decisions.md)** (`decisions.md:19`). Format — an append-only, dated entry in that ledger:

```
### YYYY-MM-DD — WAIVER: <principle> owed-by <milestone-tag>[, …] — not honored
**Why:** <why the owe is being released rather than paid>
**Scope:** <which project / milestones the waiver covers>
**Decided-by:** <who made the call>
```

A waiver is **append-only and immutable** like every `decisions.md` entry (`decisions.md:3`): reversing one is a new entry on top, never an edit. The close-out reader treats a present, matching waiver as discharging the owe exactly as a verified honoring node does.

## Worked example — this project's own owed Beauty

> *Illustrative — the project and milestones below come from the authoring pipeline's own history; the mechanics are what you reuse.*

"Build the left wing of the V" demonstrates deferred-but-owed **on itself** (project description, §Phase): every implementation milestone is **Backend** phase except one **Polish** milestone.

**Step 1 — who owes (apply the phase→owed map).** All Backend-phase milestones owe **Beautiful**:

- M1 — Foundations / registries · Backend → owes Beautiful
- M2 — Funnel + alignment gate · Backend → owes Beautiful
- M3 — Objectives root + ConOps upgrade · Backend → owes Beautiful
- M4 — Milestone machinery · Backend → owes Beautiful
- M5 — Close-out ladder · Backend → owes Beautiful
- M6 — Traceability audit · Backend → owes Beautiful
- Self-instrumentation (parallel) · Backend → owes Beautiful

*(The ticket and M7's own criterion phrase this loosely as "M2–M6"; the precise owed-by set is every Backend milestone — M1 and the parallel Self-instrumentation milestone are Backend too.)*

**Step 2 — who honors.** **M7 — Command ergonomics polish** is the sole **Polish** milestone; it is the honoring node. Its description carries:

```
honors: Beautiful owed-by M1, M2, M3, M4, M5, M6, Self-instrumentation
```

**Step 3 — close-out.** When `/validate` (V-67) runs the project's System Validation, it: collects the owe-set from Step 1; finds M7's `honors: Beautiful …` line; confirms M7 passed its own §2 milestone close-out (all-issues-Done + criterion probe) — a *verified* honoring node; and so the owed Beautiful is discharged. Had M7 not honored it, the project could only pass with a waiver entry in `decisions.md`:

```
### 2026-06-04 — WAIVER: Beautiful owed-by M1–M6, Self-instrumentation — not honored
**Why:** pipeline is internal tooling; command-output legibility judged sufficient without a polish pass.
**Scope:** project "Build the left wing of the V"; all Backend milestones.
**Decided-by:** <pipeline owner>
```

*(Illustrative only — the real M7 honors the owe, so no waiver is filed. The `honors:` line above lives here as the concrete target for M7.2; this ticket does not edit the live M7 Linear description.)*
