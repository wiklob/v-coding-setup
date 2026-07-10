#!/usr/bin/env bash
# V-194 reproduction: the V-9 `merge=union` git attribute does NOT fix GitHub-side
# mergeability. GitHub computes PR mergeability with a plain 3-way merge that ignores
# custom / .gitattributes merge drivers, so concurrent changelog appends that resolve
# cleanly locally (union honored) still show CONFLICTING on GitHub.
#
# Model: "GitHub merge" = `git merge-tree` with NO union attribute active.
#        "local git merge" = `git merge-tree` WITH `<changelog> merge=union` active.
# `git merge-tree --write-tree` exits 0 on a clean merge, non-zero on conflict.
#
# Run: bash docs/v-194-changelog-conflict-repro.sh
set -u

newrepo() { local d; d="$(mktemp -d)"; git -C "$d" init -q
  git -C "$d" config user.email t@t; git -C "$d" config user.name t
  git -C "$d" config commit.gpgsign false; echo "$d"; }

# 3-way merge of branches A and B in repo $1 → "CLEAN" | "CONFLICT"
merge_status() { if git -C "$1" merge-tree --write-tree A B >/dev/null 2>&1; then echo CLEAN; else echo CONFLICT; fi; }

hr() { printf -- '------------------------------------------------------------\n'; }

# ── BEFORE (the bug): two concurrent lands prepend to the shared `## Recent` anchor ──
hr; echo "BEFORE — current §6.5: prepend line to changelog.md '## Recent'"
R="$(newrepo)"
printf '## Recent\n- old entry\n' > "$R/changelog.md"
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" branch -f A; git -C "$R" branch -f B
git -C "$R" switch -q A; printf '## Recent\n- PR #100 land\n- old entry\n' > "$R/changelog.md"; git -C "$R" commit -qam A
git -C "$R" switch -q B; printf '## Recent\n- PR #101 land\n- old entry\n' > "$R/changelog.md"; git -C "$R" commit -qam B
echo "  GitHub mergeability (no union driver):  $(merge_status "$R")   <- the V-194 bug"
# same two lands, but with the union attribute active (what V-9 relied on, local only)
printf 'changelog.md merge=union\n' > "$R/.gitattributes"
git -C "$R" switch -q master 2>/dev/null || git -C "$R" switch -q main
git -C "$R" add -A; git -C "$R" commit -qm attr
echo "  local git merge (union driver active):  $(merge_status "$R")   <- why it looked fixed"

# ── candidate 1 (EOF append): proven INSUFFICIENT — both appends still touch the tail ──
hr; echo "candidate 1 — EOF append (ticket's first suggestion)"
R="$(newrepo)"
printf '## Recent\n- old entry\n' > "$R/changelog.md"
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" branch -f A; git -C "$R" branch -f B
git -C "$R" switch -q A; printf '## Recent\n- old entry\n- PR #100 land\n' > "$R/changelog.md"; git -C "$R" commit -qam A
git -C "$R" switch -q B; printf '## Recent\n- old entry\n- PR #101 land\n' > "$R/changelog.md"; git -C "$R" commit -qam B
echo "  GitHub mergeability (no union driver):  $(merge_status "$R")   <- candidate 1 does NOT fix it"

# ── AFTER (the fix): each land writes a uniquely-named fragment file; changelog.md untouched ──
hr; echo "AFTER — chosen fix: per-PR fragment file changelog.d/<PR>.md"
R="$(newrepo)"
mkdir -p "$R/changelog.d"; printf '## Recent\n- old entry\n' > "$R/changelog.md"
printf -- '- seed\n' > "$R/changelog.d/.keep"   # keep the dir tracked across checkouts
git -C "$R" add -A; git -C "$R" commit -qm base
git -C "$R" branch -f A; git -C "$R" branch -f B
git -C "$R" switch -q A; printf -- '- PR #100 land\n' > "$R/changelog.d/100.md"; git -C "$R" add -A; git -C "$R" commit -qam A
git -C "$R" switch -q B; printf -- '- PR #101 land\n' > "$R/changelog.d/101.md"; git -C "$R" add -A; git -C "$R" commit -qam B
echo "  GitHub mergeability (no union driver):  $(merge_status "$R")   <- the fix: distinct files never collide"
hr
