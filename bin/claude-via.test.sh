#!/usr/bin/env bash
# Regression probe for bin/claude-via — route resolution, env composition,
# literal-model fallback, profile warning, --list, invalid-input rejection.
#
# HERMETIC: sandbox CLAUDE_CONFIG_DIR + a fake `claude` binary (CLAUDE_BIN)
# that captures its argv and the env vars claude-via composes. No real
# Claude Code, no machine state.
#
# Usage:  bash bin/claude-via.test.sh
# Exit:   0 = PASS, 1 = FAIL.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VIA="$SCRIPT_DIR/claude-via"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CFG="$TMP/cfg"
mkdir -p "$CFG/pipeline/profiles"

CAPTURE="$TMP/capture"
FAKE="$TMP/fake-claude"
cat > "$FAKE" <<EOF
#!/bin/sh
{
  echo "ARGS:\$*"
  env | grep -E '^(ANTHROPIC_BASE_URL|CLAUDE_CODE_SUBAGENT_MODEL|CLAUDE_CODE_ALWAYS_ENABLE_EFFORT)=' | sort
} > "$CAPTURE"
EOF
chmod +x "$FAKE"

cat > "$CFG/model-routes.json" <<'EOF'
{
  "routes": {
    "sol": {
      "model": "gpt-5.6-sol",
      "baseUrl": "http://localhost:8317",
      "env": { "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT": "1" }
    },
    "subover": {
      "model": "gpt-5.6-sol",
      "baseUrl": "http://localhost:8317",
      "subagentModel": "gpt-5.6-mini"
    }
  }
}
EOF

# The routed model has a profile; literal models below do not.
touch "$CFG/pipeline/profiles/gpt-5.6-sol.md"

fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

run_via() {  # <stderr-file> <args...>
  local errf="$1"; shift
  : > "$CAPTURE"
  CLAUDE_CONFIG_DIR="$CFG" CLAUDE_BIN="$FAKE" "$VIA" "$@" 2> "$errf"
}

# --- 1. Route resolution: model arg, proxy env, extra env, arg passthrough. ---
run_via "$TMP/err1" sol --continue
grep -q '^ARGS:--model gpt-5.6-sol --continue$' "$CAPTURE" \
  && ok "route: exec's claude --model <route model> with passthrough args" \
  || { bad "route: wrong argv: $(head -1 "$CAPTURE")"; }
grep -q '^ANTHROPIC_BASE_URL=http://localhost:8317$' "$CAPTURE" \
  && ok "route: baseUrl → ANTHROPIC_BASE_URL" || bad "route: ANTHROPIC_BASE_URL missing"
grep -q '^CLAUDE_CODE_SUBAGENT_MODEL=gpt-5.6-sol$' "$CAPTURE" \
  && ok "route: subagent model defaults to the route model" || bad "route: subagent default wrong"
grep -q '^CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1$' "$CAPTURE" \
  && ok "route: extra env applied" || bad "route: extra env missing"
grep -q 'no posture profile' "$TMP/err1" \
  && bad "route: profile warning fired despite existing profile" \
  || ok "route: no profile warning when the profile exists"

# --- 2. subagentModel override respected. ---
run_via "$TMP/err2" subover
grep -q '^CLAUDE_CODE_SUBAGENT_MODEL=gpt-5.6-mini$' "$CAPTURE" \
  && ok "route: explicit subagentModel wins" || bad "route: subagentModel override ignored"

# --- 3. Literal fallback: unknown arg = model id, no proxy env, profile warning. ---
run_via "$TMP/err3" some-other-model -p hi
grep -q '^ARGS:--model some-other-model -p hi$' "$CAPTURE" \
  && ok "literal: unmatched arg used as model id with passthrough" || bad "literal: wrong argv"
grep -q '^ANTHROPIC_BASE_URL=' "$CAPTURE" \
  && bad "literal: ANTHROPIC_BASE_URL leaked into a routeless launch" \
  || ok "literal: no proxy env"
grep -q 'no posture profile' "$TMP/err3" \
  && ok "literal: warns on missing pipeline/profiles/<model>.md" \
  || bad "literal: missing-profile warning absent"

# --- 4. --list renders routes. ---
listing="$(CLAUDE_CONFIG_DIR="$CFG" "$VIA" --list)"
printf '%s\n' "$listing" | grep -q 'sol.*gpt-5.6-sol.*via http://localhost:8317' \
  && ok "--list: shows route, model, proxy" || bad "--list: output wrong: $listing"

# --- 5. Invalid routes JSON → exit 1 with message. ---
echo '{ broken' > "$CFG/model-routes.json"
if CLAUDE_CONFIG_DIR="$CFG" CLAUDE_BIN="$FAKE" "$VIA" sol 2> "$TMP/err5"; then
  bad "invalid JSON: should exit non-zero"
else
  grep -q 'not valid JSON' "$TMP/err5" && ok "invalid JSON: rejected with message" \
    || bad "invalid JSON: wrong message"
fi

# --- 6. Control characters in a route value → rejected. ---
printf '{ "routes": { "evil": { "model": "x", "baseUrl": "http://a\\tb" } } }\n' > "$CFG/model-routes.json"
if CLAUDE_CONFIG_DIR="$CFG" CLAUDE_BIN="$FAKE" "$VIA" evil 2> "$TMP/err6"; then
  bad "control chars: should exit non-zero"
else
  grep -q 'control characters' "$TMP/err6" && ok "control chars: rejected" \
    || bad "control chars: wrong message"
fi

# --- 7. No args → usage, exit 3. ---
CLAUDE_CONFIG_DIR="$CFG" "$VIA" > /dev/null 2>&1
[ $? -eq 3 ] && ok "no args: usage + exit 3" || bad "no args: wrong exit code"

if [ "$fail" -ne 0 ]; then
  echo "FAIL: claude-via regression probe failed."; exit 1
fi
echo "PASS: claude-via resolves routes, composes env, falls back, and rejects bad input."
exit 0
