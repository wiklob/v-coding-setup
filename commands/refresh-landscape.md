---
description: Regenerate the Linear-derived project block in pipeline/landscape.md in-session — re-pull non-Completed/Canceled projects for the in-scope teams from Linear MCP, replace the block between the markers wholesale, bump the generation date + freshness header. The "derive what the tracker knows" half of the KB freshness model.
argument-hint: "(no args)"
allowed-tools: Bash, Read, Edit, mcp__linear
---

# /refresh-landscape — re-derive landscape.md's project block from Linear

The KB's one rule (`pipeline/README.md` → Update story): **if Linear knows it, derive it; if only a human knows it, author it and date it.** The active/admitted-project list is the only genuinely volatile, mechanically-knowable part of `pipeline/landscape.md` — it rots within a sprint if hand-kept. This command is the derive step: it re-pulls the live portfolio from Linear MCP and rewrites the machine-owned block, leaving every authored word outside the markers untouched.

This repo has **no CI and no out-of-session Linear access** — every Linear call here is an in-session MCP call. So this is a **command the agent runs**, not a cron. The agent itself is the runner; there is no `bin/*` helper, because the block content can only be produced by an in-session MCP call.

## Config
- **Target file:** `pipeline/landscape.md`.
- **In-scope teams** (the KB's domains): from `.claude/ticket-flow.json` — `cfg.landscapeTeams` (array of `{ "name", "key" }`), falling back to the single `cfg.linearTeam` when unset.
- **Markers** (the machine-owned region — everything between them is replaced wholesale): `<!-- linear:begin … -->` … `<!-- linear:end -->`.
- **Freshness header** (line 1, manual-section convention-6 header reused for the whole file): `> Last verified against Linear: <date>`.
- **Dropped statuses:** `status.type ∈ {completed, canceled}` — excluded **server-side** via `list_projects includeCompleted: false` (V-246; it drops exactly the project `status.type ∈ {completed, canceled}` set — project statuses have no `duplicate`, so this is an exact match for the live set). Cuts the rows before they reach context rather than fetching all and dropping client-side.

## Steps

1. **Run date** — `date +%F` (one Bash call). Used for both the in-marker `generated <date>` comment and the line-1 freshness header.

2. **Pull projects, per in-scope team** — `mcp__linear list_projects team: "<team name>" includeCompleted: false limit: 50`, once per in-scope team. `includeCompleted: false` drops completed/canceled projects **server-side** (per Config), so the rows arrive already filtered. **Paginate** while `hasNextPage` is true (pass `cursor`) — defensive even though current volume fits one page. Keep each project's `name`, `status.name`, `status.type`, and `initiatives[]` (id + name).

3. **Pull initiatives** — `mcp__linear list_initiatives includeProjects: true`. Use it to (a) name each project's owning initiative canonically and (b) surface any **in-scope initiative that owns no non-terminal project** (an Initiative admitted but not yet broken into in-flight projects), which the project list alone can't show.

4. **Filter** — already done server-side by step 2's `includeCompleted: false`; the rows are the active/admitted set as fetched. Keep a defensive client-side check (drop any `status.type ∈ {completed, canceled}` that slips through — compare on `status.type`, the stable enum, **never** `status.name`, which is localizable/renamable), but it should be a no-op now.

5. **Render the block** — keep the existing authored shape: one `**<team>** (team \`<KEY>\`)` header per in-scope team, then a row per surviving project:
   ```
   - **<project name>** — `<status.name>` — Initiative: *<initiative name>*
   ```
   **Attribute the initiative per project row, not once per team** — a single team can span more than one Initiative, so a single team-header initiative line would mis-attribute. A project with no initiative → `— Initiative: *none*`. After the team's rows, if any in-scope initiative from step 3 owns no surviving project in that team, add one line noting it as admitted-without-active-project. Order rows by status (`started` first, then `backlog`/`planned`/`paused`), then by name — stable so a re-run diffs cleanly.

6. **Replace wholesale between the markers** — `Edit` `pipeline/landscape.md`, matching the exact text from `<!-- linear:begin … -->` through `<!-- linear:end -->` and replacing it with the regenerated block, **begin/end markers included**. The begin marker is rewritten as:
   `<!-- linear:begin · generated <date> from Linear · regenerate in-session via /refresh-landscape (list_projects + list_initiatives); replace this whole block -->`
   so the generation date is bumped in the same edit. Nothing outside the marker pair is in the `Edit` — the `## Direction right now` narrative and all surrounding prose stay byte-identical.

7. **Bump the freshness header** — `Edit` line 1 `> Last verified against Linear: <old date>` → `> Last verified against Linear: <date>`. Separate edit from step 6 so each is an exact, auditable single-region replacement.

8. **Report** — print the run date and the count of projects listed per team, and emit the `result:` line. Do **not** commit or push — the caller owns that (this command only regenerates the file).

`result: /refresh-landscape — landscape.md block re-derived from Linear (<N> active/admitted projects per in-scope team); generation date + freshness header bumped to <date>.`

## Hard rules
- **Only the marker-bounded block + the line-1 freshness header are ever edited.** Every authored word outside the markers is preserved — the markers are the machine/human boundary (`pipeline/README.md` design rationale: "generated skeleton with authored islands").
- **Filter on `status.type`, never `status.name`** — type is the stable enum (`backlog|planned|started|paused|completed|canceled`); the name is localizable.
- **No server-side negative-state filter** — fetch per team and drop `completed`/`canceled` in-session; never rely on a single `state:` arg to express "everything except two".
- **In-session only** — every Linear read is an MCP call from this command; there is no `bin/*` helper and no out-of-session/cron path (this repo has neither CI nor out-of-session Linear access).
- **Never commit or push** — regenerate the file and stop; committing the refresh is the caller's decision.
