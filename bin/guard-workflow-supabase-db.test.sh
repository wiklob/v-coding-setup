#!/usr/bin/env bash
# guard-workflow-supabase-db.test.sh — empirical probes for the V-395 authoring guard.
# Test-less repo → this runnable .test.sh IS the encoded proof (scope.md §3): we feed the
# PreToolUse hook real tool-event JSON on stdin and assert the OBSERVABLE decision (ask JSON
# on stdout vs empty), never by reading its code.
#
# The load-bearing pair:
#   • authoring a .github/workflows/*.yml with a destructive `supabase db` step → ASK
#   • a non-workflow path, or a non-destructive supabase db verb → ALLOW (never over-blocks)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard-workflow-supabase-db.py"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s\n' "$1"; fail=$((fail+1)); }

# Feed a Write/Edit event (content set as BOTH content and new_string so one helper covers
# both tools); echo ASK (hook emitted an ask decision) or ALLOW (empty stdout).
decide() {  # $1 = tool_name, $2 = file_path, $3 = content
  local out
  out="$(python3 -c 'import json,sys; print(json.dumps({"tool_name":sys.argv[1],"tool_input":{"file_path":sys.argv[2],"content":sys.argv[3],"new_string":sys.argv[3]}}))' "$1" "$2" "$3" | python3 "$HOOK" 2>/dev/null)"
  if printf '%s' "$out" | grep -q '"ask"'; then echo ASK; else echo ALLOW; fi
}

WF=".github/workflows/validate.yml"

# ── 1. workflow + `supabase db reset` → ASK (the CB-379 vector) ──
[ "$(decide Write "$WF" 'jobs:
  build:
    steps:
      - run: supabase db reset --linked')" = ASK ] \
  && ok "workflow Write with 'supabase db reset' → ASK" || bad "destructive reset in workflow should ASK"

# ── 2. workflow + `supabase db push` → ASK ──
[ "$(decide Write "$WF" '      - run: supabase db push --linked')" = ASK ] \
  && ok "workflow Write with 'supabase db push' → ASK" || bad "destructive push in workflow should ASK"

# ── 3. workflow + `sb-push --apply` → ASK ──
[ "$(decide Write "$WF" '      - run: sb-push --apply --linked')" = ASK ] \
  && ok "workflow Write with 'sb-push --apply' → ASK" || bad "sb-push --apply in workflow should ASK"

# ── 4. workflow + only NON-destructive supabase db (dump/diff/pull) → ALLOW ──
[ "$(decide Write "$WF" '      - run: supabase db dump -f schema.sql
      - run: supabase db diff')" = ALLOW ] \
  && ok "workflow Write with only non-destructive db verbs → ALLOW" || bad "non-destructive db verbs should ALLOW"

# ── 5. workflow + fully benign content → ALLOW ──
[ "$(decide Write "$WF" '      - run: npm test')" = ALLOW ] \
  && ok "workflow Write with benign content → ALLOW" || bad "benign workflow content should ALLOW"

# ── 6. Edit (new_string) of a workflow adding a destructive step → ASK ──
[ "$(decide Edit "$WF" '      - run: supabase db reset')" = ASK ] \
  && ok "workflow Edit new_string with 'supabase db reset' → ASK" || bad "destructive reset via Edit should ASK"

# ── 7. .yaml extension → ASK (ya?ml matches both) ──
[ "$(decide Write ".github/workflows/ci.yaml" '      - run: supabase db reset')" = ASK ] \
  && ok ".yaml workflow with destructive step → ASK" || bad ".yaml extension should be covered"

# ── 8. scope boundary: NON-workflow path with the same string → ALLOW ──
[ "$(decide Write "README.md" 'run supabase db reset to rebuild')" = ALLOW ] \
  && ok "non-workflow path (README.md) with the string → ALLOW (scope boundary)" || bad "non-workflow path should ALLOW"
[ "$(decide Write "bin/validate.sh" 'supabase db reset --linked')" = ALLOW ] \
  && ok "non-workflow path (bin/*.sh) with the string → ALLOW (scope boundary)" || bad "script path should ALLOW"

# ── 9. nested path under workflows → ALLOW (GitHub ignores nested workflows) ──
[ "$(decide Write ".github/workflows/sub/x.yml" '      - run: supabase db reset')" = ALLOW ] \
  && ok "nested .github/workflows/sub/*.yml → ALLOW (GitHub ignores nested)" || bad "nested workflow path should ALLOW"

# ── 10. MultiEdit whose edits[].new_string carries a destructive step → ASK ──
mout="$(printf '{"tool_name":"MultiEdit","tool_input":{"file_path":"%s","edits":[{"old_string":"a","new_string":"b"},{"old_string":"c","new_string":"  - run: supabase db reset"}]}}' "$WF" | python3 "$HOOK" 2>/dev/null)"
if printf '%s' "$mout" | grep -q '"ask"'; then ok "MultiEdit edits[].new_string with destructive step → ASK"; else bad "MultiEdit destructive step should ASK"; fi

# ── 11. non-Write/Edit tool (Bash) → ALLOW (not our matcher) ──
bout="$(printf '{"tool_name":"Bash","tool_input":{"command":"supabase db reset"}}' | python3 "$HOOK" 2>/dev/null)"
if printf '%s' "$bout" | grep -q '"ask"'; then bad "Bash should not be gated by this authoring hook"; else ok "Bash tool → ALLOW (runtime guard owns Bash)"; fi

# ── 12. malformed / empty event → ALLOW (fails open) ──
eout="$(printf '' | python3 "$HOOK" 2>/dev/null)"
if printf '%s' "$eout" | grep -q '"ask"'; then bad "empty event must fail open"; else ok "empty event → ALLOW (fails open)"; fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
