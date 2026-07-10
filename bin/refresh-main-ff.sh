#!/usr/bin/env bash
# ~/.claude/bin/refresh-main-ff.sh
# Single allowlisted call for the /land-ticket §7 "refresh main" teardown step.
#
# Usage:
#   bash ~/.claude/bin/refresh-main-ff.sh <main-worktree-path> <base-branch>
#
# Why this exists (V-334): §7 teardown refreshes the main checkout's local
# `<base>` ref with `git -C "<main>" fetch origin <base>` then
# `git -C "<main>" merge --ff-only origin/<base>`. In the pipeline's own
# `~/.claude` main checkout, `settings.json` (harness-written `model`/
# `effortLevel` machine-local drift) and `pipeline/audit/gate-audit.md`
# (/go's perpetual append log) carry PERMANENT uncommitted drift. When an
# incoming commit touches a drifted file, `--ff-only` aborts file-level
# ("Your local changes to the following files would be overwritten by merge:
# settings.json … Aborting"), so every land ended with the same manual
# "commit/stash then ff-only" recovery note and local main never advanced.
#
# Empirically ruled out (tested against real git, V-334):
#   - `git update-index --assume-unchanged` / `--skip-worktree`: ff-only STILL
#     aborts — merge's overwrite-safety checks the file regardless.
#   - auto-stash + `git stash pop`: the 3-way pop leaves `<<<<<<<` CONFLICT
#     markers in the LIVE settings.json (JSON keys are adjacent → one hunk),
#     corrupting the file — worse than the abort.
#
# What works: advance the ref while preserving the drift VERBATIM (no 3-way
# merge, so it can never conflict or corrupt):
#   stash the drift -> ff -> `git checkout <stash> -- <drifted files>`
#   (overwrite-restore, not pop) -> drop the stash.
# Result: local main advances; the working-tree drift is preserved exactly as
# it was (still shown as uncommitted `M` against the advanced ref — the same
# reconciliation debt as before, never discarded). Never forces, never resets
# hard, never discards drift.
#
# Degrades safely: a clean checkout just fast-forwards; if ff is blocked by
# something other than unstaged drift (staged change, unrelated state) the
# stash is restored and the original surface-and-continue note is emitted
# (exit 0 — teardown still completes; main simply not advanced, as before).

set -u

main="${1:?usage: refresh-main-ff.sh <main-worktree-path> <base-branch>}"
base="${2:?usage: refresh-main-ff.sh <main-worktree-path> <base-branch>}"

g() { git -C "$main" "$@"; }

# fetch always — safe regardless of drift; advances origin/<base> so
# remote-tracking refs / logs are current even if the local ref can't move.
g fetch origin "$base" || {
  echo "refresh-main-ff: fetch origin $base FAILED — main not refreshed; continuing teardown."
  exit 0
}

# Fast path: clean, or drift doesn't collide → plain ff.
if g merge --ff-only "origin/$base" >/dev/null 2>&1; then
  echo "refresh-main-ff: fast-forwarded local $base in $main"
  exit 0
fi

# ff aborted. Capture the unstaged tracked drift (the perpetual settings.json /
# gate-audit.md churn) and preserve it verbatim across the ff. (Portable read
# loop rather than `mapfile` so this runs under bash 3.2 too.)
drift=()
while IFS= read -r f; do
  [ -n "$f" ] && drift+=("$f")
done < <(g diff --name-only)

if [ "${#drift[@]}" -eq 0 ]; then
  # Nothing unstaged to stash — the block is staged/other state, not the drift
  # case this helper handles. Surface and continue, exactly as before.
  echo "refresh-main-ff: fetched origin/$base (tip current); local $base NOT fast-forwarded — ff-only blocked by non-drift state (staged change?). Resolve manually, then 'git -C \"$main\" merge --ff-only origin/$base'. Continuing teardown."
  exit 0
fi

g stash push -q -m "land-teardown(V-334): preserve local drift across ff" -- "${drift[@]}" || {
  echo "refresh-main-ff: could not stash local drift — leaving main un-advanced (drift untouched). Continuing teardown."
  exit 0
}

if g merge --ff-only "origin/$base" 2>/dev/null; then
  # Restore each drifted file VERBATIM from the stash (overwrite, no 3-way
  # merge — cannot conflict or corrupt), then drop the stash.
  g checkout "stash@{0}" -- "${drift[@]}"
  g restore --staged "${drift[@]}" 2>/dev/null || true
  g stash drop -q
  echo "refresh-main-ff: fast-forwarded local $base in $main (local drift on ${#drift[@]} file(s) preserved verbatim: ${drift[*]})"
  exit 0
fi

# ff still blocked after stashing the unstaged drift — a different obstacle.
# Restore the drift and fall back to the pre-V-334 surface-and-continue.
g stash pop -q 2>/dev/null || true
echo "refresh-main-ff: fetched origin/$base (tip current); local $base NOT fast-forwarded — collision persists after stashing drift; drift restored untouched. Resolve manually, then 'git -C \"$main\" merge --ff-only origin/$base'. Continuing teardown."
exit 0
