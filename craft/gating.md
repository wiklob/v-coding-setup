# craft/gating.md — gating as judgment

> Status: hypothesis · since 2026-06-05 · evidence: —
>
> Depth behind `craft/README.md`, read when a command has to decide *whether* a change gets reviewed and *how deeply* — the security-review gate (`land-ticket.md §4.6`) above all. Where `judgment.md` gives the general move (name the default instinct, then judge it), this file gives the gate's move: a gate is a **judgment** — "should we look harder at this, and if so how" — not a keyword match. The hard part is doing that without weakening the one detection that must never be talked out of.

## Why a gate is a judgment, not a trigger

A keyword/pattern scan answers one question — *does this diff touch a sensitive surface?* — and answers it cheaply and deterministically. That is worth keeping; it is exactly what catches the diff that disables the permission sandbox even when nobody is paying attention. But it is not the *whole* question. The question a reviewer actually asks is: **does this change deserve a closer look, and how close?** Two diffs can be keyword-identical and warrant opposite treatment — a one-line tweak to a comment near an auth call versus a reauthorization of a trust boundary. A scan can't tell them apart; judgment can. So the gate's job is to ask the second question *on top of* the first, never instead of it.

The failure a pure scan leaves open is the diff that is dangerous in a way no keyword names — a new external input wired into an existing sink, a blast radius that quietly widened past the ticket's acceptance, a change that leans on a security property another part of the system assumes. None of those need a sensitive *filename* or a flagged *token*; a keyword gate waves them straight through. Judgment is what closes that gap. This is `judgment.md`'s "reach for the checklist" instinct in gate form: the scan is the checklist, and the work can still be wrong with every box ticked.

## The asymmetry that makes this safe

Adding judgment to a gate cuts both ways unless you constrain its direction, and one direction is catastrophic. If judgment can *lower* the gate — decide a diff the scanner rated HIGH is "probably fine, skip it" — then the smartest thing in the room becomes the thing that talks the gate out of doing its job. That is how a sandbox-disabling diff gets rationalized through (it always has a plausible-sounding reason; that's what makes it dangerous).

So the gate's judgment is **escalate-only**:

- It may raise scrutiny the deterministic floor didn't ask for — review a diff the scan rated non-sensitive, deepen or focus a review the scan merely triggered, name a risk no token matched.
- It may **not** lower the floor. A deterministic HIGH (the sandbox / permission-surface families — bypass flags, host-scheduler installs, settings permission edits) is non-negotiable: it records its hard-block and routes to the merge gate regardless of how reasonable a case for skipping seems. There is no judgment verdict that clears a HIGH; only a fix or an explicit human waiver does.

The reason is load-bearing, not stylistic: the floor exists precisely because the most dangerous changes are the ones that argue most persuasively for their own safety. Judgment is good at being persuaded. Keeping it strictly above the floor means the gate gets smarter at *catching more* without ever getting smarter at *catching less*. A rail that could reason a HIGH away would be worse than no rail — it would launder the exact diff the floor was built to stop.

## The should-we / how criteria — what to weigh

When the deterministic scan comes back below HIGH (sensitive-but-not-high, or non-sensitive), the gate still asks: does this change earn a closer look? Reason over these, naming *which one* trips and *why* rather than reaching for a yes/no:

- **Trust / permission boundary.** Does the diff change who can do what — an authz check, a role, an RLS policy, a capability grant, what runs with elevated permission? A boundary change deserves review even when no sensitive filename appears in the path.
- **New external input or sink.** Does it wire untrusted input into a new place (a new request parameter reaching a query, a new write to a live system, a new deserialization), or open a new exfiltration path? New edges into or out of the system are where injection and leak bugs live.
- **Blast radius past the acceptance.** Has the change grown beyond what the ticket scoped — touching subsystems the acceptance never named, so something unrelated now depends on it? Scope creep is a review trigger, not just a cleanliness note (`workflow-conventions.md` §9).
- **A leaned-on security baseline.** Does the change rest on, or alter, a current-system property something else trusts ("X is already denied", "this is the only writer")? A baseline shift is invisible to a token scan and is the V-26 class of defect — probe it, don't assume it (`judgment.md`, "trust the framing you were handed").

Tripping one of these is a reason to escalate — run the review the scan would have skipped, or sharpen the one it triggered. None of them is a reason to *skip* a review the floor already demanded; that direction doesn't exist (see the asymmetry above).

## How deep, once you're looking

"How" is the second half of the judgment. A gate that always reviews at maximum depth is as unhelpful as one that never reviews — it taxes every ordinary diff. Match the depth to what tripped:

- A boundary or external-input change → a focused review *on that surface*, not a generic full-diff pass — point the review at the seam that actually moved.
- A widened blast radius → review the newly-touched subsystem, and consider whether the right move is a spin-out rather than absorbing it here.
- Nothing tripped and the scan was clean → the cheap skip is the correct, deliberate outcome, not a gap. A gate that finds nothing to escalate and says so plainly is working, not failing.

## Constraints — hold the gate's decision against these before acting on it

- The deterministic floor's HIGH is **never** cleared by judgment — only by a fix or an explicit human waiver. If a verdict would lower the floor, the verdict is wrong, not the floor.
- An escalation names **which criterion tripped and why** — not "this feels sensitive." A gate decision carries its reason, the same as any rule here (`judgment.md` `## Constraints`).
- A skip is a **stated** decision, not a silent fall-through. "Reviewed against the criteria, nothing tripped, skipping" is an observation; an unexplained skip is the absence of one.
- Review **depth is proportional** to what tripped — the gate doesn't escalate to a full audit to look thorough (that's the *Ceremony* anti-pattern) nor wave through a real boundary change to stay cheap.
- Any current-system property the gate's decision rests on is **probed, not assumed** — a baseline ("already denied") is the thing most worth checking, least safe to trust.

## Anti-Patterns — the shapes to catch in the gate's own reasoning

- **Talking the floor down** — a judgment verdict used to skip or downgrade a deterministic HIGH. The most dangerous shape; the floor exists because dangerous changes argue best for their own safety.
- **Keyword tunnel vision** — treating "no sensitive token matched" as "nothing to review," so a boundary/input/baseline change with no flagged keyword sails through. The gap judgment exists to close.
- **Ceremony escalation** — escalating everything, or to maximum depth, so the gate *looks* rigorous while taxing every ordinary diff. Rigor is load-bearing or it's tax (`judgment.md`).
- **The silent skip** — skipping with no stated reason, so a missed escalation is indistinguishable from a considered pass. A skip owes its one-line why.
- **Assumed baseline** — leaning the decision on "X is already denied" without probing it (V-26). An asserted security property is not a verified one.
