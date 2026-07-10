# craft/governance.md — how a craft file earns or loses its place

> Status: hypothesis · since 2026-06-06 · evidence: —
>
> Depth behind `craft/README.md`, read when craft itself is under review — a craft file feels off, feedback keeps faulting a command's judgment, or it's time to re-check whether the register still earns its cost. Where `judgment.md` keeps the *work* honest and `authoring.md` keeps the *writing* honest, this file keeps the *register* honest: it is the loop that lets a craft file be reinforced or retired on evidence instead of accreting forever.

## Why craft needs its own loop

The research this layer is built on was explicit that craft files are **unproven hypotheses** — three single-author repos describing *intent*, not measured output (`plans/skill-craft-layer-research.md`; the parent plan's Risks). `/review-skill` (P9) already reviews *commands against* craft; nothing reviewed whether the craft *files* still earn their place. Without that, a craft file that stopped helping — or never did — stays loaded forever, paying its token cost every invocation while shaping judgment on a guess. That is the *Ceremony* anti-pattern (`judgment.md`) made permanent. This loop is the missing half: the way a hypothesis gets confirmed, revised, or dropped.

## The provenance/status convention (every domain craft file carries one)

Line 1 of every **domain** craft file (the ones that carry a judgment rail — `judgment.md`, `authoring.md`, `gating.md`, this file) is a status header, the craft analog of the System-doc freshness header (`workflow-conventions.md` §6):

```
> Status: hypothesis | reinforced | retired · since YYYY-MM-DD · evidence: <ref(s) | —>
```

The three states and the evidence that moves a file between them:

- **`hypothesis`** — the default at authoring. The file is in force and read where relevant, but unproven: no evidence yet says its rail changed an outcome. `evidence: —` until some arrives.
- **`reinforced`** — confirming evidence exists, so the hypothesis is holding. A move here **requires a non-`—` evidence ref** — a `/review-skill` verdict that leaned on the file, or feedback validating its rail. A `reinforced` with empty evidence is itself a smell this loop is meant to catch (it claims a result it never observed — the intended-state-success shape, `judgment.md` `## Anti-Patterns`).
- **`retired`** — disconfirming evidence: the rail repeatedly produced Ceremony, or reviews kept passing/failing regardless of it, so it stopped earning its cost. A retired file is **kept, not deleted** — the audit trail matters (`workflow-conventions.md` §2's never-rewrite-history spirit) — but it is marked out-of-force and its rail is no longer routed into commands. Retiring is the file losing its place; keeping the record is how the next author sees *why* it lost it.

**Two structural exemptions, with their reason.** `craft/README.md` (the constitution + index) and `craft/retrofit-backlog.md` (a tracker, not a domain file — it carries no judgment rail) do not carry a status header. They are not hypotheses in the same sense: the README is the register's framing and the backlog is a worklist, neither of which a single piece of feedback retires. They evolve by ordinary editing, not by this loop's state machine.

## The loop — four stages

The loop turns a subjective impression into a craft revision without ever forcing a decision at capture time. Each stage names where its judgment lives.

1. **Capture** — `/report-feedback` drops one free-text impression into `pipeline/audit/feedback.jsonl`, tagged with a `subject` (the command or topic it's about). This stays Tier-3 zero-decision (`craft/retrofit-backlog.md`): the front door forces nothing, so the friction stays near-zero. No classification happens here.
2. **Classify (craft vs procedure)** — the discriminator, and it lives at the **consumer**, never at capture. Read a feedback entry and ask: does it fault a *judgment call a craft rail shaped* — "/review-pr rubber-stamped this", "/scope's verdict felt like a checklist", "the gate escalated everything"? That implicates **craft** → this loop. Or does it fault a *step or mechanic* — "the command crashed", "the wrong file was edited", "this was slow"? That is **procedure** → it routes to the existing paths (`/scorecard`, `/report-bug`), not here. The test is whether changing a `craft/` file would address the impression; if only a command's steps would, it isn't craft.
3. **Trigger** — what actually fires a craft review (named below, so it isn't left implicit).
4. **Review + revise** — the actor is `/review-skill` pointed at the craft file (it already self-describes as "the closing loop that lets each `craft/` hypothesis earn or lose its place"), or a human reading this file. The outcome is a craft revision: flip the file's `Status` with the evidence ref, edit the rail, or retire it.

## What triggers a craft review (the named trigger — not left implicit)

Any one of these fires a review of the implicated craft file:

- **(a) Emphasis-aware feedback signal (mechanized by `/harvest-feedback`, V-265).** When feedback whose subject resolves to a craft rail (or a command's judgment step) reads as genuine signal — a single strong or precise impression, **or** a re-mention escalating in urgency / annoyance / refinement — that crosses from noise to a review candidate. **Emphasis, not raw count, is the gate:** the daily `/harvest-feedback` pass reads the actual notes and judges intensity, so a user need not repeat a thing three times for it to register. *(This replaces the former "N≥3 same-subject hits" count floor — owner decision 2026-06-24: a count is a crude proxy for signal; the LLM reading the note is a better one. Recurrence now **raises confidence**, it is not required.)* The irreversible act — retiring / reinforcing the rail — still happens via a human `/review-skill`, never unattended.
- **(b) The mechanical surface — `/harvest-feedback` (V-265), plus the periodic `/scorecard --aggregate` pass.** Craft-review candidates are now surfaced **mechanically**: `/harvest-feedback` reads `feedback.jsonl` daily, clusters by subject, judges emphasis (trigger (a)), and emits a craft-revision proposal for a human `/review-skill` — so a craft-implicating cluster no longer waits on someone remembering to look (see "How it's surfaced — mechanized" below). `/scorecard --aggregate` remains the broader cross-session "what's ceremony vs load-bearing" pass over all the audit sinks (it keys off `subject` the same way); it and `/harvest-feedback` are complementary surfaces, not competing ones.
- **(c) A `/review-skill` run that keeps failing the same command on the same rail.** When `/review-skill` repeatedly flags a judgment-bearing command for the *same* rail and the fixes don't stick, the evidence points at the *rail*, not the command — review the craft file the rail comes from. This closes the review-skill→"the rail itself is wrong" path that `review-skill.md` already gestures at.

## Worked example (one full turn)

The test-less-repo proof analog (`commands/scope.md` §3): walk one feedback entry from capture to a `Status` flip without a gap.

1. **Capture** — a session runs `/report-feedback "/scope's validation verdict read like a box-ticking checklist, didn't name why anything was off" --subject scope`; a week later, `/report-feedback "again — the /scope verdict is just ticks, I can't tell what it actually judged, getting annoying" --subject scope`. Two entries land in `feedback.jsonl`, subject `scope`.
2. **Classify** — each faults `/scope`'s *judgment* (its verdict ran as a checklist, the thing `craft/judgment.md`'s "reach for the checklist" instinct warns against), not a step or a crash. → **craft**, and it implicates `craft/judgment.md`'s rail specifically.
3. **Trigger** — `/harvest-feedback`'s emphasis pass reads the two notes in time order: the second escalates ("again… getting annoying" = annoyance), so the cluster crosses trigger (a) as genuine signal at mention #2 — **no count floor** (V-265; the former N≥3 would have shelved it). It surfaces a `/review-skill scope` proposal, `review-mode: auto`.
4. **Review + revise** — a human runs `/review-skill scope`; it confirms the command *does* carry the rail but the rail's "reach for the checklist" framing wasn't landing in the verdict. The evidence **reinforces** that the rail is needed (the failure was application, not the rail being wrong): `craft/judgment.md`'s header flips to `Status: reinforced · since <date> · evidence: feedback.jsonl subject:scope (2 mentions, escalating) · via: auto-harvest + /review-skill scope`. Had the review instead found the rail produced only Ceremony with no outcome change, the same evidence would drive `Status: retired` — the file losing its place, on evidence, not a guess.

## How it's surfaced — mechanized (V-265)

This loop's **surfacing is mechanized** by `/harvest-feedback` — a daily launchd pass that reads `feedback.jsonl`, clusters by subject, judges emphasis (trigger (a) above), and routes: it **auto-files** the objective routes (bug → the bugs bucket, pipeline-ticket → Standalone (V)) and **proposes** the craft-revision route as a `/review-skill` candidate for a human, marking every artifact `review-mode: auto`. Trigger (b)'s former "named cadence" is now this mechanical surface.

**What stays manual — by deliberate choice:** the irreversible craft judgment. Auto-*retiring* (or reinforcing) a rail is never done unattended — *a wrong auto-retire is worse than a slow manual one* — so `/harvest-feedback` only **surfaces** the candidate; a human runs `/review-skill` and owns the `Status` flip. (The earlier "parent plan forbids new runtime dependencies / not this loop's first form" stance is retired — owner decision 2026-06-24: the loop graduated from documented-only to mechanized-surfacing once manual harvesting proved too sporadic. The conservatism that stance protected now lives where it belongs: the human-owned retire judgment, not a gate on surfacing.)

## Links

- Register: `craft/README.md` (index + ontology) · `craft/judgment.md` (the rail) · `craft/authoring.md` (each-file-is-a-hypothesis) · `craft/retrofit-backlog.md` (the adoption rule).
- Loop endpoints: `commands/report-feedback.md` (capture) · `commands/review-skill.md` (review actor) · `commands/scorecard.md` (the cadence trigger).
- Convention: `workflow-conventions.md` §6 (the freshness-header precedent), §10 (craft adoption).
