# craft/ — the judgment register (read-first)

> A read-first sibling to `workflow-conventions.md`, loaded **on-demand per command** (a command Reads this file at startup), not SessionStart-persistent. This is the constitution and index for the craft layer; per-domain files load only where they're relevant.

## What this is, and why it's separate

`workflow-conventions.md` keeps multi-step work **inspectable, resumable, and honest** — it is the *procedure* substrate: how to run the steps. This register is the *judgment* substrate: how to run them **with craft** — how a skill exercises designer-grade judgment while it works, rather than only executing the procedure correctly.

The two are deliberately separate. A deep-research pass over the best community skill packs (`plans/skill-craft-layer-research.md`, verdict *conditional*) found that separating a craft/judgment layer from the procedure layer is the structure that most strongly correlates with a real character shift in how an agent works — but it is **not** the canonical Anthropic structure, and it is in tension with the "keep the body concise" token rule. So we adopt it as a *deliberate authoring choice*, and we pay for it cheaply: on-demand load (below) means the register costs once per command invocation, not every turn.

Why separate at all, rather than enrich each command's checklist in place? Because judgment is **horizontal** — the same stance (name your default instinct, self-critique against named constraints, reason diagnostically) applies across `/review-pr`, `/scope`, `/build`, the gate. Duplicating it into each command's procedure both bloats every command and lets the copies drift. One register, referenced from many commands, stays coherent.

## Where craft sits — the ontology (no competing constitutions)

Three distinct layers, each with one job. Keeping them distinct is the point; blurring them is the failure mode this register exists to prevent.

| Layer | What it is | When it's exercised |
|---|---|---|
| `pipeline/principles.md` | the **output quality-bar** — *what* good output is (Beautiful, Frictionless, Privacy …) | judged **top-down at validation** (`/validate`, right-wing) — "did we build the right thing?" |
| `workflow-conventions.md` | the **procedure** substrate — how multi-step work stays honest/resumable | exercised **horizontally**, every step of every skill |
| `craft/` (this register) | the **judgment** substrate — *how* to exercise designer-grade judgment in the moment | exercised **horizontally**, at the point of authorship/decision |

The relationship that's easy to get wrong: **craft references `principles.md`; it never restates it.** `principles.md` names the bar your *output* is held to, checked once, at the top. `craft/` operationalizes that bar for the *moment of work* — it turns "Strikingly Beautiful" into "before you ship this, name the instinct that made it ugly and resist it." If you find yourself copying a principle's text into a craft file, stop and link to it instead. There is one constitution for output quality (`principles.md`) and one for in-the-moment judgment (`craft/`); they point at each other, they do not compete or duplicate.

## How craft loads — on-demand, not persistent

A command reads `craft/README.md` (and any per-domain craft file its judgment step needs) **at startup, per invocation** — the same way every command already opens `Read ~/.claude/workflow-conventions.md first`. It is **not** persisted at SessionStart.

The reason is token cost. A persistently-loaded register conditions every turn but is re-paid on every turn; the research flagged this as the unresolved tension in the community packs that load craft persistently. On-demand load resolves it: per-command judgment work pays for the register once, when it actually needs it. Per-domain files (below) sharpen this further — a command loads only the craft file relevant to its judgment, not the whole layer.

## Authoring conventions (imported from Anthropic `skill-creator`)

These govern how craft files — and the pipeline's command/skill files — are written. They're **imported wholesale, not adapted**, because they're the canonical authoring guidance and they already match what good writing here looks like:

1. **Explain the why behind everything.** A rule with its reasoning attached is more humane, more powerful, and more effective than a bare directive — the reader can judge when it applies and when it doesn't. This file tries to model that: every convention here carries its reason.
2. **Keep bodies concise — under ~500 lines.** Every line in a loaded body is a recurring token cost. Say what must be said; push depth into separate files reached on demand.
3. **Metadata drives invocation.** What a skill is *for* lives in its metadata/description; the body is the procedure. The trigger and the content are different jobs.
4. **Progressive disclosure.** A read-first index points to detail loaded only when relevant — metadata always, body on trigger, resources on demand. This register is the index; the per-domain files are the depth.
5. **No all-caps `ALWAYS`/`NEVER` blocks.** Writing `ALWAYS` or `NEVER` in all caps is a yellow flag — it signals a rule that stopped explaining itself. Reframe it and give the reasoning instead. (The presence of this rule is why you won't find shouting in these files.)

## The craft files (index)

Progressive disclosure — read this constitution first; load a domain file when your judgment step needs it.

- **`craft/README.md`** (this file) — the constitution + index + ontology. Read first.
- **`craft/judgment.md`** — *(arrives in P2 / V-118)* naming and resisting the model's default instinct; `## Constraints` + `## Anti-Patterns` to self-critique output against **before** shipping; diagnostic "why this feels off" over a bare checklist.
- **`craft/authoring.md`** — *(arrives in P2 / V-118)* the `skill-creator` import above, operationalized for writing and revising pipeline skills.
- **`craft/gating.md`** — *(arrives in P6 / V-122)* gating as judgment: a gate asks "should we review this, and how deeply" against named criteria, **escalate-only** above a deterministic detection floor that judgment may never lower. Read by `land-ticket.md §4.6`.
- **`craft/planning.md`** — shaping a project: the seven Connectors principles (research-before-sizing, spine-first root, size-by-difficulty, tier mix, dependency-follows-coupling, validation-sliced-per-milestone, plan-as-source-of-truth), the fewer-fatter-tickets rule, and the `route:` taxonomy. Read by `/plan`, `/plan-quick`, `/spawn-tickets`.
- **`craft/building.md`** — building *from* a ticket (the sibling to `planning.md`'s building *into* tickets): build the **best version of the goal, not the literal ticket text**, on the under-reach↔over-reach ridge (the over-reach edge lives in `judgment.md`); and the untangled follow-up reflex — in-scope-and-cheap ⇒ do it now, spin out only the genuinely separable. Read by `/scope`, `/build`.
- **`craft/governance.md`** — how a craft file earns or loses its place: the per-file `Status` convention (`hypothesis | reinforced | retired`) and the feedback→craft-revision loop that moves a file between those states on evidence. Read when craft itself is under review.
- **`craft/retrofit-backlog.md`** — which commands still need craft and the rule for when to retrofit one. Not a domain file (it carries no judgment depth) — the tracker that keeps "adopt incrementally" from decaying to "never." Consult it when adding craft to a command.

More domains are added as the layer earns them. Each new domain file is a **hypothesis, not a permanent fixture** — it carries a `Status` header (line 1: `> Status: hypothesis | reinforced | retired · since <date> · evidence: <ref>`) and is kept honest by the governance loop in `craft/governance.md`, which routes `/report-feedback` + `/review-skill` evidence into reinforcing or retiring it. (This file and `retrofit-backlog.md` are exempt — the constitution and the tracker aren't hypotheses a single piece of feedback retires; the reason is in `governance.md`.)

## Using craft in a command

A command that exercises judgment reads this register at startup, then brings its **stance** to the judgment step — craft is a lens to self-critique against, not another checklist to tick. Until `craft/judgment.md` lands, that stance is the three markers this project is built to produce: name the default instinct you're about to follow and decide whether to resist it; hold the output against named constraints before emitting it; and when something feels off, say *why* diagnostically instead of reaching for a checklist. A command wires this in by adding a read-first line to its header (see `workflow-conventions.md` §10). Which commands still need that wiring, and the rule for when to do it (judgment-bearing → on next substantive edit or when `/review-skill` flags it; pure-procedure → deliberately left off), is tracked in `craft/retrofit-backlog.md`.
