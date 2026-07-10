#!/usr/bin/env python3
"""PreToolUse Bash guard — rewrite a `cd` into the slug-derived, nonexistent repo
checkout path into the REAL checkout, so `cd ~/myrepo && gh pr view …` stops
failing `no such file or directory`.

Why this exists (V-337): pipeline command sessions repeatedly IMPROVISE bash that
`cd`s into `$HOME/<repo-name>` derived from the GitHub slug (ticket-flow `repo:
"alice/myrepo"` -> `~/myrepo`), but the repo's actual checkout can live elsewhere
(checkout basename != repo name). The `cd` fails and the chained
`gh pr view` / `git` never runs. Observed 3x over 2026-07-04..05 across
/resume-ticket, /land-ticket, /go. The V-74 source-scan guard
(check-no-hardcoded-repo-cd.sh) and root-CLAUDE.md's authoring note CANNOT catch
this: the bad `cd` is never in the command-file TEXT — the model writes it at
runtime. Same lesson as V-277 (normalize-tool-path.py): a doc note did not stop a
recurring footgun, so this is the mechanical guard.

Mechanism (mirrors normalize-tool-path.py): a PreToolUse hook rewrites tool input
by emitting hookSpecificOutput.updatedInput with permissionDecision "allow" — the
Bash tool then runs the corrected command transparently, no model retry.

Correctness — rewrite ONLY when it provably helps and cannot corrupt a real path:
  * fire only on a `cd` whose target is EXACTLY the slug-derived path
    ($HOME/<basename of the ticket-flow `repo` slug>), bounded so a longer sibling
    (~/myrepo-extras) never matches;
  * that path is DERIVED from config, never a magic constant, and rewritten only
    when it DOES NOT EXIST on disk AND DIFFERS from the real checkout — so a repo
    whose checkout basename == its name (the derived path exists / equals root) is
    never touched;
  * replace only that `cd` target with the real checkout root (resolved from this
    hook's own location — bin/ sits directly under the checkout, so it is correct
    from any cwd and guaranteed to exist), preserving the rest of the command
    verbatim.

Safety: FAILS OPEN. Any parse/logic error -> exit 0 (allow, no output). Layered
under guard-secret-access.py, which receives the ORIGINAL input independently
(hooks don't chain) and whose deny/ask wins — so this rewrite can never weaken a
secret/prod-mutation block.
"""
import sys, os, json, re


def allow_noop():
    sys.exit(0)


def rewrite(ti, new_cmd, bad, good):
    new_input = dict(ti)
    new_input["command"] = new_cmd
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason":
            "rewrote `cd " + bad + "` (slug-derived, nonexistent) -> `cd " + good
            + "` (the real checkout — basename differs from the repo name) (V-337)",
        "updatedInput": new_input,
    }}) + "\n")
    sys.exit(0)


def repo_root():
    # bin/ sits directly under the checkout root; derived from this file's location,
    # so it is correct from any cwd and guaranteed to exist (the hook ran from it).
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slug_derived_bad_path(root):
    # $HOME/<basename of the ticket-flow `repo` slug>, e.g. alice/myrepo -> ~/myrepo.
    cfg = os.path.join(root, ".claude", "ticket-flow.json")
    with open(cfg) as f:
        repo = json.load(f).get("repo", "")
    name = repo.split("/")[-1].strip()
    if not name:
        return None
    return os.path.join(os.path.expanduser("~"), name)


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    if event.get("tool_name", "") != "Bash":
        allow_noop()
    ti = event.get("tool_input", {}) or {}
    cmd = ti.get("command", "")
    home = os.path.expanduser("~")
    # Cheap pre-filter: only commands that `cd` somewhere under $HOME can be affected.
    if not isinstance(cmd, str) or "cd " not in cmd or home not in cmd:
        allow_noop()
    root = repo_root()
    bad = slug_derived_bad_path(root)
    if not bad or bad == root:
        allow_noop()                 # checkout basename == repo name -> nothing to fix
    if os.path.lexists(bad):
        allow_noop()                 # the derived path actually exists -> never touch it
    # Match a `cd` whose target is EXACTLY `bad`, optionally quoted, bounded so a
    # longer sibling (…/videos) never matches. `cd` must sit at a COMMAND position —
    # start of string, or right after a shell separator (`; & | ( { newline`) — so
    # `cd` appearing as an argument or inside a string (`echo cd …`, a commit
    # message `-m "fix cd ~/myrepo"`) is never rewritten.
    q = re.escape(bad)
    pat = re.compile(
        r"(^|[;&|\n({])(\s*)cd(\s+)([\"']?)" + q + r"([\"']?)(?=[\s\"'&|;)]|$)")
    if not pat.search(cmd):
        allow_noop()
    new_cmd = pat.sub(
        lambda m: (m.group(1) + m.group(2) + "cd" + m.group(3)
                   + m.group(4) + root + m.group(5)),
        cmd)
    if new_cmd == cmd:
        allow_noop()
    rewrite(ti, new_cmd, bad, root)


try:
    run()
except SystemExit:
    raise                            # allow_noop()/rewrite() must propagate
except Exception:
    sys.exit(0)                      # FAIL OPEN — never brick Bash
