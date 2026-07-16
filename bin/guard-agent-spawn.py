#!/usr/bin/env python3
"""PreToolUse Agent/Task guard — hard caps on subagent spawning.

Why this exists (the 2026-07-15 cascade): a routed foreign model applied the
pipeline's "spawn reviewers/verifiers" instructions at EVERY nesting level
instead of acting as a leaf. Spawn-depth census of one job: 7 -> 16 -> 56 ->
291 -> 920 agents (depths 1-5, geometric, ~x4/level) — ~25k completions in one
afternoon, a weekly provider quota dead by 16:00, and a second session did the
same to the Anthropic monthly cap. The advisory guardrail existed
(pipeline/profiles/routed.md, "cap fan-out hard") and was ignored: .md text is
non-binding for models. This hook is the binding version. The only structural
backstop yesterday was Claude Code's own non-configurable depth-5 ceiling.

Two independent caps, both deny (permissionDecision "deny" — the model sees the
reason and must proceed inline or report to the human; it cannot override):

  * DEPTH — a caller that is itself a subagent at spawnDepth >= MAX_DEPTH may
    not spawn. Default MAX_DEPTH=2: the main loop spawns freely (depth-1
    agents), a depth-1 agent may still fan out one level (finders at depth 2,
    e.g. /code-review), depth-2+ agents are leaves. Caller depth comes from its
    own agent-<agent_id>.meta.json (spawnDepth), written by the harness next to
    the caller's transcript; an unreadable meta counts as depth 1 (known
    subagent, unknown depth — still gets one fan-out level, never unlimited).

  * SESSION BUDGET — at most SESSION_BUDGET descendants per SESSION, counted as
    agent-*.meta.json under the session's subagents/ dir. Every depth lands
    flat in that one dir, so a single counter caps the whole tree. Deliberately
    per-session, NOT global: parallel sessions each get their own budget.

  * BLOCKLIST — ~/.claude/spawn-guard.blocklist (one session_id per line) denies
    ALL spawning for listed sessions. This is the hand-brake an external
    observer (bin/spawn-observer) pulls on a session that trips its threshold.

Tuning: env SPAWN_GUARD_MAX_DEPTH / SPAWN_GUARD_SESSION_BUDGET (positive ints)
override the defaults; a human raises them for a legitimately huge run instead
of the model raising them for itself.

Safety: FAILS OPEN on parse/logic errors (exit 0) — a broken guard must not
brick the Agent tool. It fails CLOSED only on its own explicit caps.
"""
import sys, os, json, glob

MAX_DEPTH_DEFAULT = 2
SESSION_BUDGET_DEFAULT = 60
BLOCKLIST = os.path.expanduser("~/.claude/spawn-guard.blocklist")


def allow_noop():
    sys.exit(0)


def deny(reason):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}) + "\n")
    sys.exit(0)


def env_int(name, default):
    try:
        v = int(os.environ.get(name, ""))
        return v if v >= 1 else default
    except ValueError:
        return default


def caller_depth(event):
    """Depth of the CALLER: 0 = main loop, N>=1 = subagent at spawnDepth N."""
    agent_id = event.get("agent_id")
    if not agent_id:
        return 0
    # the caller's meta sits next to its transcript: .../subagents/agent-<id>.meta.json
    tp = event.get("transcript_path", "") or ""
    meta = os.path.join(os.path.dirname(tp), "agent-%s.meta.json" % agent_id)
    try:
        with open(meta) as f:
            d = json.load(f).get("spawnDepth")
        return d if isinstance(d, int) and d >= 1 else 1
    except Exception:
        return 1  # known subagent, unknown depth


def subagents_dir(event):
    """The session's flat subagents/ dir (all depths land here)."""
    tp = event.get("transcript_path", "") or ""
    if not tp:
        return None
    d = os.path.dirname(tp)
    if os.path.basename(d) == "subagents":
        return d                                  # caller is a subagent
    sid = event.get("session_id", "")
    return os.path.join(d, sid, "subagents") if sid else None


def session_blocklisted(session_id):
    try:
        with open(BLOCKLIST) as f:
            return session_id in {ln.strip() for ln in f if ln.strip()}
    except OSError:
        return False


def run():
    raw = sys.stdin.read()
    event = json.loads(raw) if raw.strip() else {}
    if event.get("tool_name", "") not in ("Agent", "Task"):
        allow_noop()

    sid = event.get("session_id", "")
    if sid and session_blocklisted(sid):
        deny("spawn-guard: session %s is on ~/.claude/spawn-guard.blocklist "
             "(an external observer flagged runaway spawning). Do NOT spawn any "
             "more agents; finish inline and report to the human." % sid)

    max_depth = env_int("SPAWN_GUARD_MAX_DEPTH", MAX_DEPTH_DEFAULT)
    depth = caller_depth(event)
    if depth >= max_depth:
        deny("spawn-guard: you are a depth-%d subagent; spawning past depth %d "
             "is capped (the 2026-07-15 cascade reached depth 5 and ~1300 agents). "
             "Do the work yourself inline and return a compact result. A human can "
             "raise SPAWN_GUARD_MAX_DEPTH for a legitimately deeper run."
             % (depth, max_depth))

    budget = env_int("SPAWN_GUARD_SESSION_BUDGET", SESSION_BUDGET_DEFAULT)
    d = subagents_dir(event)
    if d and os.path.isdir(d):
        spawned = len(glob.glob(os.path.join(d, "agent-*.meta.json")))
        if spawned >= budget:
            deny("spawn-guard: this session already spawned %d agents — the "
                 "per-session budget (%d) is exhausted. Do NOT spawn more or retry; "
                 "finish with what you have, inline, and report to the human. A "
                 "human can raise SPAWN_GUARD_SESSION_BUDGET for a bigger run."
                 % (spawned, budget))

    allow_noop()


try:
    run()
except SystemExit:
    raise                            # allow_noop()/deny() must propagate
except Exception:
    sys.exit(0)                      # FAIL OPEN — never brick the Agent tool
