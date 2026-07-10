#!/usr/bin/env bash
# validate-settings-json.test.sh — worked repro for bin/validate-settings-json.mjs (V-108).
#
# The encoded proof of the negative for V-108's safety property: a settings.json
# left with unresolved conflict markers / malformed JSON is CAUGHT (exit 2,
# surfaced) instead of silently passing — while a clean settings.json and a
# missing file never block the session. This is the empirical probe Acceptance
# item 3 demands ("inject a marker, confirm the guard catches it") and the
# source-agnostic backstop item 1 rests on (the corruptor isn't committed code).
#
# Asserts the guard contract:
#   clean valid JSON                    → exit 0   (never blocks)
#   unresolved git conflict markers     → exit 2   (CAUGHT — the entry-272 case)
#   malformed JSON (no markers)         → exit 2   (CAUGHT)
#   missing target file                 → exit 0   (absence is not corruption)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/validate-settings-json.mjs"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s (got exit: %s)\n' "$1" "$2"; fail=$((fail+1)); }

box="$(mktemp -d)"; trap 'rm -rf "$box"' EXIT

# Run the guard against a target file; echo only its exit code.
rc_of() { node "$GUARD" "$1" </dev/null >/dev/null 2>&1; echo $?; }

# --- fixture: clean, valid settings.json ---
CLEAN="$box/clean.json"
printf '%s\n' '{ "permissions": { "allow": ["Bash(git *)"], "deny": [] } }' > "$CLEAN"
rc=$(rc_of "$CLEAN")
[ "$rc" -eq 0 ] && ok "clean valid JSON → exit 0 (never blocks)" || bad "clean JSON blocked" "$rc"

# --- fixture: unresolved git conflict markers (the entry-272 corruptor) ---
CONFLICT="$box/conflict.json"
cat > "$CONFLICT" <<'EOF'
{
  "permissions": {
<<<<<<< Updated upstream
    "allow": ["Write(/Users/testuser/*-claude-wt-*/.claude/active-project.json)"]
=======
    "allow": ["Write(/Users/testuser/-claude-wt-*/.claude/active-project.json)"]
>>>>>>> Stashed changes
  }
}
EOF
rc=$(rc_of "$CONFLICT")
[ "$rc" -eq 2 ] && ok "conflict markers → exit 2 (CAUGHT — the V-108 corruptor)" || bad "conflict markers NOT caught" "$rc"

# --- fixture: malformed JSON, no conflict markers ---
BROKEN="$box/broken.json"
printf '%s\n' '{ "permissions": { "allow": [ }' > "$BROKEN"
rc=$(rc_of "$BROKEN")
[ "$rc" -eq 2 ] && ok "malformed JSON → exit 2 (CAUGHT)" || bad "malformed JSON NOT caught" "$rc"

# --- missing target file — absence is not corruption, never block ---
rc=$(rc_of "$box/does-not-exist.json")
[ "$rc" -eq 0 ] && ok "missing target → exit 0 (absence is not corruption)" || bad "missing file blocked" "$rc"

# --- the live committed settings.json must itself be valid (regression guard) ---
rc=$(rc_of "$HERE/../settings.json")
[ "$rc" -eq 0 ] && ok "repo settings.json is valid JSON" || bad "repo settings.json invalid" "$rc"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
