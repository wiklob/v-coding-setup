# craft/authoring.md — authoring skills with craft

> Status: hypothesis · since 2026-06-04 · evidence: —
>
> Depth behind `craft/README.md`, read when you're **writing or revising** a skill, command, or craft file. The README *names* the five `skill-creator` conventions imported wholesale; this file is how to *apply* each one while authoring, and what to look for when revising a file someone already wrote. It operationalizes the list — it doesn't repeat it.

## Why a separate authoring file

The conventions are short to state and easy to nod at, and hard to actually hold to under the pressure of getting a skill written. Stating them (the README's job) and applying them (this file's job) are different work — the same split this register is built on. Read the five in `craft/README.md` first; then use the operational form below.

## Applying the five conventions

**Explain the why, as you write the rule.** Put the reason in the same breath as the directive, not in a later pass that never comes — a rule carrying its reason lets the reader judge when it applies and when it doesn't. *Authoring:* if you can't state why a rule exists, that's the signal it shouldn't. *Revising:* hunt for bare directives, then attach the missing reason or cut the rule.

**Keep the body under ~500 lines — by moving depth out, not by cramming.** Every line in a loaded body is a recurring token cost. *Authoring:* before adding a paragraph, ask whether it belongs in a depth file loaded on demand (the way this file and `craft/judgment.md` sit behind the README) rather than in the always-read body. *Revising:* a file over the ceiling is fixed by extraction to a resource, not by compressing prose into something denser and worse.

**Let metadata drive invocation.** What a skill is *for*, and *when it fires*, lives in its description and metadata; the body is *how it runs*. The two are different jobs and blur badly when mixed. *Authoring:* put the trigger in the metadata, the procedure in the body. *Revising:* read the description alone — does it say what the skill is for and when to reach for it, without leaning on the body?

**Disclose progressively.** A read-first index points to detail loaded only when relevant — metadata always, body on trigger, resources on demand. *Authoring:* write the index first (the README is the model here), then push depth into files reached on demand. *Revising:* a monolith that front-loads everything is the smell; split it into an index plus on-demand depth.

**Reframe shouting into a reasoned constraint.** Writing `ALWAYS` or `NEVER` in caps is a yellow flag — it marks a rule that stopped explaining itself. *Authoring:* the urge to shout is the cue that the reasoning got dropped; write the reason instead. Naming the words to describe the anti-pattern, as inline code the way this sentence does, is fine; a shouting directive block is not. *Revising:* every all-caps imperative is a candidate for reframing.

## Authoring a craft file specifically

A craft file carries extra weight, because the register's whole value is that it stays coherent and never competes with the other constitutions:

- **Reference, don't restate.** If a passage could be replaced by a link to `pipeline/principles.md` (the output bar) or to `craft/README.md` (the ontology), replace it. Restatement is the failure mode this layer exists to avoid — there is one constitution for output quality and one for in-the-moment judgment, and they point at each other rather than copy each other.
- **Each new file is a hypothesis, not a fixture.** A craft file earns its place by being used, and proves it by surviving `/review-skill` (P9) and `/report-feedback`; one that restates an existing file or carries no load is tax, and gets pushed up into the README or deleted. The README says this of the index — it holds for every file the index points to.
- **Adopt incrementally.** A command opts into craft by adding the read-first line to its header (`workflow-conventions.md` §10); the register is the shared source, so a fix lands once and every reader gets it. Don't wire craft into a command whose judgment step doesn't need it yet.

## The test before you commit

Hold the file against the same bar it asks of others: does every rule carry its why; is the body under the ceiling with depth pushed out; is the trigger in the metadata and the procedure in the body; does it disclose progressively; is there an all-caps imperative left to reframe; and could any section be replaced by a link? If that last answer is yes, link it. This is the `craft/judgment.md` self-critique stance turned on authoring itself.
