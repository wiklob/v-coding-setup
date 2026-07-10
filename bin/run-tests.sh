#!/usr/bin/env bash
# Run the whole bin/ test suite + standalone probes. The port/CI gate.
#
# Usage:  bash bin/run-tests.sh [-q]
#   -q  quiet — print only failures and the summary line.
# Exit:   0 = all green, 1 = at least one failure.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quiet=0
[ "${1:-}" = "-q" ] && quiet=1

fails=0
runs=0

run_one() {  # <label> <cmd...>
  local label="$1"; shift
  runs=$((runs + 1))
  local out
  if out="$("$@" 2>&1)"; then
    [ "$quiet" -eq 0 ] && echo "PASS $label"
  else
    echo "FAIL $label"
    printf '%s\n' "$out" | tail -20
    fails=$((fails + 1))
  fi
}

for t in "$SCRIPT_DIR"/*.test.mjs; do
  run_one "${t##*/}" node "$t"
done
for t in "$SCRIPT_DIR"/*.test.sh; do
  run_one "${t##*/}" bash "$t"
done
run_one "guard-access.test.py" python3 "$SCRIPT_DIR/guard-access.test.py"

# Standalone regression probes (self-testing detectors).
run_one "check-no-hardcoded-repo-cd.sh" bash "$SCRIPT_DIR/check-no-hardcoded-repo-cd.sh"
run_one "probe-claude-gate.sh" bash "$SCRIPT_DIR/probe-claude-gate.sh"

echo "---"
echo "ran $runs, failures: $fails"
[ "$fails" -eq 0 ]
