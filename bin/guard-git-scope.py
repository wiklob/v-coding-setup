#!/usr/bin/env python3
"""PreToolUse Bash guard — block a bare `git commit` / `git add -A` (or --all)
when it resolves to the live `~/.claude` checkout, instead of a ticket worktree.

Why this exists (V-672): the pipeline's own contract is "all pipeline work
branches from origin/main and lands on main" via a per-ticket worktree — never
directly against the live checkout at ~/.claude. A session that drifts back to
~/.claude's cwd (a stale `cd`, a relative path guess that happened to land there)
and then runs a bare `git commit` or `git add -A` commits straight onto whatever
is checked out there, silently bypassing the worktree-per-ticket isolation the
rest of the pipeline assumes. `git commit`/`git add -A` with no explicit
`-C`/`--git-dir`/`--work-tree` inherits the session's cwd, so the drift is
invisible in the command text itself — this guard resolves the ACTUAL toplevel
the bare invocation would hit and blocks when that toplevel is the live checkout.

Scope — deliberately narrow:
  * only fires on `git commit` (any form: `-m`, `--amend`, no args, etc.) and
    `git add -A` / `git add --all` (the two operations that mutate the repo
    state most consequentially) issued WITHOUT an explicit `-C <path>`,
    `--git-dir=...`, or `--work-tree=...` on that same `git` invocation —
    those are a deliberate, explicit scope, not the "drifted bare cwd" trap
    this guard targets, so they're left alone (an explicit `-C ~/.claude` is
    still allowed);
  * resolves the session's cwd (from the hook event) to its git toplevel via
    `git -C <cwd> rev-parse --show-toplevel`, realpath's both sides, and
    blocks only when they match the live checkout at ~/.claude — any other
    toplevel (a ticket worktree, an unrelated repo) is unaffected.

Safety: FAILS OPEN. Any parse/subprocess/logic error -> exit 0 (allow, no
output) — this must never brick Bash for an unrelated repo or command.
"""
import sys, json, re, shlex, subprocess, os


def allow():
    sys.exit(0)


def block(segment, toplevel):
    sys.stderr.write(
        "BLOCKED by git-scope guard: this bare `git commit`/`git add -A` would "
        "run against " + toplevel + " — the live pipeline checkout, not a "
        "ticket worktree.\n"
        "Command: " + segment + "\n"
        "Pipeline work lands via a per-ticket worktree, never a direct commit "
        "against the live checkout. Either `cd` into your ticket worktree first, "
        "or pass `-C <worktree-path>` explicitly on this git invocation.\n"
        "See ~/.claude/CLAUDE.md, \"Two checkouts, one repo\".\n")
    sys.exit(2)


_SEGMENT_SPLIT = re.compile(r"[;&|\n]+|\b(?:&&|\|\|)\b")
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

_SCOPE_FLAG = re.compile(r"^(-C|--git-dir(=.*)?|--work-tree(=.*)?)$")


def tokenize(segment):
    try:
        return shlex.split(segment, comments=False, posix=True)
    except ValueError:
        return None


def is_bare_scoped_git_mutation(tokens):
    """Return True if tokens is a `git commit` or `git add -A`/`--all`
    invocation with no explicit -C/--git-dir/--work-tree scoping flag."""
    idx = 0
    while idx < len(tokens) and _ASSIGNMENT.match(tokens[idx]):
        idx += 1
    if idx >= len(tokens) or tokens[idx] != "git":
        return False
    rest = tokens[idx + 1:]
    # An explicit scope flag anywhere on the invocation is the deliberate
    # escape hatch — never block it.
    for t in rest:
        if _SCOPE_FLAG.match(t) or t == "-C":
            return False
    # Find the subcommand (first token not starting with '-').
    sub = None
    sub_pos = None
    for i, t in enumerate(rest):
        if not t.startswith("-"):
            sub = t
            sub_pos = i
            break
    if sub == "commit":
        return True
    if sub == "add":
        args = rest[sub_pos + 1:]
        return "-A" in args or "--all" in args
    return False


def resolve_toplevel(cwd):
    if not cwd:
        return None
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    path = out.stdout.strip()
    if not path:
        return None
    return os.path.realpath(path)


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    if event.get("tool_name", "") != "Bash":
        allow()
    ti = event.get("tool_input", {}) or {}
    cmd = ti.get("command", "")
    if not isinstance(cmd, str) or "git" not in cmd:
        allow()

    live_checkout = os.path.realpath(os.path.expanduser("~/.claude"))

    for segment in _SEGMENT_SPLIT.split(cmd):
        segment = segment.strip()
        if not segment or "git" not in segment:
            continue
        tokens = tokenize(segment)
        if not tokens:
            continue
        if not is_bare_scoped_git_mutation(tokens):
            continue
        cwd = event.get("cwd")
        toplevel = resolve_toplevel(cwd)
        if toplevel is not None and toplevel == live_checkout:
            block(segment, toplevel)
    allow()


try:
    run()
except SystemExit:
    raise
except Exception:
    sys.exit(0)
