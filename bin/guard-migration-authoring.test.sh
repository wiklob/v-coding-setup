#!/usr/bin/env bash
# guard-migration-authoring.test.sh — empirical probes for the V-330 authoring guard.
# Test-less repo → this runnable .test.sh IS the encoded proof of the negative
# (scope.md §3): we feed the PreToolUse hook real tool-event JSON on stdin and assert
# the OBSERVABLE decision (deny JSON on stdout vs empty), never by reading its code.
#
# The load-bearing pair (the V-330 thesis-check catch):
#   • new-file round-number / non-monotonic prefix → DENY (the guard fires)
#   • Edit of an EXISTING sb-new-minted stub (prefix == local max) → ALLOW (never over-blocks)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-migration-authoring.py"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s\n' "$1"; fail=$((fail+1)); }

# Feed a tool event; echo DENY (hook emitted a deny decision) or ALLOW (empty stdout).
decide() {  # $1 = tool_name, $2 = file_path
  local out
  out="$(printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2" | python3 "$HOOK" 2>/dev/null)"
  if printf '%s' "$out" | grep -q '"deny"'; then echo DENY; else echo ALLOW; fi
}

box="$(mktemp -d)"; mig="$box/supabase/migrations"; mkdir -p "$mig"

# ── 1. new-file round-number …000000 → DENY ──
[ "$(decide Write "$mig/20260703000000_ydoc.sql")" = DENY ] \
  && ok "new round-number …000000 → DENY" || bad "round-number new file should DENY"

# ── 2. empty-dir FIRST migration, non-round, no siblings → ALLOW (empty-max case) ──
[ "$(decide Write "$mig/20260705120000_first.sql")" = ALLOW ] \
  && ok "empty-dir first migration (non-round, no others) → ALLOW" || bad "empty-dir first non-round should ALLOW"

# Now seed an existing migration as the local max (as sb-new would mint + the author edits).
printf -- '-- ddl\n' > "$mig/20260705120000_stub.sql"

# ── 3. new-file non-monotonic (<= existing max) → DENY ──
[ "$(decide Write "$mig/20260705100000_older.sql")" = DENY ] \
  && ok "new non-monotonic prefix (<= local max) → DENY" || bad "non-monotonic new file should DENY"

# ── 4. new-file strictly-greater prefix → ALLOW ──
[ "$(decide Write "$mig/20260705130000_newer.sql")" = ALLOW ] \
  && ok "new strictly-greater prefix → ALLOW" || bad "strictly-greater new file should ALLOW"

# ── 5. Edit of the EXISTING sb-new-minted stub (prefix == local max) → ALLOW (the catch) ──
[ "$(decide Edit "$mig/20260705120000_stub.sql")" = ALLOW ] \
  && ok "Edit of existing stub (prefix == max) → ALLOW (the sb-new→edit flow, thesis-check catch)" \
  || bad "editing an existing migration must never be denied"

# ── 6. Write to the EXISTING stub (overwrite an on-disk migration) → ALLOW ──
[ "$(decide Write "$mig/20260705120000_stub.sql")" = ALLOW ] \
  && ok "Write to an existing migration file → ALLOW (existing, not creation)" || bad "Write-to-existing should ALLOW"

# ── 7. non-migration path → ALLOW (allow-fast, not our business) ──
[ "$(decide Write "$box/src/components/usePageEditor.ts")" = ALLOW ] \
  && ok "non-migration path → ALLOW (allow-fast)" || bad "non-migration path should ALLOW"

# ── 8. new migration with a non-14-digit prefix → ALLOW (fail open, can't judge) ──
[ "$(decide Write "$mig/init_users.sql")" = ALLOW ] \
  && ok "non-14-digit-prefix new migration → ALLOW (fail open)" || bad "unparseable prefix should fail open"

rm -rf "$box"
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
