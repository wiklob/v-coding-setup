#!/usr/bin/env bash
# docs-refresh-runner.sh — the command the launchd agent execs for the daily docs-maintenance pass. (V-284, multi-repo in V-375)
#
# WHY A WRAPPER (not `claude` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (claude binary missing, wrong PATH, HOME unset) would leave the log
#   empty and indistinguishable from "never fired". This wrapper emits a dated HEARTBEAT line to
#   stdout FIRST (→ docs-refresh.log via the plist's StandardOutPath), proving the agent fired
#   even if the per-repo passes then die. A sibling of git-hygiene-runner.sh (V-282), retargeted
#   to /docs-refresh.
#
# WHY MULTI-REPO (V-375): /docs-refresh is a per-repo maintenance pass — it reads ONE checkout's
#   git history + working tree and opens ONE consolidated daily PR for that repo. A single machine
#   can host several checkouts that each opt into `docs.maintenance: "daily"` (this pipeline repo,
#   plus e.g. a product app). So this ONE machine-global agent sweeps a REGISTRY of checkouts,
#   runs the pass only in the ones that opted in, and keeps going if one repo fails — rather than
#   installing a separate agent per repo. Mirrors git-hygiene-runner.sh's registry loop, plus a
#   `docs.maintenance == "daily"` opt-in filter (the one piece git-hygiene doesn't need).
#
# REPOS: the list of checkouts to consider. `~/.claude` is always considered; per-machine extras
#   come from ~/.claude/docs-refresh-repos.txt (one ABSOLUTE path per line, `#` comments allowed).
#   Each entry is filtered three ways before the pass runs, every skip surfaced with a named line:
#     - not a git checkout on this machine (`[ -e "$r/.git" ]` fails — a worktree's .git is a FILE,
#       so test -e, not -d) → silent-safe skip, never a failure (the helper is repo-agnostic and
#       "works for repo X" is verified live per-machine, not asserted here; convention 8).
#     - no `.claude/ticket-flow.json`, or it isn't valid JSON → skip (can't tell if it opted in).
#     - `docs.maintenance` is not exactly "daily" → skip (opt-in gate; a "per-land" repo does its
#       doc work at land time and must NOT be swept here — convention 6).
#   An eligible repo runs `/docs-refresh --yes` from ITS OWN cwd (a subshell, so cwd never leaks
#   to the next repo), and a non-zero exit is surfaced and tolerated so later repos still run.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.docs-refresh.plist (see
#   bin/install-docs-refresh-launchd.sh), which routes stdout/stderr to docs-refresh.log. Run by hand
#   the output goes to your TERMINAL, not the log (the plist owns that redirect) — so to verify the
#   log path, install the agent and `launchctl kickstart` it.

set -uo pipefail

CLAUDE_BIN="$HOME/.local/bin/claude"   # stable symlink — the versioned target changes on update.
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
TS() { date -u +%FT%TZ; }

echo "=== docs-refresh fired $(TS) (pid $$) ==="

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "=== docs-refresh ABORT $(TS): claude binary not executable at $CLAUDE_BIN ==="
  exit 127
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "=== docs-refresh ABORT $(TS): node not executable at $NODE_BIN (needed for the opt-in filter) ==="
  exit 127
fi

# The checkouts to consider. The pipeline checkout is always considered; per-machine extras come
# from the optional registry file (absent file = no extras; every entry is filtered below).
REPOS=("$HOME/.claude")
REPOS_CONF="$HOME/.claude/docs-refresh-repos.txt"
if [ -f "$REPOS_CONF" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    REPOS+=("$line")
  done < "$REPOS_CONF"
fi

# opted_in_daily <repo> — exit 0 iff <repo>/.claude/ticket-flow.json parses and its
#   docs.maintenance === "daily". A node one-liner (not grep/jq): the value can be nested, quoted,
#   or absent, and node is already a hard dependency of the pass. Exit 3 = not daily / no config;
#   exit 4 = present but unparseable (surfaced distinctly so a broken config isn't read as opt-out).
opted_in_daily() {
  "$NODE_BIN" -e '
    const fs = require("fs");
    const p = process.argv[1] + "/.claude/ticket-flow.json";
    let raw;
    try { raw = fs.readFileSync(p, "utf8"); } catch { process.exit(3); }   // no config → not opted in
    let cfg;
    try { cfg = JSON.parse(raw); } catch { process.exit(4); }              // invalid JSON → surface distinctly
    process.exit(cfg && cfg.docs && cfg.docs.maintenance === "daily" ? 0 : 3);
  ' "$1"
}

for repo in "${REPOS[@]}"; do
  if [ ! -e "$repo/.git" ]; then
    echo "--- skip $repo — not a git checkout on this machine ---"
    continue
  fi
  opted_in_daily "$repo"; rc=$?
  case "$rc" in
    0) : ;;  # opted in — fall through to the pass
    4) echo "--- skip $repo — .claude/ticket-flow.json is present but not valid JSON ---"; continue ;;
    *) echo "--- skip $repo — docs.maintenance is not \"daily\" (not opted in) ---"; continue ;;
  esac

  echo "--- docs-refresh sweeping $repo ---"
  # Run the pass from the repo's OWN cwd in a subshell so cwd + sourced env never leak to the next
  # repo. Each repo's .envrc carries its own secrets (the MCP linear Bearer token, V-156); load it
  # here so the bg pass doesn't 401. A non-zero exit is surfaced and tolerated (set -uo pipefail,
  # no set -e) so a failure in one repo never suppresses the rest.
  (
    cd "$repo" || exit 1
    set -a; [ -f "$repo/.envrc" ] && . "$repo/.envrc"; set +a
    exec "$CLAUDE_BIN" -p "/docs-refresh --yes"
  ) || echo "--- docs-refresh returned non-zero for $repo (surfaced, continuing) ---"
done

echo "=== docs-refresh done $(TS) ==="
