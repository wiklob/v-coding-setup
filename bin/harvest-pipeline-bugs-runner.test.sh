#!/usr/bin/env bash
# ~/.claude/bin/harvest-pipeline-bugs-runner.test.sh
# Encoded proof of the harvest runner's headless preflight contract. (V-384)
#
# A headless launchd run has no TTY, so three failure modes that an interactive session would
# just prompt through instead need to abort LOUDLY and DISTINCTLY, before claude is ever exec'd:
# missing node, an unregistered/unhealthy `linear` MCP server, and (not a failure) an empty-input
# day. This probe builds an ISOLATED scratch world (a fake HOME, a fake `claude` binary that
# answers both `mcp list` and `-p ...`, and a fake read-errors-since.mjs) and asserts, against the
# real runner script, that:
#
#   - claude binary missing/non-executable          → ABORT (exit 127), claude never invoked.
#   - `claude mcp list` itself exits non-zero        → ABORT (exit 3), named line.
#   - no "linear" line in `claude mcp list`          → ABORT (exit 4), fix line names --scope user.
#   - a "linear" line reporting an error/expired tok → ABORT (exit 5), fix line names `mcp login`.
#   - linear healthy + zero new errors               → SKIP (exit 0), claude -p never invoked.
#   - linear healthy + new errors present            → execs `claude -p "/harvest-pipeline-bugs --yes"`
#     from $HOME/.claude, with node's directory prepended onto PATH.
#   - every ABORT/SKIP path leaves a pre-existing watermark file byte-for-byte untouched.
#
# Usage:  bash ~/.claude/bin/harvest-pipeline-bugs-runner.test.sh   (exit 0 = all pass)
# Invoked by /verify-tests as executable coverage for this ticket.

set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$BIN/harvest-pipeline-bugs-runner.sh"
PASS=0
FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/harvest-runner-test.XXXXXX")"
SCRATCH="$(cd "$SCRATCH" && pwd -P)"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

REAL_NODE="$(command -v node)"
if [ -z "$REAL_NODE" ]; then
  echo "SKIP: no node on PATH — cannot exercise the runner's node-dependent preflight"
  exit 0
fi
NODE_DIR="$(dirname "$REAL_NODE")"

FAKE_HOME="$SCRATCH/home"
mkdir -p "$FAKE_HOME/.local/bin" "$FAKE_HOME/.claude/bin" "$FAKE_HOME/.claude/pipeline/audit"
INVOKE_LOG="$SCRATCH/invocations.log"
MCP_OUT="$SCRATCH/mcp-list-output.txt"
MCP_RC_FILE="$SCRATCH/mcp-list-rc.txt"

# Fake `claude`: `mcp list` answers from $MCP_OUT/$MCP_RC_FILE (test controls per-scenario); any
# other invocation (the -p exec) records "<cwd>\t<PATH>\t<args>" then exits 0.
cat > "$FAKE_HOME/.local/bin/claude" <<FAKE
#!/usr/bin/env bash
if [ "\$1" = "mcp" ] && [ "\$2" = "list" ]; then
  cat "$MCP_OUT" 2>/dev/null
  exit "\$(cat "$MCP_RC_FILE" 2>/dev/null || echo 0)"
fi
printf '%s\t%s\t%s\n' "\$PWD" "\$PATH" "\$*" >> "$INVOKE_LOG"
exit 0
FAKE
chmod +x "$FAKE_HOME/.local/bin/claude"

# Fake read-errors-since.mjs: cats whatever this scratch's errors.jsonl currently holds — the
# runner's own §1/§7 date-cutoff logic is read-errors-since's own concern (covered by its own
# test); this probe only needs to control "zero lines" vs "some lines" for the runner's count gate.
cat > "$FAKE_HOME/.claude/bin/read-errors-since.mjs" <<'STUB'
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const p = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "errors.jsonl");
if (existsSync(p)) process.stdout.write(readFileSync(p, "utf8"));
STUB

WATERMARK="$FAKE_HOME/.claude/pipeline/audit/.harvest-watermark"
ERRORS_LOG="$FAKE_HOME/.claude/pipeline/audit/errors.jsonl"

reset_scenario() {
  : > "$INVOKE_LOG"
  echo "2026-01-01T00:00:00.000Z" > "$WATERMARK"
  : > "$ERRORS_LOG"
}

run_runner() {
  PATH="$NODE_DIR:/usr/bin:/bin" HOME="$FAKE_HOME" bash "$RUNNER" 2>&1
}

watermark_untouched() {
  [ "$(cat "$WATERMARK")" = "2026-01-01T00:00:00.000Z" ]
}

echo "== harvest-pipeline-bugs-runner.test =="

# ---------- claude binary missing ----------
reset_scenario
mv "$FAKE_HOME/.local/bin/claude" "$FAKE_HOME/.local/bin/claude.bak"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 127 ] && ok "missing claude binary aborts exit 127" || bad "missing claude binary: rc=$RC (want 127)"
echo "$OUT" | grep -qF "claude binary not executable" && ok "missing-claude line named" || bad "missing-claude line missing"
[ -s "$INVOKE_LOG" ] && bad "claude was invoked despite missing binary" || ok "claude never invoked when missing"
watermark_untouched && ok "watermark untouched (missing claude)" || bad "watermark touched (missing claude)"
mv "$FAKE_HOME/.local/bin/claude.bak" "$FAKE_HOME/.local/bin/claude"

# ---------- `claude mcp list` itself fails ----------
reset_scenario
echo "internal error" > "$MCP_OUT"; echo 1 > "$MCP_RC_FILE"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 3 ] && ok "mcp-list failure aborts exit 3" || bad "mcp-list failure: rc=$RC (want 3)"
echo "$OUT" | grep -qF "\`claude mcp list\` failed" && ok "mcp-list-failed line named" || bad "mcp-list-failed line missing"
[ -s "$INVOKE_LOG" ] && bad "claude -p invoked despite mcp-list failure" || ok "claude -p never invoked (mcp-list failure)"
watermark_untouched && ok "watermark untouched (mcp-list failure)" || bad "watermark touched (mcp-list failure)"

# ---------- linear not registered ----------
reset_scenario
echo "no servers configured" > "$MCP_OUT"; echo 0 > "$MCP_RC_FILE"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 4 ] && ok "unregistered linear aborts exit 4" || bad "unregistered linear: rc=$RC (want 4)"
echo "$OUT" | grep -qF "no \"linear\" MCP server registered" && ok "unregistered-linear line named" || bad "unregistered-linear line missing"
echo "$OUT" | grep -qF -- "--scope user" && ok "fix line recommends --scope user" || bad "fix line missing --scope user"
[ -s "$INVOKE_LOG" ] && bad "claude -p invoked despite unregistered linear" || ok "claude -p never invoked (unregistered linear)"
watermark_untouched && ok "watermark untouched (unregistered linear)" || bad "watermark touched (unregistered linear)"

# ---------- linear registered but erroring (expired OAuth) ----------
reset_scenario
echo "linear   http   https://mcp.linear.app/mcp   failed: token expired" > "$MCP_OUT"; echo 0 > "$MCP_RC_FILE"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 5 ] && ok "erroring linear aborts exit 5" || bad "erroring linear: rc=$RC (want 5)"
echo "$OUT" | grep -qF "reporting an error" && ok "erroring-linear line named" || bad "erroring-linear line missing"
echo "$OUT" | grep -qF "mcp login linear" && ok "fix line recommends mcp login" || bad "fix line missing mcp login"
[ -s "$INVOKE_LOG" ] && bad "claude -p invoked despite erroring linear" || ok "claude -p never invoked (erroring linear)"
watermark_untouched && ok "watermark untouched (erroring linear)" || bad "watermark touched (erroring linear)"

# ---------- linear healthy, zero new errors: SKIP, no claude -p ----------
reset_scenario
echo "linear   http   https://mcp.linear.app/mcp   connected" > "$MCP_OUT"; echo 0 > "$MCP_RC_FILE"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 0 ] && ok "empty-input day exits 0" || bad "empty-input day: rc=$RC (want 0)"
echo "$OUT" | grep -qF "harvest SKIP" && ok "empty-input SKIP line named" || bad "empty-input SKIP line missing"
[ -s "$INVOKE_LOG" ] && bad "claude -p invoked on an empty-input day" || ok "claude -p never invoked (empty input)"
watermark_untouched && ok "watermark untouched (empty input)" || bad "watermark touched (empty input)"

# ---------- linear healthy, new errors present: execs claude -p ----------
reset_scenario
echo "linear   http   https://mcp.linear.app/mcp   connected" > "$MCP_OUT"; echo 0 > "$MCP_RC_FILE"
echo '{"ts":"2026-06-06T00:00:00.000Z","tool":"Bash","error":"boom"}' > "$ERRORS_LOG"
OUT="$(run_runner)"; RC=$?
[ "$RC" -eq 0 ] && ok "happy path exits 0" || bad "happy path: rc=$RC (want 0)"
grep -qF "$FAKE_HOME/.claude" "$INVOKE_LOG" && ok "claude -p invoked from \$HOME/.claude" || bad "claude -p not invoked from the right cwd"
grep -qF "/harvest-pipeline-bugs --yes" "$INVOKE_LOG" && ok "invoked with the expected command" || bad "wrong command invoked"
grep -qF "$NODE_DIR" "$INVOKE_LOG" && ok "node's directory is on PATH for the exec'd claude" || bad "node's directory missing from PATH"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
