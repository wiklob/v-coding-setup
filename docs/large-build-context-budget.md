> Last verified against code: 2026-07-07 (V-268)

# Large-build context budget & hygiene

A **playbook for a large design build** — a multi-file feature/design build of the CB-284 class, where whole-file re-reads balloon the context window. It is the *practice* that ties together read-discipline rules already living elsewhere, adds an explicit **context budget**, and names how to **measure the reduction**. It restates no rule — each move links to its owning home. Load it **on-demand** when you recognize a large build; it is deliberately not SessionStart-resident, since paying its cost every session is the very waste it fights.

Origin: feedback #9 (2026-06-18) — "read discipline should be tighter on large design builds." Its two siblings landed the pieces this consolidates: **V-232** distributed the read-discipline *rules*; **V-267** built the *enforcement* (`bin/nudge-read-discipline.mjs` + `bin/read-footprint.mjs`).

## When it applies
A **large design build**: a ticket whose implementation spans many files / a whole feature or design surface (the CB-284 class — multiple component / CSS / lib files read and re-read). A one-file fix needs no budget; this practice is for the build where cumulative reads are the dominant context cost. Signal you are in one: the per-build meter (below) trends toward the CB-284 anti-baseline, or the just-in-time nudge (`bin/nudge-read-discipline.mjs`) fires repeatedly.

## The budget
CB-284 is the **anti-baseline**: 438.7k Read tokens = 44% of context, spent largely on whole-file re-reads (`pipeline/profiles/opus-4-8.md:11`). The target for a large build:

> **Keep the build's cumulative Read footprint under ~200k tokens — ≈ ≤ 20% of a 1M context window. That more than halves CB-284's 438.7k.**

This is a **practice target, not a hard land-gate.** It complements the two per-read brakes already in place — the harness hard-ceilings a single Read at ~25k tokens, and `nudge-read-discipline.mjs` nudges at ~15k — by bounding the *cumulative* footprint those per-read signals don't. V-232 deliberately left the reduction not-gated, and V-267's meter already offers a relative `--strict` gate; this budget adds the absolute anchor, not a new stop.

## The playbook (run it mid-build)
Ordered, cheapest-leverage first. Each move's *rule* lives at its linked home — this is the routine, not a re-statement:
1. **Digest-then-act.** Route bulk or exploratory reads through a subagent that returns *findings*, not a file dump — the parent context is the scarce resource (`~/.claude/memory/feedback_subagent_haiku_routing.md`; the `read-discipline` knob, `opus-4-8.md:11`).
2. **Read narrow.** Prefer a targeted `offset`/`limit` range — or grep to the line first — over a whole-file pull when you know the region (`commands/build.md` §4; `opus-4-8.md:11`).
3. **Drop stale reads.** Re-read only the span that changed; never re-pull a whole file to re-confirm one part (`opus-4-8.md:11`). Watch the CLAUDE.md cascade — every read of a deep file re-loads its ancestor docs (`workflow-conventions.md` conv. 6).
4. **Check the meter.** `node ~/.claude/bin/read-footprint.mjs --ticket <ID>`, against the budget above.

## Measuring the reduction
The instrument already exists (V-267); this practice defines *what* to measure against *what*:
- **Metric** — the build's primary-session Read-token footprint from `bin/read-footprint.mjs --ticket <ID>` (it rolls `usage-stats.mjs`'s `tool_result_bytes.Read`, ~4 bytes/token; also surfaced via `scorecard <ID>` lens (c)).
- **Baseline** — CB-284 = 438.7k Read tokens.
- **Target** — the budget above (under ~200k), and no *regression* against recent builds (`read-footprint.mjs` flags `REGRESSION` at the rolling median ×1.5; `--strict` exits 3 for a CI / land caller).
- A large build has landed the reduction when its `read-footprint.mjs` figure sits under the budget and carries no `REGRESSION` flag. The figure is a **per-build observation** — read off a real build's stats after the fact, never asserted ahead of one (convention 8).
