> Last verified against code: 2026-07-04 (V-330)

# Migration-collision guard (Block 1 coverage — authoring · land · CI)

How the pipeline prevents Supabase migration **version-prefix collisions** across parallel
worktrees. A migration's `YYYYMMDDHHMMSS` filename prefix is the primary key in
`schema_migrations`; two branches that mint the **same** prefix on **different** filenames
merge cleanly in git and every PR shows `MERGEABLE`, so the clash is invisible until
`supabase db push` / `db reset` (duplicate-version error, or a silently-skipped migration).

## The gap this closes (V-330)

Block 1 (V-29/30/31) hardened the **prod-push boundary** only:
- `bin/sb-push`'s `check_migrations()` compares local prefixes against the *remote applied
  history* — it runs at `sb-push --apply`, i.e. **post-merge, on `main`**, never at authoring,
  PR, or land time, and never against sibling open PRs.
- `bin/sb-new` mints a collision-free monotonic prefix (`max(now_utc, latest_local+1s)`) but is
  **opt-in** — nothing forced its use, so hand-authored round-number `…000000` filenames bypassed
  it and collided.

The capability existed; it just didn't run at the two moments a parallel-worktree collision is
actually catchable (**authoring**, and **PR/land**), nor in **client projects**. V-330 adds three
guard layers, all reusing the same 14-digit-prefix notion (`${basename:0:14}`, a 14-digit glob) so
they agree on what a migration prefix is.

## The three layers

1. **Authoring (prevention) — `bin/guard-migration-authoring.py`.** A PreToolUse hook (registered
   in `settings.json`, matcher `Write|Edit|MultiEdit`) that, **on creation of a not-yet-on-disk**
   `supabase/migrations/*.sql` file, denies a prefix that is round-number `…000000` **or** not
   strictly greater than every other migration on disk (the monotonicity `sb-new` guarantees),
   pointing the author at `sb-new`. It **never** denies an edit of an already-existing migration
   — `sb-new` writes a stub (via Bash `cat >`, which the hook doesn't intercept) that the author
   then edits to add DDL, and that stub is the local max, so blocking edits would break the very
   flow it promotes. Fails open on any ambiguity. Because `settings.json` is the global
   `~/.claude` settings, this hook fires in **client repos** too.

2. **Land (detection) — `commands/land-ticket.md` §4 + `bin/migration-collision-check`.** Before
   the §5 confirm gate, when the PR touches `supabase/migrations/*`, `/land-ticket` runs the
   `migration-collision-check` guard over the **merged set** — this branch + `origin/<baseBranch>`
   + every *other* open PR's head branch (enumerated via `gh pr list`). Any duplicate prefix, or a
   head migration sorting at/before the base's latest, is a **hard STOP** naming the offenders.
   This is diff-driven and route-invariant (like the §4.8 artifact gate). `migration-collision-check`
   is a **sibling** of `sb-push`'s guard, not a refactor: it is keyed on **git refs**, not remote
   history, and is self-contained (no `~/.claude` dependency) so the same file works both from
   `~/.claude/bin` at land time and vendored into a client repo's CI.

3. **CI (server-side backstop) — `templates/ci/migration-collision-check.yml`.** A reusable
   `pull_request` workflow that re-runs the duplicate-prefix check on the **merge result**
   server-side, so a collision blocks the PR check even if a local land guard was bypassed. Runs
   the vendored `bin/migration-collision-check` if present, else the inline minimal core
   (`ls supabase/migrations | cut -c1-14 | sort | uniq -d` must be empty).

`/land-ticket` §3 additionally runs a cross-sibling `git merge-tree` scan (each open PR vs this
branch) — surfaced at §5 as an advisory `sibling-conflict-risk` — to catch **app-code** conflicts
between two open PRs (e.g. both rewriting `usePageEditor.ts`) that per-PR `MERGEABLE` hides. That
is an advisory heads-up, not a hard block (the sibling may land first, or never).

## Adopting in a client project (V is the guard's home; clients inherit most of it for free)

The authoring hook (layer 1) and the land check (layer 2) reach a client repo automatically:
`~/.claude/settings.json` loads globally, `~/.claude/bin` is on `PATH` (via `~/.zprofile`), and
`commands/land-ticket.md` is the one global command driving every repo's land. Only **CI** (layer
3) is per-repo, because it runs on GitHub's servers where `~/.claude` is absent:

1. Copy `templates/ci/migration-collision-check.yml` → the client repo's
   `.github/workflows/migration-collision-check.yml`.
2. (Optional, for the fuller named-offender + ordering output) vendor `bin/migration-collision-check`
   into the client repo and mark it executable — the workflow prefers it when present.
3. Author migrations with `sb-new <name>` — the guidance in `commands/build.md` §4 and
   `commands/scope.md` §3 routes every `migration`-kind item through it.

## Worked examples — the encoded proof (this repo is shell + markdown, no live Supabase)

The `.test.sh` companions of the two `bin/` scripts are the runnable proof; these are the real
V-330 incidents each layer catches, so the doc demonstrates the negative directly (per
`scope.md` §3's test-less-repo rule):

- **Duplicate prefix across two open PRs** — EDIT-1 `20260703000000_add_ydoc_state_to_pages` vs
  EDIT-10 `20260703000000_page_access_tiers`, and EDIT-4 `20260410000000_page_relations` vs EDIT-15
  `20260410000000_notifications`. Distinct filenames, both `MERGEABLE`. **Caught** at authoring
  (the second hand-authored `…000000` write is denied → `sb-new`), at land (`migration-collision-check
  --base origin/main --head <this> --head origin/<sibling>` exits 1 naming both), and in CI (the
  merge-result `uniq -d` is non-empty). `bin/migration-collision-check.test.sh` reproduces both the
  cwd (CI) and git-ref (land) detections.
- **App-code conflict two open PRs hide** — EDIT-1 ↔ EDIT-25 both rewrite
  `src/components/blocks/usePageEditor.ts`; `git merge-tree` across the pair reports the conflict,
  surfaced at `/land-ticket` §5 as `sibling-conflict-risk` before either PR lands.
- **Non-monotonic prefix** — a new migration authored with a prefix ≤ the local max is denied at
  write time (`guard-migration-authoring.test.sh` asserts it), and flagged out-of-order at land.

## Notes / edge cases

- **Midnight false-positive.** The authoring hook denies any new `…000000` file, so a migration
  genuinely authored at exactly `00:00:00 UTC` is a false-positive deny. Astronomically rare and
  self-correcting — the deny points at `sb-new`, which re-mints. `sb-new`'s own writes go through
  Bash `cat >` (not the Write tool), so `sb-new`-minted files never hit this deny.
- **First migration in an empty dir.** No "other" migrations exist, so the non-monotonic branch is
  a no-op (allowed); only the round-number branch can fire.
- **`sb-push` is unchanged.** Its remote-history guard is prod-critical and works at its boundary;
  the V-330 layers are a sibling, not a rewrite of it.
