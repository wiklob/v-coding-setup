#!/usr/bin/env python3
"""PreToolUse Bash guard — refuse a bare `grep` invocation and suggest the `rg`
equivalent, before the command ever reaches the shell's ugrep binary.

Why this exists (V-683): on this machine inline `grep` resolves to **ugrep**, not
GNU grep — it rejects `find`-style `! -path` exclusions and empty/brace alternation
branches GNU grep tolerates, so a model-written `grep` command that would work
against GNU grep dies with a cryptic ugrep-specific error (`empty (sub)expression`,
`!: No such file or directory`) instead of running. CLAUDE.md already tells the
model to prefer `rg`, but the doc note alone does not stop the recurring footgun
(same lesson as V-277/V-337) — this is the mechanical guard.

Mechanism: a PreToolUse hook can either rewrite tool input or hard-block (exit 2
with a stderr reason). A silent rewrite is NOT safe here — ugrep and `rg` accept
different flag surfaces (e.g. `-P`, `-z`, `--include` glob syntax), so mechanically
substituting `grep` -> `rg` in place risks silently changing what the command
matches. Refusing is louder but safe: the model gets an actionable equivalent and
rewrites its own call.

Scope — deliberately narrow, so it never blocks something other than a literal bare
`grep` invocation:
  * fires only when `grep` is the COMMAND itself (first token of a shell segment,
    after skipping any leading `VAR=value` assignments) — never when `grep` is an
    argument to another command, appears inside a quoted string, or is part of a
    longer token (`grepper`, `zgrep`);
  * an explicit escape hatch is always available and never touched: a full path
    (`/usr/bin/grep`, `/opt/homebrew/bin/grep`) or `command grep` — both put a
    non-`grep` token in the first-token position, so they pass through unblocked.

Safety: FAILS OPEN. Any parse/logic error -> exit 0 (allow, no output). Layered
alongside guard-sensitive-access.py, which receives the ORIGINAL input
independently (hooks don't chain) — this guard only ever adds a refusal, never
removes one.
"""
import sys, json, re, shlex


def allow():
    sys.exit(0)


def block(segment, suggestion):
    sys.stderr.write(
        "BLOCKED by grep guard: `grep` here resolves to ugrep, not GNU grep — it "
        "rejects syntax GNU grep tolerates (find-style `! -path` exclusions, empty "
        "or brace alternation branches). Use `rg` instead:\n"
        "  " + suggestion + "\n"
        "If you genuinely need the ugrep/GNU grep binary itself, escape this guard "
        "with a full path (e.g. /usr/bin/grep) or `command grep`.\n"
        "See ~/.claude/CLAUDE.md, \"Searching: grep here is ugrep, not GNU grep\".\n")
    sys.exit(2)


# Shell-separator tokens that start a new command segment.
_SEGMENT_SPLIT = re.compile(r"[;&|\n]+|\b(?:&&|\|\|)\b")
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def first_command_token(segment):
    """Return the first real command token in a segment, skipping leading
    `VAR=value` env assignments and shell grouping punctuation. Returns None if
    the segment can't be tokenized (unbalanced quotes etc.) — caller must
    fail open on None."""
    try:
        tokens = shlex.split(segment, comments=False, posix=True)
    except ValueError:
        return None
    for tok in tokens:
        tok = tok.strip("(){}")
        if not tok:
            continue
        if _ASSIGNMENT.match(tok):
            continue
        return tok
    return None


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    if event.get("tool_name", "") != "Bash":
        allow()
    ti = event.get("tool_input", {}) or {}
    cmd = ti.get("command", "")
    if not isinstance(cmd, str) or "grep" not in cmd:
        allow()                          # cheap pre-filter
    for segment in _SEGMENT_SPLIT.split(cmd):
        segment = segment.strip()
        if not segment:
            continue
        tok = first_command_token(segment)
        if tok != "grep":
            continue                     # not a bare `grep` command position
        suggestion = re.sub(r"(^|[\s])grep\b", r"\1rg", segment, count=1)
        block(segment, suggestion)
    allow()


try:
    run()
except SystemExit:
    raise                                # allow()/block() must propagate
except Exception:
    sys.exit(0)                          # FAIL OPEN — never brick Bash
