---
description: A craft-led, loosely-structured session — explore/sketch/refine an idea by judgment rather than the fixed next→scope→build→land chain. Reach for it when the work is exploratory, the shape is unknown, and the procedural chain's gates would be ceremony rather than help.
argument-hint: "[free-text: what you want to riff on]  (bring a direction, not a ticket — there are no phases to pass)"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, WebSearch, Skill, Agent, mcp__linear
---

# /riff — a craft-led, loose session

The pipeline's **divergent path**. The procedural chain (`/next-ticket → /scope → /build → /land-ticket`) is built for *known* work: a ticket exists, the acceptance is clear, and the gates buy traceability and a reviewable PR. `/riff` is for the other kind — work whose shape you don't know yet, where running that chain would mean inventing a ticket and an acceptance checklist for something you're still discovering. It trades the fixed sequence for **judgment**: you bring a direction, the craft register supplies the stance, and you pick what to do next by reading the work rather than advancing a phase.

Read `~/.claude/craft/README.md` and `~/.claude/craft/judgment.md` first — they are the engine of this path, not a footnote to it — then `~/.claude/workflow-conventions.md` for the honesty substrate the looseness sits on top of.

## When to riff, when to run the chain

Pick by what you actually have, not by preference:

- **Riff** when the shape is unknown — you're exploring a question, sketching an approach, prototyping to learn, or reacting to something to find what's wrong with it. The chain's gates would fire against an acceptance you can't yet write, so they'd be ceremony (`craft/judgment.md` Anti-Patterns: *a step that exists to look rigorous and carries no load*).
- **Run the chain** when the work is known — a ticket exists or is easy to write, the acceptance is concrete, and you want the gates, the review, and the PR trail. Forcing that work through `/riff` skips protections it should have.
- **Rule of thumb:** *riff to discover, graduate to the chain to ship.* The two paths are complementary, not rival — most real features start as a riff and finish on the chain.

## The stance

`/riff` is procedure-light and judgment-heavy, so the craft markers carry the weight the missing steps would have:

- **Name the default instinct, then judge it.** The pull to be maximally helpful, complete the pattern, or add the extra abstraction fires *before* you've decided it should (`craft/judgment.md`). In a loose session there's no gate to catch it later — naming it as you go is the catch.
- **Self-critique against the named constraints before you emit.** Hold each thing you produce against `craft/judgment.md`'s `## Constraints` and `## Anti-Patterns`. The looseness is in the *order of work*, not in the bar the work clears.
- **Reason diagnostically.** When something feels off, say *why* in a sentence and act on the why — that diagnostic move is what replaces the checklist a procedural command would hand you.

## Loose moves — pick by judgment

These are moves, not phases: choose any, in any order, repeat them, skip them, interleave them. The point of the divergent path is that nothing here forces a sequence.

- **Explore** — read the code, search the web, map the territory, surface prior art. Cheap and reversible; do it whenever you're unsure, not only at the start.
- **Sketch** — write a rough cut (a draft file, a throwaway script, a few lines of design) to make the idea concrete enough to react to. A sketch is for learning; it is allowed to be wrong.
- **React / critique** — turn the craft lens on what's there (yours or the repo's) and name what's off and why. This is often the most valuable move and the easiest to skip.
- **Refine** — once a direction earns it, tighten the sketch toward something real, holding it against the constraints as you go.

## What stays non-negotiable (looseness is not license)

`/riff` loosens the *procedure*, never the *honesty* — drop that distinction and it becomes a way to dodge the conventions, which is the one thing it must not be. So even with no gates:

- **Observed state over asserted state** (`workflow-conventions.md` §8). A sketch that "works" is claimed working only after you've run it and read the result. No riff output asserts a live outcome it didn't observe.
- **Smallest thing that does the job** (`craft/judgment.md`: *deliver more than was asked* → build the smallest change that fully meets the goal; spin out-of-scope work into tickets per `workflow-conventions.md` §9 *stay on-ticket*). Exploration widens the option space on purpose; the *output* you keep is still the minimal one — spin the rest into ideas or tickets.
- **No fabricated identifiers** (`workflow-conventions.md` §8). IDs, URLs, and handles come from real responses or they're surfaced as missing — a loose session is exactly where invention is tempting.

## Exit — graduate or land

`/riff` discovers; it isn't the thing that ships. End a session deliberately:

- **Graduate** when the riff found something worth formalizing — hand it to `/plan` (a new idea worth a manifest) or to `/next-ticket <id>` / `/spawn-tickets` (work ready to be ticketed and built with gates). The discovery carries over; the chain gives it the trail and the review.
- **Land lightweight** only when the change is genuinely tiny and self-contained, and you've held it against the non-negotiables above.
- **Or just stop** — a riff that produced understanding and no diff is a success, not a failure. Say what you learned and what the next move is (`workflow-conventions.md` convention 4).

## Hard rules

- **No fixed sequence — that's the feature.** If you find yourself enforcing an order, you're running the chain; use the chain.
- **The honesty conventions still bind.** Looseness is in the procedure only (see the non-negotiables above) — `/riff` is never a path around §8 or §9.
- **Don't let a riff silently become a merge.** Anything outward-facing or irreversible graduates to the chain, which owns the gates; `/riff` has none of its own.

Emit `result:` on its own line when a session closes: `result: /riff on <topic> — <what was discovered / sketched>; next: <graduate to /plan|/next-ticket, land lightweight, or stop>.`
