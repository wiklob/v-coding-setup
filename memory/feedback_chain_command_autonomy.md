---
name: feedback_chain_command_autonomy
description: Chain commands (next-ticket → scope → build → land, and /go) run to completion autonomously unless a flag or a real gate stops them — don't insert discretionary mid-flow check-ins.
metadata:
  type: feedback
---

The build chain is designed to **run to completion unless explicitly flagged.** `/scope`, `/build`, and `/go` default to full autonomy: they execute every phase straight through, and they stop only at (a) a flag the user passed (`--stop-after-*`, `--no-push`, …), (b) a documented hard gate (a preflight failure, a `needs-eyes` / non-`sound` verdict, a push rejection, an irreversible-action confirm gate), or (c) genuine structural impossibility. They do **not** insert discretionary "are you sure?" check-ins between phases.

**Why:** the value of the chain is flowing straight through without the user re-typing or re-approving at every seam — a command that pauses on its own discretion mid-flow re-introduces exactly the friction the chain removed. The gates that *do* exist are deliberate and load-bearing (irreversible or outward-facing actions; validation that found a real problem). The autonomy default is what makes those gates legible as signal rather than noise.

**How to apply:** when building or editing a chain command, make the default path run to completion; add a stop only when it is a real gate (irreversible action, failed validation, exhausted retry budget) or a flag the user opted into. A discretionary mid-flow pause is a smell — either it guards something real (make it a documented gate) or it is ceremony (drop it). `/go` instruments every gate it drives (`p'd` / `intervened` / `forced`) precisely so a perennially-rubber-stamped pause can be found and pruned.
