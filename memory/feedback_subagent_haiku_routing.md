---
name: feedback_subagent_haiku_routing
description: How to route a subagent dispatch — read-only→Haiku, sensitive/quality-critical→Opus, objective judgment→a separate context, and return short excerpts to keep the parent context clean.
metadata:
  type: feedback
---

When a command dispatches a subagent, the same few choices recur — model tier, context isolation, what comes back. Route them deliberately rather than defaulting every dispatch to a full-power, same-context agent.

**Read-only inspection → Haiku.** Codebase search, subsystem reads, read-and-summarize recon carry no quality risk a larger model would catch — the work is "find and report," not "judge." Route it to `model: "haiku"` (e.g. an `Explore` or `general-purpose` subagent). It's materially cheaper and fast enough.
**Why:** paying Opus rates to grep is waste; the failure mode of a too-small model here is "missed a file," which the dispatching command's own framing usually catches anyway.

**Sensitive or quality-critical reasoning → Opus.** A security review, an adversarial design check, a correctness judgment — anything where being *wrong* is expensive and subtle — gets the most capable model. Don't route quality-critical reasoning to Haiku to save tokens.
**Why:** the cost of a missed security or correctness defect dwarfs the token delta; the saving is illusory if the dispatch misses the bug it existed to find.

**Objective judgment → a separate context, not the one that produced the work.** When the task is to *judge* something — does this design hold, is this code correct, is this secure — spawn a fresh subagent rather than reasoning in the same context that built it. A reviewer anchored on the work's own framing inherits its blind spots and rationalizations; a separate context re-derives from the artifact and catches what the author's context cannot see. This is a *craft* principle, not only a cost lever — see `craft/judgment.md`.
**Why:** "review in the same context that wrote it misses security bugs" — the same-context reviewer is primed to confirm, not to refute.

**Return short excerpts, not transcripts.** A subagent's value to the parent is its *conclusion* — the finding, the verdict, the located `file:line` — not its full search trail. Have it return a tight summary so the parent context stays clean and its reasoning room isn't consumed by a dispatched agent's scratch work.
**Why:** the parent's context window is the scarce resource; a dispatch that dumps its whole trail back defeats the point of isolating it.

**How to apply:** at each `Agent` / subagent dispatch, ask — read-only? → Haiku. Quality-critical or sensitive? → Opus. A judgment of work just produced? → a separate context. Then prompt the subagent to return a short excerpt, not its working.
