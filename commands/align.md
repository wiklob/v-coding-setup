---
description: Portfolio-reasoning pass over the product Intake funnel — situate the whole Inbox in the live landscape (KB), brief each idea with a soft overridable lean, and on your decision promote / park / kill with a trace comment.
argument-hint: "(no args — reasons over all Inbox items; or an issue ID to focus one, still in landscape context)"
allowed-tools: Read, mcp__linear
---

# /align — the funnel gate (portfolio reasoning)

The alignment gate between the **convergent funnel** and the **divergent V**. One comprehensive reasoning pass over the whole Inbox: it situates every captured idea in the **live landscape** — what's already in flight, what each idea relates to, which objective it advances, how the portfolio is shaped — and hands you a briefing so **you decide** from a full picture. It **reasons, it does not rule**: each idea carries a soft, clearly-overridable one-word lean, never an auto-decision. On your call it moves state + leaves a trace.

This is a single inline pass — **no per-idea subagent**. Holding the whole Inbox in one context is what makes idea↔idea reasoning (clusters, duplicates, one subsuming another) possible, and it is both richer and cheaper than judging each idea in isolation.

## Config
- From `.claude/ticket-flow.json` → `cfg.intake`: `{ "project", "team", "inboxState" }` (same config `/capture` files into). If unset → STOP (`no intake funnel configured in ticket-flow.json`).
- Funnel states: Inbox = `Todo` · Promoted = `Done` · Parked = `Backlog` · Killed = `Canceled`.
- Landscape source: the pipeline KB at `pipeline/` (read per its README contract — §2).

## 1. Load the Inbox (the input set)
- If `$ARGUMENTS` is an issue ID → focus that one idea (still reasoned *in* the landscape — a single idea is judged against the whole picture, not in a vacuum). Else list Inbox items in the configured Intake project (`mcp__linear list_issues`, `project: <cfg.intake.project>` + `state: <cfg.intake.inboxState>`).
- None found → report "funnel empty", STOP.
- Capture each idea's title + verbatim note + source — the *input set* to judge; the portfolio itself is read from the KB in §2.

## 2. Load the landscape (KB — read-contract order)
Read the pipeline KB in the order its README specifies (`pipeline/README.md` → "`/align` v2 read contract"):
1. the objectives registry at `~/.claude/pipeline/objectives.md` (the canonical KB hub — `~`/`$HOME`-expanded, resolved independent of CWD; override via `objectivesRegistry` in `.claude/ticket-flow.json`; never the bare repo-relative `pipeline/objectives.md`) — the trace-tree roots (the objective every promotion must name).
2. `pipeline/landscape.md` — active & admitted projects + current direction (what's actually in flight).
3. `pipeline/principles.md` — the quality bar.
4. `pipeline/parked.md` — has something like this been parked before (and why)? *(consult as needed)*
5. `pipeline/decisions.md` — recent direction shifts that bear on the call. *(consult as needed)*

Read the landscape **from the KB** — do **not** live-reconstruct the portfolio by querying Linear (no `list_projects` / `list_initiatives` at judgement time). The KB is the read surface. If `landscape.md`'s `> Last verified` date or its `<!-- linear:generated -->` stamp looks stale, treat that as a **signal to flag** in the briefing — not as a reason to re-derive here (that refresh is its own command).

## 3. Reason (one inline pass over the whole Inbox)
With every idea and the landscape in context, reason holistically — not idea-by-idea verdicts:
- **idea ↔ idea** — clusters, duplicates, one idea subsuming another.
- **idea ↔ in-flight** — is this already covered by an active/admitted project? does it extend one? conflict with one?
- **idea ↔ objectives** — which objective does it advance (name it), or is it an orphan / new-objective candidate?
- **portfolio shape** — is the funnel piling onto one axis while another starves? is *now* the time for this, given what's already in flight?

## 4. Present + confirm gate (mandatory)
Print, per idea, a **reasoned briefing** that places it in the landscape, ending in a soft lean:
```
[CB-NNN] <title>
  briefing: <where it sits — relations to other ideas, overlap with in-flight work,
             which objective it advances or orphans, portfolio-shape note>
  lean: <promote | park | kill>  (soft — override freely)
```
Then one prompt:
```
Decisions (default = each idea's lean — override any):
  <ID>: promote [→ objective]    — graduate from the funnel
  <ID>: park                     — snooze (Backlog), revisitable
  <ID>: kill[: reason]           — decline (Canceled), trace kept
  accept all                     — take every lean as-is
Anything not overridden takes its lean.
```
**No Linear writes until you confirm.** The lean is advisory — it never mutates Linear on its own.

## 5. Execute (on go)
For each decided idea:
- **promote** → set state `Done`; `save_comment`: `Promoted → objective: <name>. <rationale>. Next: /plan to turn into a project.`
- **park** → set state `Backlog`; `save_comment`: `Parked — <reason / rationale>. Revisit later.`
- **kill** → set state `Canceled`; `save_comment`: `Killed — <reason>. <objective test: named no root>.`
Every transition leaves a trace comment — no silent moves. If any write fails, STOP and report; don't skip.

> The **promote** comment format is a contract: `/plan` parses `Promoted → objective: <name>. <rationale>. Next: /plan …` to resolve the objective, and `<name>` must be an exact `~/.claude/pipeline/objectives.md` registry name. Keep the format and use a verbatim registry name.

## 6. Report + next step (convention 4)
- Counts: promoted / parked / killed (with IDs).
- For each **promoted** idea, print: `/plan "<title>"` — *turn it into a project under its objective (the M3 rung)*.
- Note any Inbox idea left undecided, and any landscape staleness flagged in §2.

## Hard rules
- **Never auto-decide** — the human confirms every idea at §4; the one-word lean is soft and overridable.
- **Reason, don't rule** — the output is a briefing situating each idea in the live landscape, not an isolated verdict.
- **One inline pass, no per-idea subagent** — hold the whole Inbox at once.
- **The KB is the read surface for the landscape** — never live-reconstruct the portfolio from Linear at judgement time (§2).
- **Every** promote/park/kill leaves a trace comment — the funnel keeps a record of what died and why.
- Touches only the configured Intake project. Promotion here graduates an idea *from the funnel*; it does not create the real project — that's `/plan`'s job.
