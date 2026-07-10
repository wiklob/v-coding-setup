# Principles — the constitution

> Part of the [pipeline KB](./README.md) — the index covers how this file stays fresh and who reads it.

Horizontal, phase-weighted constraints that **color every node** of the V. Not tree nodes themselves — they are the quality bar every Objective, Project, Milestone, and Issue is held to.

**Where they're checked:** principles are *validated top-down* at the right-wing top (System Validation — "did we build the right thing?"), never *verified bottom-up* (the bottom vertex tests "does it work," which beauty and friction are not). Functionality is earned at the leaves; principle-conformance is judged against the whole.

---

## The principles

> The set is open, and the three below are **seed examples — keep, edit, or replace them with your own**. Add only durable, everywhere-applicable, never-"done" values. If it can be "done," it's an Objective or a Project, not a principle.

1. **Frictionless Experience** — reduce friction; deliver value fast and obviously. Every interaction should cost the user as little as possible; the path to value is the shortest one that still feels considered.
2. **Strikingly Beautiful** — simple in use, clean, stylishly maximalist at times. Beauty is a property of the whole, judged top-down.
3. **Privacy** — the user's data is theirs. Collect the minimum; expose nothing without consent; treat granted access as sacred. (Governs the *user's data* — distinct from any content-rights objective, which governs what may be done with the content itself.)

*(more to come — extend deliberately)*

---

## Phase weighting

Principles are **not equally important at all times**. Each Milestone declares a **phase**, and the phase selects a weight profile. A weight of `0` does **not** mean "ignore forever" — see *Deferred-but-owed*.

| Phase | Frictionless | Beautiful | Efficient |
|---|---|---|---|
| **Backend** | — | `0` | **high** |
| **Frontend v1** (functional) | high | *owed* | mid |
| **Polish** | high | **high** | — |

(Columns extend as the principle set grows. `Efficient` is a working entry, not yet a ratified principle.)

**Privacy is always-on** — not phase-weighted, never traded for velocity. It does not appear in the matrix because it is never `0`.

---

## Deferred-but-owed

The rule that makes "we'll get there eventually" real instead of a vibe:

- A principle weighted `0` / *owed* at a Milestone's phase is **owed, not dropped**.
- A deferral **creates a downstream honoring node** — a later Milestone (typically a Polish phase) in the same Project where the principle is honored.
- The **right-wing close-out enforces it**: a Project cannot pass System Validation while an owed principle has neither (a) a *verified* honoring node, nor (b) an explicit, recorded waiver.

So "functionality first, beauty later" is structurally correct — the two live at different altitudes of the V — and the trace forbids silently forgetting the second half.

---

## How it's used

- **Skills read this file** as the constitution.
- **Each Milestone declares its phase** → selects the weight profile above.
- **Right-wing validation** (`/validate`) checks conformance to the weighted principles *and* discharges every owed obligation (verified honoring node or recorded waiver).
- **Objectives** are usually a principle *applied to a domain* (`Frictionless` + `onboarding` → "onboarding is smooth"). Principles constrain; Objectives direct.
