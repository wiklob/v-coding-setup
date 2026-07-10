# memory/ — the tracked register layer

> Source-of-truth lessons and policies that **shipped pipeline commands cite as authoritative.** Tracked in git, reviewed, versioned — they travel with the commands that depend on them. A sibling to `craft/` (judgment) and `workflow-conventions.md` (procedure); this layer holds the distilled *lessons* those reference by path.

## Why this exists (the defect it closes)

Commands in `commands/` ship via git. Several of them cite lessons — "route read-only work to Haiku," "probe asserted invariants before trusting them" — by the path `~/.claude/memory/<file>.md`. But that directory was never tracked: the lessons lived only in the per-machine harness auto-memory. So the citations resolved on one machine and **dangled on every other checkout** — a portability hole V-121 surfaced and closed.

## The portability invariant

**Anything a tracked file cites must itself be tracked.** A shipped command that points at an untracked file has a broken reference for everyone who isn't on the author's machine. This is the one rule the layer enforces, and it is also the test for what belongs here.

## The graduation rule

A lesson **graduates** from per-machine auto-memory into this tracked layer the moment a shipped command — or other tracked source (`workflow-conventions.md`, `craft/`) — cites it as authoritative. Until then it can stay a personal note. Once cited, it must live here, or the citation violates the portability invariant.

## Boundary — this layer vs the harness auto-memory

Two stores, two roles, deliberately kept separate:

| | `~/.claude/memory/` (this layer) | `~/.claude/projects/<repo>/memory/` (auto-memory) |
|---|---|---|
| Role | canonical lessons shipped commands cite | the model's own evolving notes |
| Tracked? | yes — git source-of-truth | no — per-machine, gitignored |
| Written by | a build, reviewed in a PR | the model, automatically, as it learns |
| Authority | canonical for anything cited | personal, situational |

When a lesson is graduated, **the tracked copy is canonical** for any shipped-command citation. The auto-memory may keep a personal echo; if the two drift, the tracked register wins for pipeline purposes. The auto-memory is harness-managed and gitignored — a build does not edit it.

## Citation guidance

Cite a register by its **tracked path** — `` `~/.claude/memory/<file>.md` `` — in any source-of-truth file (commands, conventions, craft). A bare `[[wiki-link]]` resolves only inside the harness's memory-aware rendering, not as a plain path on another checkout, so reserve `[[…]]` for the model's personal auto-memory notes — not for citing a tracked register. (Historical `docs/plans/*` references are append-only artifacts and are left as-is.)

## Naming

No hard scheme — match what's here. Lesson-style notes use kebab-case (`verify-asserted-invariants.md`); the older `feedback_*` registers keep their snake_case names because commands already cite them verbatim. Don't rename a cited register without sweeping its citations.

## Files

- `feedback_subagent_haiku_routing.md` — which model tier / context a subagent dispatch should use, and what it returns.
- `feedback_chain_command_autonomy.md` — chain commands run to completion unless flagged.
- `verify-asserted-invariants.md` — asserted negative/security invariants need an empirical probe, not artifact-presence.
