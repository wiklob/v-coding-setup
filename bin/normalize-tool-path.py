#!/usr/bin/env python3
"""PreToolUse path normalizer — de-escape backslash-escaped shell metacharacters in a
tool's `file_path` (Read/Edit/Write/MultiEdit) so a shell-escaped literal path no longer
fails `File does not exist`.

Why this exists (V-277): agents reflexively shell-escape shell metacharacters in tool
paths — most often Next.js route-group / dynamic-segment dirs `(app)` / `[id]`, written
as `\\(app\\)` / `\\[id\\]`. Tool `file_path` values are LITERAL (no shell de-escaping),
so the escaped path misses the real file and the Read fails `File does not exist`, often
with blind retries. V-189 (PR #190) added a CLAUDE.md footgun note; it kept recurring 10x
the day after land — the doc note alone did not stop it — so this is the mechanical guard
V-249 owed.

Mechanism: a PreToolUse hook can rewrite tool input by emitting
`hookSpecificOutput.updatedInput` alongside `permissionDecision: "allow"` — the tool then
runs with the corrected path, transparently, no model retry.

Correctness — rewrite ONLY when it provably helps and cannot corrupt a real path:
  * de-escape only backslash-escaped SHELL METACHARACTERS, never arbitrary `\\x`;
  * rewrite only when the as-given path does NOT exist AND the de-escaped path DOES
    (for a Write of a new file: the de-escaped PARENT dir exists and the as-given parent
    does not). So a file legitimately containing a backslash (it resolves as given) is
    never touched, and a genuinely-missing path is left to fail normally.
Scope: never touches Bash — shell escaping there is CORRECT — the matcher excludes it.

Safety: FAILS OPEN. Any parse/logic error -> exit 0 (allow, no output). This is a
convenience normalizer layered under the real permission controls — guard-sensitive-access.py
runs as a separate PreToolUse hook that receives the ORIGINAL input independently (hooks
do not chain, so this rewrite never reaches it) and its deny wins, so an escaped secret
path is blocked regardless of this hook — never a gate; a bug here must not be able to
brick Read/Edit/Write.
"""
import sys, os, json, re

# Backslash-escaped shell metacharacters an agent wrongly carries into a literal tool path.
# Next.js route dirs `(group)` and `[param]` are the dominant case; the rest are the POSIX
# shell-metacharacter set that is legal in a path and so gets reflexively escaped.
_META = r"()[]{}$&;|<>*?!#'\"` ~"
_ESCAPED_META = re.compile(r"\\([" + re.escape(_META) + r"])")


def deescape(p):
    return _ESCAPED_META.sub(r"\1", p)


def allow_noop():
    sys.exit(0)


def rewrite(ti, key, new_path):
    new_input = dict(ti)
    new_input[key] = new_path
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason":
            "normalized backslash-escaped shell metacharacters in path -> "
            + new_path + " (V-277)",
        "updatedInput": new_input,
    }}) + "\n")
    sys.exit(0)


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    tool = event.get("tool_name", "")
    if tool not in ("Read", "Edit", "Write", "MultiEdit"):
        allow_noop()
    ti = event.get("tool_input", {}) or {}
    key = "file_path" if "file_path" in ti else ("path" if "path" in ti else None)
    if key is None:
        allow_noop()
    p = ti.get(key, "")
    if not isinstance(p, str) or "\\" not in p:
        allow_noop()                       # no backslash -> nothing to de-escape
    d = deescape(p)
    if d == p:
        allow_noop()                       # backslash present but not before a shell metachar
    if os.path.lexists(p):
        allow_noop()                       # the as-given path is real -> never touch it
    if os.path.lexists(d):
        rewrite(ti, key, d)                # Read/Edit/MultiEdit, or Write-to-existing
    if tool == "Write":                    # Write a NEW file into an existing de-escaped dir
        dp, pp = os.path.dirname(d), os.path.dirname(p)
        if dp and os.path.isdir(dp) and not os.path.lexists(pp):
            rewrite(ti, key, d)
    allow_noop()                           # genuinely missing -> let the tool error normally


try:
    run()
except SystemExit:
    raise                                  # allow_noop()/rewrite() must propagate
except Exception:
    sys.exit(0)                            # FAIL OPEN — never brick Read/Edit/Write
