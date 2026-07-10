#!/usr/bin/env bash
# migration-collision-check.test.sh — empirical probes for the V-330 cross-branch
# migration-collision guard. Test-less repo → this runnable .test.sh IS the encoded
# proof (scope.md §3): we assert OBSERVABLE exit codes + named offenders, never by
# reading the guard's code. Builds throwaway dirs / git repos, runs the real helper.
#
# Covers Acceptance:
#   1 (land, cross-branch) : git-ref mode flags a duplicate prefix across two heads
#                            and an out-of-order head prefix, naming the files.
#   2 (CI, merge-result)   : cwd mode flags a duplicate prefix in the merged tree;
#                            the `cut -c1-14 | sort | uniq -d` minimal core.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/migration-collision-check"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s\n' "$1"; fail=$((fail+1)); }

# Run the helper in cwd mode inside a dir; echoes exit code, leaves $box/out.
run_cwd() { ( cd "$1" && "$CHECK" ) >"$1/out" 2>&1; echo $?; }
# Run in git-ref mode from a repo; $2.. = extra args. Echoes exit, leaves $1/out.
run_ref() { local box="$1"; shift; ( cd "$box" && "$CHECK" "$@" ) >"$box/out" 2>&1; echo $?; }

mk() { mkdir -p "$1/supabase/migrations"; }        # a bare working dir with a migdir
add() { printf -- '-- test\n' > "$1/supabase/migrations/$2"; }   # add a migration file

# A git repo: base on `main` carrying the files in $2 (space-sep), then empty
# head branches head1/head2 for the caller to populate. Echoes the repo dir.
git_repo() {
  local box; box="$(mktemp -d)"
  git -c init.defaultBranch=main init -q "$box"
  git -C "$box" config user.email t@t; git -C "$box" config user.name t
  mkdir -p "$box/supabase/migrations"
  local f
  for f in $1; do printf -- '-- base\n' > "$box/supabase/migrations/$f"; done
  git -C "$box" add -A >/dev/null 2>&1
  git -C "$box" commit -qm base --allow-empty
  git -C "$box" branch head1; git -C "$box" branch head2
  printf '%s' "$box"
}
# Commit files (space-sep) onto branch $2 of repo $1.
commit_on() {
  local box="$1" br="$2"; shift 2
  git -C "$box" checkout -q "$br"
  local f; for f in "$@"; do printf -- '-- head\n' > "$box/supabase/migrations/$f"; done
  git -C "$box" add -A >/dev/null 2>&1; git -C "$box" commit -qm "$br" --allow-empty
  git -C "$box" checkout -q main
}

# ── CWD 1: clean set → exit 0 ──
b="$(mktemp -d)"; mk "$b"; add "$b" 20260101000000_a.sql; add "$b" 20260102000000_b.sql
rc="$(run_cwd "$b")"
if [ "$rc" = 0 ]; then ok "cwd clean set → exit 0"; else bad "cwd clean should pass (exit=$rc $(cat "$b/out"))"; fi
rm -rf "$b"

# ── CWD 2: duplicate prefix in merged tree → exit 1, names both (acceptance 2) ──
b="$(mktemp -d)"; mk "$b"; add "$b" 20260703000000_ydoc.sql; add "$b" 20260703000000_tiers.sql
rc="$(run_cwd "$b")"
if [ "$rc" = 1 ] && grep -q '20260703000000' "$b/out" && grep -q 'ydoc' "$b/out" && grep -q 'tiers' "$b/out"; then
  ok "cwd duplicate prefix → exit 1, both files named (the EDIT-1↔EDIT-10 class)"
else bad "cwd duplicate should exit 1 naming both (exit=$rc out=$(cat "$b/out"))"; fi
rm -rf "$b"

# ── CWD 3: no migdir → clean skip (exit 0) ──
b="$(mktemp -d)"; rc="$(run_cwd "$b")"
if [ "$rc" = 0 ] && grep -q 'nothing to check' "$b/out"; then ok "cwd no migdir → clean skip"; else bad "cwd no migdir should skip clean (exit=$rc)"; fi
rm -rf "$b"

# ── CWD 4: distinct round-number prefixes are NOT a duplicate (no false positive) ──
b="$(mktemp -d)"; mk "$b"; add "$b" 20260101000000_a.sql; add "$b" 20260410000000_b.sql
rc="$(run_cwd "$b")"
if [ "$rc" = 0 ]; then ok "cwd distinct round-number prefixes → exit 0 (no false positive)"; else bad "cwd distinct prefixes should pass (exit=$rc out=$(cat "$b/out"))"; fi
rm -rf "$b"

# ── REF 1: two heads share a prefix → duplicate across branches (acceptance 1) ──
r="$(git_repo "20260101000000_base.sql")"
commit_on "$r" head1 20260703000000_ydoc.sql
commit_on "$r" head2 20260703000000_tiers.sql
rc="$(run_ref "$r" --base main --head head1 --head head2)"
if [ "$rc" = 1 ] && grep -q '20260703000000' "$r/out" && grep -q 'ydoc' "$r/out" && grep -q 'tiers' "$r/out"; then
  ok "ref two heads same prefix → exit 1, cross-branch duplicate named (EDIT-1↔EDIT-10)"
else bad "ref cross-branch duplicate should exit 1 (exit=$rc out=$(cat "$r/out"))"; fi
rm -rf "$r"

# ── REF 2: head migration sorts before base's latest → out-of-order (acceptance 1) ──
r="$(git_repo "20260601000000_base.sql")"
commit_on "$r" head1 20260410000000_early.sql   # earlier than base's 2026-06-01
rc="$(run_ref "$r" --base main --head head1)"
if [ "$rc" = 1 ] && grep -qi 'out-of-order' "$r/out" && grep -q 'early' "$r/out"; then
  ok "ref out-of-order head prefix (<= base max) → exit 1, file named"
else bad "ref out-of-order should exit 1 (exit=$rc out=$(cat "$r/out"))"; fi
rm -rf "$r"

# ── REF 3: head migration strictly after base → clean ──
r="$(git_repo "20260101000000_base.sql")"
commit_on "$r" head1 20260702000000_new.sql
rc="$(run_ref "$r" --base main --head head1)"
if [ "$rc" = 0 ]; then ok "ref head strictly after base → exit 0 (clean)"; else bad "ref clean head should pass (exit=$rc out=$(cat "$r/out"))"; fi
rm -rf "$r"

# ── REF 4: same file in base and head (not a new file) → NOT a duplicate ──
# base carries the file; head1 leaves it untouched and adds nothing new → the
# shared migration must not read as a cross-branch duplicate of itself.
r="$(git_repo "20260101000000_shared.sql")"
rc="$(run_ref "$r" --base main --head head1)"
if [ "$rc" = 0 ]; then ok "ref file shared by base+head → exit 0 (same migration, not a duplicate)"; else bad "ref shared file should pass (exit=$rc out=$(cat "$r/out"))"; fi
rm -rf "$r"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
