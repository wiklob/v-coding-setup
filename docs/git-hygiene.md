> Last verified against code: 2026-07-02 (V-282)

# Git hygiene — keeping local main current and dead refs pruned

The pipeline accretes git cruft: local `main` drifts behind origin between lands, and landed branches/worktrees pile up (V-282 was filed after a hand-fast-forward of a 3-behind `main`, with ~24 worktrees and ~11 stranded at main's tip). This is the standing automation that keeps a checkout tidy.

## The helper — `bin/git-hygiene.mjs`

Repo-agnostic, invoked as `node ~/.claude/bin/git-hygiene.mjs <repo-path> [--apply] [--remote] [--base <branch>]`. **Dry-run by default** — it prints every `WOULD …` action and mutates nothing until `--apply` is passed (the `sb-push --apply` gate, applied to git). Ordered, independently-guarded steps (a failing step is surfaced and skipped, never aborting the sweep):

1. **Fast-forward local `main`** — `fetch origin <base>` then `merge --ff-only origin/<base>` against the repo's main worktree. `--ff-only` sails through non-colliding drift and aborts non-destructively on a real divergence (surfaced, never forced). Skipped if the main worktree is dirty or not on `<base>`.
2. **Prune stale remote-tracking refs** — `remote prune origin` (refs whose remote branch is gone).
3. **Prune landed local branches** — a branch is landed when it is **merged into `<base>`** (deleted with `branch -d`, which git refuses on an unmerged branch) **or its upstream is `[gone]` and it is in the pipeline's `flingelms30/*` namespace** (its remote ref was deleted by a successful land — provably squash-landed, deleted with `branch -D`). A gone-upstream branch *outside* that namespace is **not** force-deleted (`[gone]` alone proves only that the remote ref was deleted, not that the commits reached `<base>`), so its commits are never orphaned. Branches checked out in a worktree, and `<base>` itself, are always skipped.
4. **Prune merged remote branches** (`--remote` only) — `origin/flingelms30/*` refs merged into `origin/<base>`, via `push origin --delete`. Namespace-scoped and merged-only; off by default.
5. **Prune landed worktrees** — a worktree is auto-removed only when it is **clean AND its branch's upstream is `[gone]`** (a landed ticket whose worktree escaped `/land-ticket §7` teardown), via `bin/worktree-remove.sh` (which refuses on uncommitted changes). Everything else — dirty, detached-HEAD, binding-less, or clean-but-active — is **reported, never deleted**.

### The safety invariant (why you can run it daily with `--apply`)

The helper **never deletes an unmerged branch that isn't provably-landed, never removes a dirty or active worktree, and never touches the main worktree** — and does nothing destructive without `--apply`. Because this repo has no test harness, that negative is proven by a committed probe, `bin/git-hygiene.test.sh` (the encoded-proof analog per `commands/scope.md §3`): it builds an isolated scratch repo and asserts, against a real git graph, that

- an unmerged branch (with no upstream, or with a live upstream), a dirty worktree, an active worktree, and the main worktree all **survive `--apply`**; and
- a truly-merged branch, an upstream-gone branch, and an upstream-gone clean worktree **are** pruned under `--apply`.

Run it with `bash ~/.claude/bin/git-hygiene.test.sh` (exit 0 = all pass). It is the sole executable coverage `/verify-tests` runs for this area.

### Design decisions

- **Why `[gone]` upstream, not `branch --merged`, carries the load.** The pipeline squash-merges (`/land-ticket §6.7`), so a landed branch is a *non-ancestor* of `main` — `git branch --merged` never recognizes it. The robust "this landed" signal is the remote ref's deletion (`§7` does `push origin --delete`), which shows as `[gone]`. `--merged` still catches genuinely fast-forward/no-ff-merged branches; the two together cover both.
- **Why worktrees are report-not-delete unless upstream-gone.** A fresh/active ticket worktree also sits at `main`'s tip with 0 commits ahead — indistinguishable from a landed one by tip alone. And detached / ad-hoc-branch worktrees may hold live work. Only `clean + [gone] upstream` is an unambiguous "landed and safe to remove" signal; the rest is surfaced for a human.
- **Why a standalone helper, not a `/land-ticket §7` refactor.** `§7` already fast-forwards `main` and tears down the landing ticket's own worktree at land time — that works and is a load-bearing merge path. This helper is the **daily backstop** for the drift and sprawl that accumulate *between* lands (and for worktrees that escaped `§7`). The two are complementary; `§7` was left untouched.

## The daily loop

Registered as a macOS launchd LaunchAgent, mirroring the harvester jobs (`install-*-launchd.sh` + `*-runner.sh` + generated `com.v-coding-setup.<job>.plist`):

- `bin/install-git-hygiene-launchd.sh` — installs `com.v-coding-setup.git-hygiene`, daily **09:27** local (offset after the 09:07 bug harvester and 09:17 feedback harvester). `--print` emits the plist for `plutil -lint` without registering. Idempotent (`bootout` → `bootstrap`).
- `bin/git-hygiene-runner.sh` — emits a dated HEARTBEAT (so a silent non-fire is distinguishable from an empty log), sources `.envrc` for any git credential the `--remote` step needs, then runs the helper `--apply --remote` against each checkout in its `REPOS` list. Each repo is `[ -d "$r/.git" ]`-guarded, so an absent one is skipped, not failed.
- Log → `~/.claude/pipeline/audit/git-hygiene.log` (per-machine, gitignored).

**Install:** `bash ~/.claude/bin/install-git-hygiene-launchd.sh`. **Multiple repos:** the helper is repo-agnostic; the runner always sweeps `~/.claude` and additionally any checkout listed in `~/.claude/git-hygiene-repos.txt` (one absolute path per line, `#` comments allowed; a wrong/absent path is a silent skip, so "works for repo X" is verified live on that machine, not asserted here).

## "Don't merge everything" — the structured-merge posture

This posture already lives in `/land-ticket`, and this doc records rather than re-implements it:

- **Squash-merge is the default** (`§6.7`: `gh pr merge --squash`) — one commit per landed ticket on `main`, not the branch's full history.
- **No `--delete-branch` on the merge** — it makes `gh` try to switch the local checkout toward `main`, which aborts local cleanup mid-land; branch teardown (local `-D` + `push origin --delete`) is done explicitly in `§7` instead. This helper's `[gone]`-upstream signal depends on that explicit remote deletion.
- Merge deliberately, per ticket, through the gated `/land-ticket` flow — not a blanket auto-merge of everything green.
