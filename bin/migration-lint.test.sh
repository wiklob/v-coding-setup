#!/usr/bin/env bash
# migration-lint.test.sh — unit probes for bin/migration-lint (V-45).
# Runs the REAL squawk over fixture migrations and asserts the exit contract:
#   DROP COLUMN / ADD NOT NULL → exit 1 · additive → exit 0 · no files → exit 0
#   squawk absent → exit 3.
# squawk must be installed for the detection probes to be genuine.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LINT="$HERE/migration-lint"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s (exit=%s)\n' "$1" "$2"; fail=$((fail+1)); }

if ! command -v squawk >/dev/null 2>&1; then
  echo "migration-lint.test: squawk not installed — install 'npm install -g squawk-cli' to run detection probes." >&2
  exit 2
fi

box="$(mktemp -d)"; trap 'rm -rf "$box"' EXIT
printf 'ALTER TABLE users DROP COLUMN email;\n'                 > "$box/drop.sql"
printf 'ALTER TABLE users ADD COLUMN flag boolean NOT NULL;\n'  > "$box/notnull.sql"
printf 'CREATE TABLE widgets (id bigint primary key, name text);\nALTER TABLE widgets ADD COLUMN note text;\n' > "$box/safe.sql"

"$LINT" "$box/drop.sql"    >/dev/null 2>&1; rc=$?; [ "$rc" -ne 0 ] && ok "DROP COLUMN flagged (exit $rc)" || bad "DROP COLUMN not flagged" "$rc"
"$LINT" "$box/notnull.sql" >/dev/null 2>&1; rc=$?; [ "$rc" -ne 0 ] && ok "ADD NOT NULL flagged (exit $rc)" || bad "ADD NOT NULL not flagged" "$rc"
"$LINT" "$box/safe.sql"    >/dev/null 2>&1; rc=$?; [ "$rc" -eq 0 ] && ok "additive migration clean (exit 0)" || bad "additive migration false-positive" "$rc"
"$LINT" "$box"/none-*.sql  >/dev/null 2>&1; rc=$?; [ "$rc" -eq 0 ] && ok "no matching files → exit 0" || bad "unmatched glob not clean" "$rc"

# squawk-absent: PATH with coreutils but without the nvm dir squawk lives in.
PATH="/usr/bin:/bin" "$LINT" "$box/drop.sql" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 3 ] && ok "squawk absent → exit 3 (loud)" || bad "squawk absent not exit 3" "$rc"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
