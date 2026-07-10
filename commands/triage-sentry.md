---
description: Turn a Sentry issue (URL, short-ID, or query) into a deduped bugs-bucket ticket by routing it through the existing errors.jsonl → /harvest-pipeline-bugs path — never minting a Linear ticket directly. User-gated: it reads Sentry freely but mutates (archive) only on explicit confirm, and never blocks a land gate on post-deploy state. Reach for it when a Sentry issue looks like a real pipeline bug worth tracking, or when triaging archive-noise from a Sentry project.
argument-hint: "<sentry issue URL | short-ID | query>  [--archive-noise]  — omit to use the default unresolved queue"
allowed-tools: Bash, Read, Grep, mcp__plugin_sentry-mcp_sentry__find_organizations, mcp__plugin_sentry-mcp_sentry__find_projects, mcp__plugin_sentry-mcp_sentry__search_issues, mcp__plugin_sentry-mcp_sentry__search_events, mcp__plugin_sentry-mcp_sentry__get_sentry_resource, mcp__plugin_sentry-mcp_sentry__analyze_issue_with_seer, mcp__plugin_sentry-mcp_sentry__update_issue, mcp__linear
---

# /triage-sentry — route a Sentry issue into the pipeline's bug path, don't mint a ticket beside it

A Sentry issue is *production error evidence*; this pipeline already has one home for error evidence — `pipeline/audit/errors.jsonl`, read by `/harvest-pipeline-bugs` and clustered/deduped into the `bugs` bucket. The instinct on seeing a triage skill is to have it call Linear and create an issue per Sentry issue; resist it. That instinct re-implements ticketing beside the harvest path, splits the dedupe surface, and means two writers can file the same root cause as two tickets. The whole value here is the opposite: a Sentry issue becomes **one more line in the single sink**, and the existing harvest discipline (root-cause clustering, stable `harvest-key`, dedupe against open bucket tickets) does the rest. This command writes Sentry evidence *into* the path — it does not file tickets, the same way `/report-bug` and `/review-session` write the sink and stop.

Read `~/.claude/workflow-conventions.md` first (esp. conventions 4 + 8 — name the next step; never claim a mutation landed without reading the response back), then `~/.claude/craft/judgment.md` (this command makes two judgment calls — "is this a real pipeline bug or environment noise" and "should we archive" — both fit its anti-patterns: accepted-premise, intended-state success, scope creep). `~/.claude/pipeline/review-standard.md` §6 is the path this plugs into; don't re-implement its clustering here.

## Why this shape, and why it is not the upstream skill

The upstream `getsentry/skills/triage-frontend-issues` does two things fused together: it classifies Sentry issues as archive-noise vs actionable, and it archives the noise in Sentry. We keep the classification rail (it is good, evidence-sourced craft) but split the two outcomes onto the paths this pipeline already owns:

- **Actionable in our code** → not "archive", but **track it**: write the issue as a `manual` entry into `errors.jsonl`, then let `/harvest-pipeline-bugs` cluster + dedupe + file it into the `bugs` bucket. We never call `mcp__linear` to create an issue from here — that would duplicate the harvest dedupe and let the same root cause file twice.
- **Non-actionable noise** (third-party frame, browser API, synthetic, wrong-project) → optionally archive in Sentry, but **only with `--archive-noise` and only after explicit per-batch confirmation** (the upstream Hard Rules, kept). Default run does not mutate Sentry at all.

## Load config
- `root="$(git rev-parse --show-toplevel)"`; read `$root/.claude/ticket-flow.json`. Missing → `/ticket-flow-init`, STOP.
- The sink is **not** a Linear handle here — we do not resolve `bugBucket` or call Linear at all in the default path. The bucket is resolved later, by `/harvest-pipeline-bugs`, when it reads the line we wrote. This command's only persistent write is to the sink (and, with `--archive-noise`, to Sentry).

## 0. Resolve the org + project (don't assume `sentry/javascript`)
The upstream skill hard-coded `organizationSlug=sentry`, project `javascript` — that is their queue, not ours. Resolve against the live Sentry the MCP is authenticated to:
- `mcp__plugin_sentry-mcp_sentry__find_organizations` → pick the org (single org → use it; several → ask the user which).
- `mcp__plugin_sentry-mcp_sentry__find_projects` (org) → the project(s). If `$ARGUMENTS` names a project or carries a project-scoped URL, use that; else ask rather than guess. A wrong project silently triages the wrong queue (convention 8 — surface, don't assume).

## 1. Resolve the input
`$ARGUMENTS` is one of:

| Input shape | Meaning |
|-------------|---------|
| Sentry issue URL | The one issue. `get_sentry_resource(url=…)`. |
| Issue short ID (e.g. `JAVASCRIPT-1A2B`) | The one issue. `get_sentry_resource(resourceType='issue', organizationSlug=…, resourceId=…)`. |
| Query (contains a colon, e.g. `is:unresolved firstSeen:-24h`) | `search_issues(org, project, query=…, sort='new', limit=50)`. |
| Empty | Default queue: `is:unresolved is:unassigned firstSeen:-7d`, sort `new`, limit `50`. |

For a queue, fan out `get_sentry_resource` per result to pull culprit, substatus, assignee, and top-frame hints (the search response omits them). Reading is unrestricted — only mutation is gated.

## 2. Classify each issue (the kept craft rail)
Read `references/archive-criteria.md` once we vendor it (or inline the taxonomy in the final skill). Per issue, decide one of:

| Decision | Meaning | Where it routes |
|----------|---------|-----------------|
| `track` | Looks like a real bug in code we own → it belongs in the pipeline bug path. | §3 — write to the sink. |
| `noise` | Matches a documented non-actionable category (third-party frame, browser API, synthetic, wrong-project, transient 5xx, etc.). | §4 — archive *only* with `--archive-noise` + confirm. |
| `needs-human` | Plausibly noise but doesn't cleanly fit a category, or anomalous volume. | Surfaced in the plan, never auto-acted. |

Weight signals in the upstream order: top non-SDK frame (third-party `node_modules/`, `chrome-extension://`, `<unknown>` → strong noise signal); title pattern; volume is not a veto either way; recency; customer-org spread. **When in doubt, `needs-human` — never `track` a false bug into the sink (it would burn a harvest cluster) and never `noise`-archive a real one.** This is the accepted-premise anti-pattern: an issue's "this is third-party" is a *claim from the top frame* — check the frame below it before trusting it (the upstream Caution: a third-party frame reached from our code with our state may be our misuse → `track` or `needs-human`, not `noise`).

For a `track` candidate that's genuinely ambiguous, `analyze_issue_with_seer` can corroborate root-cause before you commit it to the sink — read-only, optional.

## 3. Route `track` issues into the sink (the wiring that replaces "create a Linear ticket")
For each `track` issue, append **one** entry to the single error sink via the sanctioned logger — never a `Write`/`>` to the file, never a direct `mcp__linear save_issue`:

- `node ~/.claude/bin/log-pipeline-error.mjs --command triage-sentry --error "<payload>"` (allow-listed `Bash(node ~/.claude/bin/*.mjs)`; manual mode — no `--tool`, so `tool:"manual"`, no `input`, exactly the `/report-bug` / `/review-session` shape the harvester routes as a human/manual report).
- The `<payload>` is the **stable, dedupe-friendly** description: the Sentry issue's normalized title + culprit + the Sentry permalink, e.g. `[sentry/<project>] TypeError: Cannot read properties of undefined (reading 'id') @ app/views/foo.tsx — https://<org>.sentry.io/issues/JAVASCRIPT-1A2B/`. Put the **permalink and short-ID in the payload** so the harvest ticket's Occurrence/Evidence can link back to Sentry, and so two runs over the same Sentry issue normalize to the same `harvest-key` (§4a strips volatile fragments; a stable title+culprit anchor dedupes correctly). Never fabricate a frame/culprit the resource didn't return (convention 8) — if `get_sentry_resource` didn't surface a frame, say so in the payload and route on title alone.
- One Sentry issue = one sink line. Do **not** pre-cluster here — clustering + dedupe against open `bugs` tickets is `/harvest-pipeline-bugs` §4's job; doing it here would double the logic and drift from it.

This is the key rewire: the upstream "actionable" branch had no destination (it only ever skipped); ours sends it to the sink, and the existing harvest run files it — deduped — into `bugs`.

## 4. Archive noise — gated, optional, never default
Only when `--archive-noise` is passed. Kept verbatim from the upstream Hard Rules because they are the right user-gating:
- **Archive only** — the sole status mutation is `status='ignored'`. Never resolve/assign/delete.
- **Always `ignoreMode='untilEscalating'`** — never `forever`/`forDuration`/count modes (those silently bury a recurrence).
- **Always a `reason`** naming the category (e.g. `Third-party library noise — echarts internals; not actionable in our code`).
- **Never without confirmation.** Build the full plan (table below), show it, wait for explicit `apply` / `apply <subset>` / `cancel`. One approval covers the shown batch only.
- **When in doubt, skip.** A plausibly-real bug is never archived.
- Apply sequentially via `mcp__plugin_sentry-mcp_sentry__update_issue(...)`; on a failure, log it, continue, report failed IDs. **Read each response back and confirm the status actually flipped** (convention 8 — never report "archived N" from intent; a 4xx that left status unchanged is not an archive).

## 5. The plan + report
Print one table before any mutation or sink write:

```
## Triage plan — <org>/<project> (<N> candidates)

| # | Issue | Title | Volume | Decision | Category | Action |
|---|-------|-------|--------|----------|----------|--------|
| 1 | [JAVASCRIPT-XXXX](url) | TypeError: … | 12e/3u | track | — | → errors.jsonl (harvest will file into bugs) |
| 2 | [JAVASCRIPT-YYYY](url) | <unknown> | 4945e/123u | needs-human | — | surfaced only |
| 3 | [JAVASCRIPT-ZZZZ](url) | ReferenceError: DarkReader | 8e/8u | noise | browser-extension | archive (only with --archive-noise + apply) |
```

Then: `N track / M noise / K needs-human`. For the `track` rows, writing the sink is the commitment-free action `/report-bug` makes — but still show the plan first so a human sees what's about to enter the sink. For `noise` rows under `--archive-noise`, end with the upstream confirm line: `Reply 'apply' to archive the M noise issues, 'apply N,M' for a subset, or 'cancel'.`

After acting, report: tracked-to-sink count, archived count (+ failures with IDs), needs-human count.

## 6. Don't gate a land on this
A land gate must not block on Sentry post-deploy state — an issue's recurrence, escalation, or "did the archive stick" is unverifiable at land time and lives on Sentry's clock, not ours. This command surfaces and routes; it never asserts a post-deploy property as a land precondition (the intended-state-success anti-pattern, and the V-26 lesson — don't lean on a claimed external state you can't probe at the moment of the gate).

## Hard rules
- **Never `mcp__linear save_issue` from here.** A `track` issue goes to `errors.jsonl`; `/harvest-pipeline-bugs` owns clustering, dedupe (`harvest-key`), and filing into `bugs`. One sink, one writer of tickets — this command is a *producer into the sink*, like `/report-bug`.
- **Sink writes only via the logger** (`node ~/.claude/bin/log-pipeline-error.mjs`, manual mode), never a raw `Write`/`>` — and the absolute `~/.claude` path is the only sink (a worktree copy is gitignored and harvest-invisible).
- **Reads are free; Sentry mutations are gated.** No `update_issue` without `--archive-noise` **and** explicit per-batch `apply`. Archive-only, `untilEscalating`-only, reason-always. Read each `update_issue` response back before reporting it landed.
- **Resolve org/project live** — never hard-code `sentry/javascript`. A wrong project triages the wrong queue.
- **Never gate a land** on Sentry post-deploy state (§6).
- **Next step (convention 4):** after `track` rows hit the sink, run `/harvest-pipeline-bugs` (or let the daily launchd pass pick them up) to file the deduped tickets into `bugs`; then `/bulk-fix --project "<bugs bucket>"` for the atomic ones.
