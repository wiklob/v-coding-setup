#!/usr/bin/env bash
# ~/.claude/bin/git-hygiene.test.sh
# Encoded proof of git-hygiene.mjs's safety invariant (A4) + effectiveness. (V-282)
#
# The repo is shell + markdown with no test harness, so per commands/scope.md §3 the
# proof-of-a-negative is a committed probe script (the analog of a regression test) —
# not the helper's mere presence. This builds an ISOLATED scratch repo (bare "origin"
# + a working clone with worktrees) and asserts, against a real git graph:
#
#   SAFETY (the invariant — must hold or the sweep is dangerous):
#     - dry-run (no --apply) mutates NOTHING (every branch + worktree survives).
#     - an unmerged local branch (no upstream)      is NEVER deleted, even --apply.
#     - an unmerged local branch with a LIVE upstream is NEVER deleted, even --apply.
#     - a DIRTY worktree                             is NEVER removed, even --apply.
#     - an ACTIVE worktree (clean, upstream not gone) is NEVER removed, even --apply.
#     - the MAIN worktree                            is NEVER removed.
#   EFFECTIVENESS (so it actually solves the sprawl):
#     - a truly-merged local branch                  IS pruned under --apply.
#     - an upstream-GONE (squash-landed) local branch IS pruned under --apply.
#     - an upstream-GONE, clean worktree             IS removed under --apply.
#
# Usage:  bash ~/.claude/bin/git-hygiene.test.sh        (exit 0 = all pass)
# Invoked by /verify-tests as the sole executable coverage for this ticket.

set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
HELPER="$BIN/git-hygiene.mjs"
PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/git-hygiene-test.XXXXXX")"
SCRATCH="$(cd "$SCRATCH" && pwd -P)"   # physical path — git worktree list reports the /private-resolved form on macOS
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

q() { "$@" >/dev/null 2>&1; }

# --- build the scratch world ---
ORIGIN="$SCRATCH/origin.git"
MAIN="$SCRATCH/main"
q git init --bare -b main "$ORIGIN"
q git clone "$ORIGIN" "$MAIN"
cd "$MAIN"
echo one > f && q git add f && q git commit -m init && q git push -u origin main

# feature-merged: real-merged into main, pushed → step (c) prunes it (`-d`).
q git switch -c feature-merged && echo m > m && q git add m && q git commit -m m
q git switch main && q git merge --no-ff -m merge feature-merged && q git push origin main

# feature-unmerged: local-only, unmerged, NO upstream → must survive.
q git switch -c feature-unmerged && echo u > u && q git add u && q git commit -m u
q git switch main

# feature-live: unmerged, LIVE upstream → must survive.
q git switch -c feature-live && echo l > l && q git add l && q git commit -m l && q git push -u origin feature-live
q git switch main

# flingelms30/v-gone: unmerged, IN the pipeline namespace, upstream deleted (a squash-land) → step (c) prunes it (`-D`).
q git switch -c flingelms30/v-gone && echo g > g && q git add g && q git commit -m g && q git push -u origin flingelms30/v-gone
q git switch main
q git push origin --delete flingelms30/v-gone   # remote ref gone → upstream tracked as [gone]

# abandoned-gone: unmerged, OUTSIDE the namespace, upstream deleted → must SURVIVE (not force-deleted; [gone] alone
# doesn't prove the commits landed, so `-D` is scoped to the pipeline namespace only — the V-282 review [med] fix).
q git switch -c abandoned-gone && echo a > a && q git add a && q git commit -m a && q git push -u origin abandoned-gone
q git switch main
q git push origin --delete abandoned-gone
q git fetch --prune origin

# wt-dirty: a worktree with uncommitted changes → must survive (worktree-remove refuses).
q git worktree add -b wt-dirty "$SCRATCH/wt-dirty" main
echo dirt > "$SCRATCH/wt-dirty/dirt"

# wt-active: clean, tracks live origin/main (a fresh ticket worktree) → must survive (upstream not gone).
q git worktree add -b wt-active --track "$SCRATCH/wt-active" origin/main

# wt-landed: clean, its branch's upstream is GONE (landed, escaped teardown) → step (e) removes it.
q git worktree add -b wt-landed "$SCRATCH/wt-landed" main
q git -C "$SCRATCH/wt-landed" push -u origin wt-landed
q git push origin --delete wt-landed
q git -C "$SCRATCH/wt-landed" fetch --prune origin

branch_exists() { git -C "$MAIN" show-ref --verify --quiet "refs/heads/$1"; }
wt_exists() { git -C "$MAIN" worktree list --porcelain | grep -qF "worktree $1"; }

echo "== git-hygiene.test =="

# ---------- 1. DRY-RUN mutates nothing ----------
OUT="$(node "$HELPER" "$MAIN" 2>&1)"
echo "$OUT" | grep -q "WOULD" && ok "dry-run emits WOULD actions" || bad "dry-run emitted no WOULD actions"
branch_exists feature-merged && ok "dry-run kept merged branch" || bad "dry-run deleted feature-merged"
branch_exists flingelms30/v-gone && ok "dry-run kept gone branch" || bad "dry-run deleted flingelms30/v-gone"
wt_exists "$SCRATCH/wt-landed" && ok "dry-run kept landed worktree" || bad "dry-run removed wt-landed"

# ---------- 2. APPLY: safety — the invariant ----------
OUT="$(node "$HELPER" "$MAIN" --apply --remote 2>&1)"
branch_exists feature-unmerged && ok "SAFETY: unmerged (no upstream) branch survived --apply" || bad "unmerged branch was deleted!"
branch_exists feature-live     && ok "SAFETY: unmerged (live upstream) branch survived --apply" || bad "live-upstream branch was deleted!"
branch_exists abandoned-gone   && ok "SAFETY: unmerged gone-upstream branch OUTSIDE the namespace survived --apply" || bad "non-namespace gone branch was force-deleted!"
wt_exists "$SCRATCH/wt-dirty"  && ok "SAFETY: dirty worktree survived --apply" || bad "dirty worktree was removed!"
[ -f "$SCRATCH/wt-dirty/dirt" ] && ok "SAFETY: dirty worktree's uncommitted file intact" || bad "dirty worktree work was lost!"
wt_exists "$SCRATCH/wt-active" && ok "SAFETY: active (upstream-not-gone) worktree survived --apply" || bad "active worktree was removed!"
wt_exists "$MAIN"              && ok "SAFETY: main worktree survived --apply" || bad "main worktree was removed!"

# ---------- 3. APPLY: effectiveness ----------
if branch_exists feature-merged; then bad "merged branch not pruned under --apply"; else ok "EFFECT: merged branch pruned under --apply"; fi
if branch_exists flingelms30/v-gone; then bad "namespace gone-upstream branch not pruned under --apply"; else ok "EFFECT: in-namespace upstream-gone (squash-landed) branch pruned under --apply"; fi
if wt_exists "$SCRATCH/wt-landed"; then bad "landed worktree not removed under --apply"; else ok "EFFECT: upstream-gone clean worktree removed under --apply"; fi

# ---------- 4. FF: dirty main reports loudly instead of skipping silently (V-583) ----------
ORIGIN2="$SCRATCH/origin2.git"
MAIN2="$SCRATCH/main2"
OTHER2="$SCRATCH/other2"
q git init --bare -b main "$ORIGIN2"
q git clone "$ORIGIN2" "$MAIN2"
(cd "$MAIN2" && echo one > f && q git add f && q git commit -m init && q git push -u origin main)

# advance origin behind MAIN2's back, from a second clone → MAIN2 is 1 commit behind.
q git clone "$ORIGIN2" "$OTHER2"
(cd "$OTHER2" && echo two >> f && q git add f && q git commit -m advance && q git push origin main)

# dirty MAIN2 with one cruft path + one real content edit.
mkdir -p "$MAIN2/pipeline/audit"
echo log-noise > "$MAIN2/pipeline/audit/x.log"
echo local-edit >> "$MAIN2/f"

BEFORE_HEAD2="$(git -C "$MAIN2" rev-parse HEAD)"
OUT="$(node "$HELPER" "$MAIN2" 2>&1)"
AFTER_HEAD2="$(git -C "$MAIN2" rev-parse HEAD)"

echo "$OUT" | grep -qi "SKIPPED — dirty" && ok "FF: dirty main reported loudly (not silent)" || bad "FF: dirty main skip was silent: $OUT"
echo "$OUT" | grep -q "1 commit(s) behind" && ok "FF: reports correct behind-count" || bad "FF: behind-count missing/wrong: $OUT"
echo "$OUT" | grep -q "2 dirty path(s)" && ok "FF: reports correct dirty-path count" || bad "FF: dirty-path count missing/wrong: $OUT"
echo "$OUT" | grep -q "1 cruft" && ok "FF: distinguishes cruft path" || bad "FF: cruft count missing: $OUT"
echo "$OUT" | grep -q "1 content" && ok "FF: distinguishes content path" || bad "FF: content count missing: $OUT"
[ "$BEFORE_HEAD2" = "$AFTER_HEAD2" ] && ok "FF: dirty main NOT fast-forwarded" || bad "FF: dirty main was advanced despite dirty tree!"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
