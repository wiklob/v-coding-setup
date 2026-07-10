#!/usr/bin/env bash
# sb-push.test.sh — empirical probes for the V-45 migration content-safety gate.
#
# This repo has no live Supabase project, so we stub `supabase` on PATH and use
# a temp HOME (the apply lock lives at $HOME/.claude/run) to exercise the gate
# in bin/sb-push WITHOUT touching a real DB. We assert OBSERVABLE side-effects —
# whether the stub's `db push` ran (push log) and whether the lock dir appeared —
# never by reading code (per the verify-asserted-invariants discipline).
#
# Covers Acceptance:
#   2 fail-closed   : unsafe + --apply → exit 1, NO push ran, NO lock taken
#   3 safe-path     : unsafe + --dry-run → WARNING only, exit 0
#   4 no-false-pos  : additive + --apply/--dry-run → exit 0, push allowed
#   5 squawk-absent : --apply refuses loudly (exit 1, no push); --dry-run warns
#
# squawk must be installed for the unsafe-detection to be genuine.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SBPUSH="$HERE/sb-push"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s\n' "$1"; fail=$((fail+1)); }

if ! command -v squawk >/dev/null 2>&1; then
  echo "sb-push.test: squawk not installed — install 'npm install -g squawk-cli' to run detection probes." >&2
  exit 2
fi

UNSAFE='ALTER TABLE users DROP COLUMN email;'
SAFE='CREATE TABLE widgets (id bigint primary key, name text);'

# Build an isolated sandbox with a stub `supabase` and a fake repo.
# $1 = migration SQL body. Echoes the sandbox dir.
make_sandbox() {
  local box; box="$(mktemp -d)"
  mkdir -p "$box/bin" "$box/repo/supabase/migrations" "$box/home"
  cat > "$box/bin/supabase" <<EOF
#!/usr/bin/env bash
# Stub supabase: canned migration list (no applied remote rows → ordering guard
# is a no-op), and record any db push so the test can observe whether it ran.
case "\$*" in
  "migration list --linked")
    printf '   Local | Remote | Time (UTC)\n'
    printf '  -------|--------|-----------\n'
    ;;
  "db push --linked --dry-run") echo dry-run-push >> "$box/pushlog" ;;
  "db push --linked --yes")     echo real-push    >> "$box/pushlog" ;;
esac
exit 0
EOF
  chmod +x "$box/bin/supabase"
  printf 'export SUPABASE_PROJECT_ID=teststub\n' > "$box/repo/.envrc"
  printf '%s\n' "$1" > "$box/repo/supabase/migrations/20240101000000_test.sql"
  printf '%s' "$box"
}

# Build a sandbox with TWO migrations and a controllable applied-remote set (V-153):
# a HISTORICAL migration (20231231000000_hist.sql) reported as APPLIED in the stub's
# `migration list` Remote column, and a PENDING migration (20240101000000_pending.sql)
# with an empty Remote. This lets us prove the content lint scopes to pending only.
#   $1 = historical (applied) SQL body   $2 = pending SQL body. Echoes the sandbox dir.
make_sandbox2() {
  local box; box="$(mktemp -d)"
  mkdir -p "$box/bin" "$box/repo/supabase/migrations" "$box/home"
  cat > "$box/bin/supabase" <<EOF
#!/usr/bin/env bash
# Stub supabase: report the historical migration as applied (Remote populated) and
# the pending one as not-yet-applied (Remote empty); record any db push.
case "\$*" in
  "migration list --linked")
    printf '   Local | Remote | Time (UTC)\n'
    printf '  -------|--------|-----------\n'
    printf '   20231231000000 | 20231231000000 | 2023-12-31 00:00:00\n'
    printf '   20240101000000 |                |\n'
    ;;
  "db push --linked --dry-run") echo dry-run-push >> "$box/pushlog" ;;
  "db push --linked --yes")     echo real-push    >> "$box/pushlog" ;;
esac
exit 0
EOF
  chmod +x "$box/bin/supabase"
  printf 'export SUPABASE_PROJECT_ID=teststub\n' > "$box/repo/.envrc"
  printf '%s\n' "$1" > "$box/repo/supabase/migrations/20231231000000_hist.sql"
  printf '%s\n' "$2" > "$box/repo/supabase/migrations/20240101000000_pending.sql"
  printf '%s' "$box"
}

# Build a sandbox with SEQUENTIAL 000NN-named migrations (V-155): an APPLIED
# historical 00001 (reported in the Remote column) and a PENDING 00002 (empty
# Remote). Proves format-agnostic applied detection — the applied 000NN file must
# be skipped (no over-block) while the pending 000NN file is still content-linted
# (closing V-153's fail-open, which only ever scoped to 14-digit timestamps).
#   $1 = applied (historical) SQL body   $2 = pending SQL body. Echoes the sandbox dir.
make_sandbox_seq() {
  local box; box="$(mktemp -d)"
  mkdir -p "$box/bin" "$box/repo/supabase/migrations" "$box/home"
  cat > "$box/bin/supabase" <<EOF
#!/usr/bin/env bash
# Stub supabase: 000NN scheme — report 00001 applied (Remote populated), 00002
# pending (Remote empty); record any db push.
case "\$*" in
  "migration list --linked")
    printf '   Local | Remote | Time (UTC)\n'
    printf '  -------|--------|-----------\n'
    printf '   00001 | 00001 | 2023-12-31 00:00:00\n'
    printf '   00002 |       |\n'
    ;;
  "db push --linked --dry-run") echo dry-run-push >> "$box/pushlog" ;;
  "db push --linked --yes")     echo real-push    >> "$box/pushlog" ;;
esac
exit 0
EOF
  chmod +x "$box/bin/supabase"
  printf 'export SUPABASE_PROJECT_ID=teststub\n' > "$box/repo/.envrc"
  printf '%s\n' "$1" > "$box/repo/supabase/migrations/00001_hist.sql"
  printf '%s\n' "$2" > "$box/repo/supabase/migrations/00002_pending.sql"
  printf '%s' "$box"
}

# Build a sandbox with a single UNCLASSIFIABLE-named pending migration (V-155): a
# filename with no pure-digit version prefix (no parseable version). The stub
# reports NO applied remote rows. Proves the fail-closed path — an unclassifiable
# file is linted defensively (never silently skipped), so a dangerous one refuses.
#   $1 = SQL body. Echoes the sandbox dir.
make_sandbox_noverfile() {
  local box; box="$(mktemp -d)"
  mkdir -p "$box/bin" "$box/repo/supabase/migrations" "$box/home"
  cat > "$box/bin/supabase" <<EOF
#!/usr/bin/env bash
# Stub supabase: no applied remote rows; record any db push.
case "\$*" in
  "migration list --linked")
    printf '   Local | Remote | Time (UTC)\n'
    printf '  -------|--------|-----------\n'
    ;;
  "db push --linked --dry-run") echo dry-run-push >> "$box/pushlog" ;;
  "db push --linked --yes")     echo real-push    >> "$box/pushlog" ;;
esac
exit 0
EOF
  chmod +x "$box/bin/supabase"
  printf 'export SUPABASE_PROJECT_ID=teststub\n' > "$box/repo/.envrc"
  printf '%s\n' "$1" > "$box/repo/supabase/migrations/init_users.sql"
  printf '%s' "$box"
}

# Run sb-push in a sandbox. $1=box $2=mode $3=(optional)"no-squawk".
# Echoes the exit code; leaves $box/out (combined output) and $box/pushlog.
run() {
  local box="$1" mode="$2" path rc
  if [ "${3:-}" = "no-squawk" ]; then
    path="$box/bin:/usr/bin:/bin"          # coreutils present, squawk (nvm dir) absent
  else
    path="$box/bin:$PATH"                   # stub supabase first, real squawk via inherited PATH
  fi
  ( cd "$box/repo" && HOME="$box/home" PATH="$path" "$SBPUSH" "$mode" ) >"$box/out" 2>&1
  rc=$?
  echo "$rc"
}

lock_taken()  { [ -e "$1/home/.claude/run/sb-push-teststub.lock" ]; }   # after-exit; trap clears on clean release
pushed_real() { grep -q real-push    "$1/pushlog" 2>/dev/null; }
pushed_any()  { [ -s "$1/pushlog" ]; }
warned()      { grep -q 'WARNING' "$1/out" 2>/dev/null; }
refused()     { grep -q 'REFUSED\|apply refused' "$1/out" 2>/dev/null; }

# ── 2. fail-closed: unsafe + --apply ──
b="$(make_sandbox "$UNSAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "1" ] && ! pushed_any "$b" && refused "$b"; then
  ok "unsafe --apply: exit 1, no db push ran, refused before lock/push"
else bad "unsafe --apply should refuse before any push (exit=$rc pushlog=$(cat "$b/pushlog" 2>/dev/null))"; fi
rm -rf "$b"

# ── 3. safe-path: unsafe + --dry-run ──
b="$(make_sandbox "$UNSAFE")"; rc="$(run "$b" --dry-run)"
if [ "$rc" = "0" ] && warned "$b"; then
  ok "unsafe --dry-run: WARNING only, exit 0 (read-only path unblocked)"
else bad "unsafe --dry-run should warn and exit 0 (exit=$rc)"; fi
rm -rf "$b"

# ── 4. no false-positive: additive ──
b="$(make_sandbox "$SAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "0" ] && pushed_real "$b" && ! lock_taken "$b"; then
  ok "additive --apply: exit 0, push allowed through, lock released"
else bad "additive --apply should pass clean and push (exit=$rc pushlog=$(cat "$b/pushlog" 2>/dev/null))"; fi
rm -rf "$b"

b="$(make_sandbox "$SAFE")"; rc="$(run "$b" --dry-run)"
if [ "$rc" = "0" ] && ! pushed_real "$b" && ! warned "$b"; then
  ok "additive --dry-run: exit 0, no content warning, no real push"
else bad "additive --dry-run should pass clean (exit=$rc)"; fi
rm -rf "$b"

# ── 5. squawk-absent: fail closed on --apply, warn on --dry-run ──
b="$(make_sandbox "$UNSAFE")"; rc="$(run "$b" --apply no-squawk)"
if [ "$rc" = "1" ] && ! pushed_any "$b" && grep -q 'not installed\|NOT verified' "$b/out"; then
  ok "squawk absent --apply: refuses loudly (exit 1), no push — not a silent skip"
else bad "squawk absent --apply should refuse loudly (exit=$rc)"; fi
rm -rf "$b"

b="$(make_sandbox "$UNSAFE")"; rc="$(run "$b" --dry-run no-squawk)"
if [ "$rc" = "0" ] && warned "$b"; then
  ok "squawk absent --dry-run: WARNING only, exit 0 (read-only unblocked)"
else bad "squawk absent --dry-run should warn and exit 0 (exit=$rc)"; fi
rm -rf "$b"

# ── 6. V-153: historical-dirty (applied) + pending-clean → applies ──
b="$(make_sandbox2 "$UNSAFE" "$SAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "0" ] && pushed_real "$b"; then
  ok "historical unsafe (applied) + pending safe --apply: exit 0, push allowed — applied migration not re-linted"
else bad "historical-dirty/pending-clean --apply should pass (exit=$rc out=$(cat "$b/out" 2>/dev/null))"; fi
rm -rf "$b"

# ── 7. V-153: historical-clean (applied) + pending-dirty → still refuses ──
b="$(make_sandbox2 "$SAFE" "$UNSAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "1" ] && ! pushed_any "$b" && refused "$b"; then
  ok "historical safe (applied) + pending unsafe --apply: exit 1, refused — pending guard preserved"
else bad "pending-dirty --apply should refuse (exit=$rc pushlog=$(cat "$b/pushlog" 2>/dev/null))"; fi
rm -rf "$b"

# ── 8. V-155: 000NN applied-unsafe + pending-safe → applies (format-agnostic, no over-block) ──
# Proves the applied 000NN file is RECOGNIZED as applied and skipped — the V-153
# over-block does NOT return for sequential naming (acceptance #2).
b="$(make_sandbox_seq "$UNSAFE" "$SAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "0" ] && pushed_real "$b"; then
  ok "000NN applied-unsafe + pending-safe --apply: exit 0, push allowed — applied 000NN history not re-linted"
else bad "000NN applied-dirty/pending-clean --apply should pass (exit=$rc out=$(cat "$b/out" 2>/dev/null))"; fi
rm -rf "$b"

# ── 9. V-155: 000NN applied-safe + pending-UNSAFE → refuses (closes the fail-open) ──
# The V-153 blind spot: a lint-failing PENDING 000NN migration. Pre-V-155 the
# pending set was empty (no 14-digit match) → content lint skipped → this would
# have PASSED. It must now refuse (acceptance #3 + #4 = V-153 acceptance #3).
b="$(make_sandbox_seq "$SAFE" "$UNSAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "1" ] && ! pushed_any "$b" && refused "$b"; then
  ok "000NN applied-safe + pending-unsafe --apply: exit 1, refused — fail-open closed for sequential naming"
else bad "000NN pending-unsafe --apply should refuse (exit=$rc pushlog=$(cat "$b/pushlog" 2>/dev/null))"; fi
rm -rf "$b"

# ── 10. V-155: unclassifiable-named pending UNSAFE → refuses (fail-closed) ──
# A file with no parseable version prefix must be linted DEFENSIVELY, never
# silently skipped (acceptance #3 — closed for ALL naming schemes).
b="$(make_sandbox_noverfile "$UNSAFE")"; rc="$(run "$b" --apply)"
if [ "$rc" = "1" ] && ! pushed_any "$b" && refused "$b"; then
  ok "unclassifiable-named pending unsafe --apply: exit 1, refused — fail-closed, not silently skipped"
else bad "unclassifiable pending-unsafe --apply should refuse (exit=$rc out=$(cat "$b/out" 2>/dev/null))"; fi
rm -rf "$b"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
