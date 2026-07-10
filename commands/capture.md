---
description: Capture an idea into the product Intake funnel with near-zero friction — title + raw note + optional source, lands in Todo (Inbox). No other decisions forced.
argument-hint: "<the idea, free text>  (optionally include a source URL)"
allowed-tools: mcp__linear
---

# /capture — file an idea into the funnel

The funnel's front door. **Capture without commitment** (Frictionless principle): get the idea recorded with zero ceremony. No objective, no priority, no triage — that happens later in `/align`.

## Config
- From `.claude/ticket-flow.json` → `cfg.intake`: `{ "project": "Intake — <product>", "team": "<product team>", "inboxState": "Todo" }`. If `cfg.intake` is unset → STOP (`no intake funnel configured in ticket-flow.json — add { "intake": { "project": …, "team": …, "inboxState": "Todo" } }`).
- (One funnel per product; add per-product funnels as separate configs when they exist.)

## Steps
1. `$ARGUMENTS` is the raw idea. If empty → ask for the idea, STOP.
2. Derive a **title** — a tight, ≤80-char distillation of the idea (imperative or noun phrase). Do not editorialize.
3. Keep the **raw note** verbatim — the user's words, unedited.
4. If `$ARGUMENTS` contains a URL, lift it as the **source**; else source is `—`.
5. Create the issue (`mcp__linear save_issue`): `team: <cfg.intake.team>`, `project: <cfg.intake.project>`, `state: <cfg.intake.inboxState>`, `title`, and `description`:
   ```
   ## Idea (verbatim)
   <raw note>

   **Source:** <url or —>
   _Captured via /capture — awaiting /align._
   ```
6. Confirm with the created issue URL. One line.

## End — name the next step
Print: `/align` *(run it to triage the funnel — promote / park / kill against the objectives)*.

## Hard rules
- Writes exactly one issue, only to the configured Intake project.
- **Force zero decisions** beyond the idea itself — never set objective, priority, assignee, or labels at capture.
- Never triage here — capture is commitment-free.
