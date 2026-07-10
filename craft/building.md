# craft/building.md — building from the goal, not the letter

> Status: hypothesis · since 2026-06-24 · evidence: V-254 (feedback #17/#26/#28/#18/#19, 2026-06-20 surge — "scope ships the literal plan; /build executes it without reaching past; droids file follow-ups instead of doing in-scope-cheap improvements")
>
> Depth behind `craft/README.md`, read when a command turns a ticket into a built change — `/scope` (validate against the goal) and `/build` (implement it). Where `craft/planning.md` shapes a project *into* tickets, this file governs building *from* one. The default instinct it exists to name and resist is **satisfy the letter**: read the Acceptance as a literal checklist, produce exactly those artifacts, defer everything else to "follow-ups," and stop. The result satisfies the words and misses the point — one verified feed shipped where the goal was a working ingestion path.

## The default instinct: satisfy the letter

The pull: the ticket hands you a list of Acceptance items, so the job *looks* like producing one artifact per line and ticking the box. That's the instinct firing before you've judged it — and usually it's even right, because a well-written ticket's letter and goal coincide. It damages when they don't: when the literal items are *evidence of* a goal larger than their sum, and building only the items ships a hollow version that passes its own checklist. The Acceptance is the **proof** the goal was met, not the **definition** of the goal.

## The principle: build the best version of the goal

A ticket's Acceptance items are signposts toward a goal; build the **best version of that goal**, not the narrowest thing that satisfies the literal text. Reason from *what this is for* — the Goal, the originating feedback, the conversation the ticket compressed — and let that decide the shape, then check the literal items off against what you built. When the letter is thinner than the goal, build to the goal and the letter follows; when the letter would have you ship something the goal's owner would call incomplete, that gap is the signal, not a feature.

This is bounded on the other side. `craft/judgment.md`'s **"Deliver more than was asked"** names the opposite failure — widening past the goal into speculative abstraction, unrelated robustness, a blast radius nobody scoped. The two are the two cliffs of one ridge:

- **Under-reach** (this file's instinct) — ship the letter, miss the spirit, defer the real work to follow-ups.
- **Over-reach** (`judgment.md`) — exceed the goal, scope-creep into the next subsystem.

The ridge between them is "**the best version of the goal that is still within the goal**." Build is right when it walks that ridge: fully realizing the goal, nothing speculative beyond it. Neither edge is a license for the other — *build the best version of the goal* is not a warrant to widen scope, and *smallest change* is not a warrant to ship a hollow letter.

## Untangling the follow-up reflex

The follow-up reflex is this same ridge applied to a realization that surfaces *mid-build* — you notice an improvement while your hands are already in the code. The reflex over-fires: it spins the improvement out to a follow-up ticket reflexively, treating "file it for later" as the always-safe move. It isn't — a follow-up that was in-scope-and-cheap is just the goal, deferred, and deferral has its own cost (a second chain pass, a colder context, a ticket that may never rise).

Draw the line by *where the realization sits on the ridge*:

- **In-scope and cheap → do it now.** If the improvement is part of the best version of *this* goal and is cheap to fold in while you're here, it isn't a follow-up — it's the build. Doing it now is the ridge, not scope creep.
- **Genuinely separable → spin it out.** If it is *out* of this ticket's goal, or in-goal but genuinely large (its own design, its own blast radius, its own verification), then it earns its own ticket — file the spin-out and return (`workflow-conventions.md` §9, `/build` §4.7's triage-not-fix).

"Genuinely separable" is the test, and the burden is on *separable*, not on *file it*. Out-of-scope is still triage-and-spin-out (convention 9 is unchanged); what this untangles is the in-scope-cheap case the reflex wrongly swept into the same bucket.

## Constraints — hold the built change against these before handing off

- The change realizes the **goal**, not just the literal Acceptance text — each item is ticked against what serves the goal, and a literal item that would ship a hollow version is surfaced, not silently satisfied.
- The change stays **within** the goal — nothing speculative, no unrelated robustness, no widened blast radius (the over-reach edge; `craft/judgment.md`).
- Every mid-build realization was placed on the ridge: **in-scope-and-cheap was done now**, only genuinely-separable work was spun out — and a spin-out names *why* it's separable, not merely *that* it was filed.
- A follow-up filed for in-scope-cheap work is the reflex mis-firing; catch it in self-critique before it ships.

## Anti-Patterns — the shapes to catch in your own build

- **Hollow-letter build** — every box ticked, the goal not actually delivered (the verified-one-feed-defer-the-rest shape the feedback named). The checklist passed; the point was missed.
- **Reflexive follow-up** — spinning out an in-scope-cheap improvement to look disciplined, when doing it now *was* the discipline. Deferral as a tic, not a judgment.
- **Scope creep wearing "best version"** — using "build the best version of the goal" to justify widening past the goal. The ridge has two edges; this one is `judgment.md`'s. Both are failures.
- **Low curiosity** — executing the plan without ever asking "is this the best version of what this is for?" The plan is the floor of the build, not its ceiling.

Craft is a lens, not another procedure — `workflow-conventions.md` keeps the build's steps honest; this file keeps the build reaching for the goal the steps serve.
