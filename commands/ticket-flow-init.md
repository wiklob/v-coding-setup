---
description: One-time per-repo setup for the next-ticket / land-ticket flow — detects repo settings, creates the Linear scope label, writes .claude/ticket-flow.json, prints the manual checklist.
argument-hint: "(no args — run once inside a new repo)"
allowed-tools: Bash, Read, Write, mcp__linear
---

# /ticket-flow-init — set up the ticket flow in this repo

Make `/next-ticket` and `/land-ticket` work in the current repo. Idempotent — safe to re-run to update config.

## 1. Detect what we can
- Repo slug: `git remote get-url origin` → parse `owner/repo` (strip `.git`, handle SSH + HTTPS). If no remote, ask the user for the GitHub slug.
- Base branch: `git symbolic-ref --quiet refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`, fallback `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, fallback `main`.
- Existing config: if `.claude/ticket-flow.json` exists, read it and show current values as defaults.

## 1b. Parent folder for FleetView grouping
Convention 5 spawns ticket worktrees as `../<repo-basename-sanitized>-wt-<slug>` — siblings of the main repo. For `claude agents --cwd <path>` to scope a FleetView pane to *this* repo + all its present and future worktrees only, the main repo must live inside a dedicated wrapper folder so the parent dir isn't shared with unrelated projects.

- Compute `repo_basename="$(basename "$root")"`, `parent_dir="$(dirname "$root")"`, `parent_name="$(basename "$parent_dir")"`. The expected wrapper name is `<repo_basename>-parent`.
- **If `parent_name` == `${repo_basename}-parent`**: log "✓ already parented" and skip the rest of this section.
- **Else, offer to wrap.** Action is gated (confirm first — it moves the cwd and any session inside the moved tree gets a stale shell):
  - **Pre-flight cleanliness:** for every worktree in `git -C "$root" worktree list`, run `git status --short`. If any tree has staged, unstaged, or untracked changes, surface the list and ask the user to confirm proceed (mv carries dirty state intact, but flag the risk of an active session writing during the move).
  - **Pick a wrapper name** that isn't already a sibling: default `<repo_basename>-parent`, escalate to `<repo_basename>-parent-2` etc. if taken.
  - **Sanitize the main-repo folder name** if it contains characters the sanitizer in `/next-ticket` would mangle (spaces, etc.) — propose the sanitized name before renaming. Match the rule: `tr -cs '[:alnum:]' '-' | sed 's/-*$//'`. Confirm.
  - **Move from `$parent_dir`** (use a single shell, `cd` first to avoid orphaning the script's own cwd): `mkdir <wrapper>`; `mv <main-repo> <wrapper>/<sanitized-name>`; for each worktree in the original `git worktree list` (other than the main), `mv <old-worktree-path> <wrapper>/`.
  - **Repair worktree pointers** — bare `git worktree repair` from the moved main repo only fixes its outbound `gitdir` files, **not** the worktrees' own `.git` files. Pass every moved worktree path explicitly in one call: `git -C <wrapper>/<sanitized-name> worktree repair <wrapper>/<wt1> <wrapper>/<wt2> …`. Then `git worktree list` and grep for `prunable` — any hit means a path wasn't passed.
  - **Migrate Claude auto-memory dirs.** Each moved tree has a session/memory dir at `~/.claude/projects/<encoded-old-path>` where the encoding prepends `-` and replaces `/` with `-` (e.g. `/Users/me/projects/foo` → `-Users-me-projects-foo`). For each (main repo + each worktree), `mv -- <old-encoded> <new-encoded>` from inside `~/.claude/projects/` (the `--` is required because leading-dash filenames otherwise read as flags on BSD `mv`).
  - **Verify:** worktree list shows new paths, no `prunable`; one or two worktree `git status` calls succeed; the encoded memory dirs exist at the new names.
  - **Ghost cleanup (CRITICAL).** The session running `/ticket-flow-init` has its launch cwd inside the moving tree. After the move, the harness's cached cwd is dangling; the next project-local write (e.g. a new permission landing in `.claude/settings.local.json`) will silently `mkdir -p` the old path back into existence and drop a settings file there. Surface this to the user, ask them to **exit this Claude session before granting any further permissions or running further commands here**, and instruct them to `rm -rf <old-main-repo-path>` once empty. Alternatively, defer the parenting and tell them to re-run `/ticket-flow-init` from a session started outside the moving tree (e.g. `cd ~ && claude`) — that's the only way to avoid the ghost cleanly.
  - **Tell the user** to also (a) restart any *other* Claude session whose cwd was inside the moved tree (FleetView jobs keep running but their shell cwd is now stale), (b) update IDE workspaces / terminal tabs pointing at the old path, (c) `claude agents --cwd <wrapper>` is now the project-scoped FleetView filter.
  - **Re-anchor** the rest of `/ticket-flow-init` against the *new* `$root = <wrapper>/<sanitized-name>`.

## 2. Confirm Linear access + team
- Ensure the Linear MCP is connected (`mcp__linear list_teams`). If not, tell the user to run `/mcp` → authenticate `linear` (it's user-scoped, so this is once per device, not per repo). STOP until connected.
- Ask the user which Linear **team** owns this repo's work; validate it via `list_teams` / `get_team`.

## 3. Decide the scope label
- Ask for the **scope label** that marks issues belonging to THIS repo (e.g. `engine`, `webapp`). One Linear team can serve several repos; the label is what disambiguates.
- `mcp__linear list_issue_labels` for the team. If the label is missing, `mcp__linear create_issue_label` (team-scoped, with a description explaining it scopes issues to `<repo>`). Confirm before creating.

## 4. Determine the required CI check
- Ask for the **required CI check name** the merge gate waits on. Default `type-check` if this repo uses the standard CI template.
- If `.github/workflows/` has no CI: offer to scaffold a minimal workflow whose required job runs the repo's type-check/build, plus a PR template — but only with the user's go-ahead (project-specific; don't assume the toolchain).

## 5. Designate a standalone-ticket bucket project (optional)
For miscellaneous one-shot tickets (bug fixes, tweaks) that don't belong to a multi-slice feature, you can designate one Linear project as the **bucket** — `/next-ticket` will switch to ticket-per-worktree, parallel-friendly mode for any ticket inside it (convention 5's standalone mode).
- Ask: "Designate a Linear project as the standalone-ticket bucket? (parallel-friendly, per-ticket worktrees) — project name, or `none`."
- If a name: validate via `mcp__linear list_projects` (team-scoped). If missing, offer to create it (`mcp__linear save_project` with `addTeams: ["<linearTeam>"]`; suggest a name like "Standalone (<repo>)" or "Misc (<repo>)"); confirm before creating. Recommend that issues placed in this bucket also carry `<scopeLabel>` (the user manages assignment in Linear — optionally via a Linear automation).
- If `none` (default): skip — the repo runs feature-only.

### Per-project opt-in: the `parallel` project label
The bucket isn't the only route into standalone mode. A **feature project** that holds a group of related, non-stage-dependent tickets can opt in by carrying the Linear **project label `parallel`** (workspace-level, distinct from issue labels). `/next-ticket` and `/resume-ticket` detect it via one `get_project` call and route through standalone mode (per-ticket worktrees, no In Progress guard).

Tell the user:
- **Create the label once**, in Linear's UI: Settings → Labels → "Project labels" tab → New label → name it `parallel`. (Linear's MCP doesn't expose project-label creation; this is UI-only.)
- **Apply it per-project** by opening the project and adding `parallel` in the labels field.
- The label name `parallel` is a hardcoded convention — no JSON config needed.
- Caveat: parallel-labeled projects are NOT auto-completed when the last ticket lands (same as the bucket); close them manually in Linear when the matter is done.

No action required here unless the user wants to create the label now — surface the instructions and move on.

### Apply `parallel` to the bucket too (optional, visual consistency)
If a bucket was designated in this section AND the `parallel` project label already exists in Linear, offer to apply it to the bucket so every standalone-mode project looks the same in Linear's UI. **Functionally a no-op** — the bucket already routes to standalone mode via config; the label is purely cosmetic for it.

- `mcp__linear list_project_labels` (team-scoped). If `parallel` is absent → skip silently (the user can apply it by hand later once they create the label).
- If `parallel` is present AND a bucket was designated: ask "Apply the `parallel` project label to the bucket too? Functionally a no-op (the bucket already runs in standalone mode via config) — purely visual consistency in Linear. (y/N)". On `n` or skip → move on.
- On `y`: `mcp__linear save_project` with the bucket's existing labels **plus** `parallel`. Pull current labels via `get_project` first, then send the union — `save_project`'s labels field replaces, not appends, so omitting the existing ones strips them.

## 6. Write the config
- Ensure `.claude/active-project.json` is gitignored (the per-worktree binding, convention 5 — local, never shared). Add it to `.gitignore` if absent.
- Ensure `.claude/usage-stats/` is gitignored (per-ticket session stats written by `/land-ticket` §8.5 — local-only observability, never committed). Add it to `.gitignore` if absent. (Recommend committing the `.gitignore` update with everything else in this setup as one initial-config commit.)
- Write `.claude/ticket-flow.json` at the repo root:
```json
{
  "linearTeam": "<team>",
  "scopeLabel": "<label>",
  "repo": "<owner/repo>",
  "baseBranch": "<base>",
  "requiredCheck": "<check>",
  "standaloneProject": "<primary bucket project name>",
  "standaloneProjects": ["<primary bucket>", "<additional buckets…>"]
}
```
Omit `standaloneProject` (and `standaloneProjects`) entirely if the user picked `none`. Recommend committing this file (non-secret; teammates inherit the flow).
- **`standaloneProject` vs `standaloneProjects` (multi-bucket).** `standaloneProject` is the **primary** bucket — the default target for `/bulk-fix`/`/triage-findings` and the one every scalar-reading consumer uses. `standaloneProjects` is the **full registry** of standalone buckets (include the primary as its first element). A repo with one bucket needs only `standaloneProject`; add `standaloneProjects` only when ≥2 buckets exist (e.g. a perpetual `bugs` harvest bucket alongside the general one). `/bulk-fix --project <name>` validates `<name>` against this list. Buckets in the list still need the `parallel` project label for `/next-ticket`/`/resume-ticket` standalone detection — the config registers them for `/bulk-fix`, the label opts them into standalone-mode worktrees.
- **`bugBucket` — the shared pipeline-bug bucket.** `"bugBucket": { "name": "bugs", "team": "<owning team>" }` tells `/harvest-pipeline-bugs` where to file. The whole `errors.jsonl` sink is pipeline-subject, so **every** repo on the machine harvests into this **one shared** bucket — set `team` to the bucket's *owning* team (the pipeline's), **not** the repo's own `linearTeam`, so a non-owning repo (a product repo on its own team) files cross-team into the right place. The bucket must exist in Linear under that team with the `parallel` label. The owning repo also lists the name in `standaloneProjects` so `/bulk-fix --project "<name>"` resolves it; a non-owning repo needs only `bugBucket` (it doesn't bulk-fix pipeline bugs).
- **`designDoctrine` — the product/UX-judgment gate's doctrine pointer (optional; V-281).** `"designDoctrine": ["PRODUCT.md", "DESIGN.md"]` is a **standalone optional** array of paths to the repo's product/design doctrine docs (the "how this product should look and behave" sources). When set, a **design-touching** ticket (carrying the `design` issue label, or one the design step detects as touching a user-facing surface) pulls these docs into the design step (`/scope`, or `/build`'s inline design), stamps a `Design-touching: yes — doctrine: <paths>` carrier line into its `## Implementation design`, and `/thesis-check` applies a conditional **product sub-bar (P1–P3)** — doctrine honored · existing shells/zones integrated · full surface (not a reskin / backend-verification harness) — that can return `wrong-approach` / `missing-seam` on **product** grounds, not only engineering (the CB-335 class: engineering-correct but product-0/10). **Omit it (or set `[]`) for a repo with no user-facing product surface** — the whole gate is then a graceful no-op (the `~/.claude` pipeline repo itself sets `[]`). No project-label setup is needed; the `design` issue label is optional (the design step also detects user-facing-surface tickets heuristically).
- **Changelog fragment convention + union attribute (only if a `docs.changelog` is configured).** If the repo's `ticket-flow.json` carries a `docs.changelog` path (convention 6 — present once the docs lifecycle is opted into; absent on a fresh flow-only init, so this step skips cleanly):
  - **The concurrency fix is the fragment-file convention, not the merge driver (V-194).** `/land-ticket` §6.5 records each merged PR as a uniquely-named fragment `<dir of docs.changelog>/changelog.d/<PR>.md`, never a direct append to the shared `## Recent`. Concurrent lands therefore touch disjoint files and never conflict — **including on GitHub's server-side PR mergeability**. No `.gitattributes` setup is required for this; `changelog.d/` is created on the first land, and the curation pass folds fragments into the changelog later.
  - **The `merge=union` attribute is retained only for the single-threaded curation merge.** Ensure `.gitattributes` at the repo root contains `<changelog-path> merge=union` (append if absent; idempotent — never duplicate). The built-in `union` driver auto-keeps both sides' appends in a **local** merge/rebase, but it does **not** cover GitHub-side mergeability (GitHub's 3-way merge ignores `.gitattributes` merge drivers) — which is exactly why V-9's shared-`## Recent`-append + union left concurrent lands hitting `CONFLICTING`, and why the fragment convention above replaced it as the concurrency mechanism. It's a *built-in* driver, so it needs no per-clone git config and works in fresh worktrees. Commit it with the init config. (When a repo opts into the docs block *after* init, re-run this skill — or add the one `.gitattributes` line by hand — to pick the attribute up.)

## 7. Project-specific tweaks
Surface anything non-standard and record it (in the config or a note) if it affects the flow: non-`main` base branch, a monorepo (worktree path / sparse-checkout implications), no Linear `gitBranchName` convention, branch-name prefix differences, or a non-`npm` toolchain (the skills assume `npx tsc --noEmit`; flag if this repo differs so we adjust the skills' verify step).

## 8. Print the manual one-time checklist
These can't be automated from here — list them for the user:
- **Linear → GitHub integration**: connect THIS repo in Linear (Settings → Integrations → GitHub) so PRs auto-link and transition issues.
- **Branch protection** on `<baseBranch>` (GitHub settings): require a PR and the `<requiredCheck>` status check.
- Confirm `gh` is installed + authed (`gh auth status`).
- (If you want auto-labelling) a Linear automation: issues in this repo's project(s) auto-get `<scopeLabel>`. (If a bucket was designated, optionally also auto-assign standalone issues to it.)

## 9. Report
Echo the written config and the checklist. The repo is ready: `/next-ticket` to ingest, build interactively, `/land-ticket` to close. If a bucket was designated, mention `/next-ticket <ISSUE-ID>` for standalone parallel work. Mention the `parallel` project-label convention (§5) so future feature projects can opt in without re-running this skill.
