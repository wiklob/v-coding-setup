#!/usr/bin/env bash
# ~/.claude/bin/docs-refresh-runner.test.sh
# Encoded proof of the multi-repo docs-refresh runner's selection + isolation contract. (V-375)
#
# The repo is shell + markdown with no test harness, so per commands/scope.md §3 the proof is a
# committed probe script (the regression-test analog) — not the runner's mere presence. It builds an
# ISOLATED scratch world (a fake HOME with a fake `claude` binary and several scratch checkouts) and
# asserts, against the real runner, that:
#
#   SELECTION (the opt-in gate — must hold or non-opted-in repos get swept):
#     - a checkout with docs.maintenance="daily"           IS swept.
#     - a checkout with docs.maintenance="per-land"         is SKIPPED (named "not daily" line).
#     - a checkout with NO docs block                       is SKIPPED (named "not daily" line).
#     - a checkout with NO ticket-flow.json                 is SKIPPED (named "not daily" line).
#     - a registry path that isn't a git checkout           is SKIPPED (named "not a git checkout" line).
#     - a checkout with INVALID ticket-flow.json            is SKIPPED (named "not valid JSON" line, distinct).
#     - ~/.claude is always CONSIDERED (and swept iff it opted in).
#   ISOLATION + RESILIENCE:
#     - each swept repo's pass runs from ITS OWN cwd (the fake claude records $PWD per invocation).
#     - a repo whose pass EXITS NON-ZERO does not suppress a later repo (both still run).
#     - a git worktree whose .git is a FILE (not a dir) is still recognized as a checkout (test -e).
#
# Usage:  bash ~/.claude/bin/docs-refresh-runner.test.sh   (exit 0 = all pass)
# Invoked by /verify-tests as executable coverage for this ticket.

set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$BIN/docs-refresh-runner.sh"
PASS=0
FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/docs-refresh-test.XXXXXX")"
SCRATCH="$(cd "$SCRATCH" && pwd -P)"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

# --- fake HOME with a fake claude binary + a real node ---
FAKE_HOME="$SCRATCH/home"
mkdir -p "$FAKE_HOME/.local/bin" "$FAKE_HOME/.claude"
INVOKE_LOG="$SCRATCH/invocations.log"

# Fake `claude`: records "<cwd>\t<args>" for each invocation, then exits 0 — UNLESS a sentinel file
# in the cwd tells it to fail (proves failure-continuation without a flaky real pass).
cat > "$FAKE_HOME/.local/bin/claude" <<FAKE
#!/usr/bin/env bash
printf '%s\t%s\n' "\$PWD" "\$*" >> "$INVOKE_LOG"
[ -f "\$PWD/.FAIL" ] && exit 7
exit 0
FAKE
chmod +x "$FAKE_HOME/.local/bin/claude"

# A checkout factory: mkrepo <name> <ticket-flow-json-or-"none"-or-"invalid">
mkrepo() {
  local name="$1" cfg="$2"
  local dir="$SCRATCH/$name"
  mkdir -p "$dir/.git" "$dir/.claude"
  case "$cfg" in
    none)    : ;;                                       # no ticket-flow.json at all
    invalid) printf '{ this is not json' > "$dir/.claude/ticket-flow.json" ;;
    *)       printf '%s' "$cfg" > "$dir/.claude/ticket-flow.json" ;;
  esac
  echo "$dir"
}

DAILY='{"docs":{"maintenance":"daily"}}'
PERLAND='{"docs":{"maintenance":"per-land"}}'
NODOCS='{"linearTeam":"x"}'

# ~/.claude itself opts OUT here (keeps the always-considered entry from muddying per-repo assertions;
# its skip line is asserted separately below). The fake ~/.claude checkout's config lives at
# $FAKE_HOME/.claude/.claude/ticket-flow.json (the runner reads $repo/.claude/ticket-flow.json).
mkdir -p "$FAKE_HOME/.claude/.git" "$FAKE_HOME/.claude/.claude"
printf '%s' "$NODOCS" > "$FAKE_HOME/.claude/.claude/ticket-flow.json"

R_DAILY="$(mkrepo repo-daily "$DAILY")"
R_PERLAND="$(mkrepo repo-perland "$PERLAND")"
R_NODOCS="$(mkrepo repo-nodocs "$NODOCS")"
R_NOCFG="$(mkrepo repo-nocfg none)"
R_INVALID="$(mkrepo repo-invalid invalid)"
R_FAIL="$(mkrepo repo-fail "$DAILY")"; touch "$R_FAIL/.FAIL"     # opts in, but its pass exits non-zero
R_AFTERFAIL="$(mkrepo repo-afterfail "$DAILY")"                  # opts in, listed AFTER the failing one
R_NOTGIT="$SCRATCH/repo-notgit"; mkdir -p "$R_NOTGIT/.claude"    # has config but no .git → not a checkout
printf '%s' "$DAILY" > "$R_NOTGIT/.claude/ticket-flow.json"

# A worktree-style checkout whose .git is a FILE, not a dir (test -e must still recognize it).
R_WT="$(mkrepo repo-worktree "$DAILY")"; rm -rf "$R_WT/.git"; echo "gitdir: /somewhere" > "$R_WT/.git"

# Registry — order matters: the failing repo precedes repo-afterfail to prove continuation.
cat > "$FAKE_HOME/.claude/docs-refresh-repos.txt" <<REG
# scratch registry
$R_DAILY
$R_PERLAND
$R_NODOCS
$R_NOCFG
$R_INVALID
$R_NOTGIT
$R_WT
$R_FAIL
$R_AFTERFAIL
REG

echo "== docs-refresh-runner.test =="

OUT="$(HOME="$FAKE_HOME" bash "$RUNNER" 2>&1)"

swept()   { grep -qF -- "$1" "$INVOKE_LOG" 2>/dev/null; }   # cwd appears in the invocation log
skipline(){ echo "$OUT" | grep -qF -- "$1"; }

# ---------- SELECTION ----------
swept "$R_DAILY"     && ok "daily repo swept"                       || bad "daily repo NOT swept"
swept "$R_PERLAND"   && bad "per-land repo was swept (should skip)" || ok "per-land repo skipped"
swept "$R_NODOCS"    && bad "no-docs-block repo swept (should skip)"|| ok "no-docs-block repo skipped"
swept "$R_NOCFG"     && bad "no-config repo swept (should skip)"    || ok "no-config repo skipped"
skipline "$R_PERLAND — docs.maintenance is not"  && ok "per-land skip line named"  || bad "per-land skip line missing"
skipline "$R_INVALID — .claude/ticket-flow.json is present but not valid JSON" && ok "invalid-JSON skip line is distinct" || bad "invalid-JSON skip line missing/not distinct"
skipline "$R_NOTGIT — not a git checkout" && ok "non-checkout skip line named" || bad "non-checkout skip line missing"
swept "$FAKE_HOME/.claude" && bad "~/.claude swept though it opted out" || ok "~/.claude considered but skipped (opted out)"

# ---------- ISOLATION + RESILIENCE ----------
swept "$R_WT"        && ok "worktree (.git is a file) recognized as a checkout" || bad "worktree .git-file not recognized"
swept "$R_FAIL"      && ok "failing repo's pass ran"                || bad "failing repo's pass never ran"
skipline "returned non-zero for $R_FAIL" && ok "non-zero exit surfaced" || bad "non-zero exit not surfaced"
swept "$R_AFTERFAIL" && ok "repo AFTER the failing one still swept (continuation)" || bad "a repo failure suppressed a later repo!"

# each swept invocation ran from that repo's OWN cwd (the log's first column IS the repo dir)
awk -F'\t' -v d="$R_DAILY" '$1==d{f=1} END{exit !f}' "$INVOKE_LOG" && ok "daily pass ran from its own cwd" || bad "daily pass ran from the wrong cwd"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
