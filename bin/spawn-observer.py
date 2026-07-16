#!/usr/bin/env python3
"""spawn-observer — external watchdog for runaway subagent spawning.

The enforcement layer OUTSIDE the thing being limited (same philosophy as a
memory-leak watchdog): guard-agent-spawn.py runs inside each session's hook
chain, but a misconfigured session, a foreign client, or a future tool bypasses
it. This observer watches the filesystem ground truth instead — every spawned
agent, at any depth, from any client, leaves an agent-*.meta.json under its
session's subagents/ dir.

Every run (launchd, ~60s) it scans recently-active sessions and flags any whose
tree crossed an absolute size or a growth-rate threshold. Flagging appends the
session_id to ~/.claude/spawn-guard.blocklist, which guard-agent-spawn.py turns
into a hard deny of ALL further spawning in that session — a soft-stop that
lets the session finish its in-flight work but not widen. Yesterday's cascade
(2026-07-15) spawned 132 agents in one minute; either threshold catches that in
a single interval. Entries are never auto-removed — a human unblocks by editing
the blocklist.

Env knobs (defaults tuned to yesterday's data):
  SPAWN_OBSERVER_ROOT            projects root   (~/.claude/projects)
  SPAWN_OBSERVER_BLOCKLIST       blocklist path  (~/.claude/spawn-guard.blocklist)
  SPAWN_OBSERVER_STATE           state file      (~/.claude/spawn-observer-state.json)
  SPAWN_OBSERVER_MAX_AGENTS      absolute cap    (default 100)
  SPAWN_OBSERVER_MAX_GROWTH      new agents per interval (default 30)
  SPAWN_OBSERVER_ACTIVE_MINUTES  only sessions touched this recently (default 30)

Usage: spawn-observer.py [--once]   (it is single-shot either way; --once is
       accepted for clarity in manual runs; scheduling is launchd's job —
       see install-spawn-observer-launchd.sh)
"""
import sys, os, json, glob, time

ROOT = os.environ.get("SPAWN_OBSERVER_ROOT",
                      os.path.expanduser("~/.claude/projects"))
BLOCKLIST = os.environ.get("SPAWN_OBSERVER_BLOCKLIST",
                           os.path.expanduser("~/.claude/spawn-guard.blocklist"))
STATE = os.environ.get("SPAWN_OBSERVER_STATE",
                       os.path.expanduser("~/.claude/spawn-observer-state.json"))


def env_int(name, default):
    try:
        v = int(os.environ.get(name, ""))
        return v if v >= 1 else default
    except ValueError:
        return default


MAX_AGENTS = env_int("SPAWN_OBSERVER_MAX_AGENTS", 100)
MAX_GROWTH = env_int("SPAWN_OBSERVER_MAX_GROWTH", 30)
ACTIVE_MIN = env_int("SPAWN_OBSERVER_ACTIVE_MINUTES", 30)


def load_json(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback


def blocklisted():
    try:
        with open(BLOCKLIST) as f:
            return {ln.strip() for ln in f if ln.strip()}
    except OSError:
        return set()


def block(session_id, reason):
    with open(BLOCKLIST, "a") as f:
        f.write(session_id + "\n")
    sys.stdout.write("%s BLOCKED %s: %s\n"
                     % (time.strftime("%Y-%m-%dT%H:%M:%S"), session_id, reason))
    # best-effort desktop ping; the blocklist is the mechanism, this is courtesy
    try:
        import subprocess
        subprocess.run(
            ["osascript", "-e",
             'display notification "%s" with title "spawn-observer: session blocked"'
             % reason.replace('"', "'")],
            capture_output=True, timeout=5)
    except Exception:
        pass


def main():
    now = time.time()
    prev = load_json(STATE, {})
    prev_counts = prev.get("counts", {})
    counts = {}
    already = blocklisted()

    for sub in glob.glob(os.path.join(ROOT, "*", "*", "subagents")):
        sess_dir = os.path.dirname(sub)
        session_id = os.path.basename(sess_dir)
        transcript = sess_dir + ".jsonl"
        # only sessions with recent transcript activity are worth counting
        try:
            if now - os.stat(transcript).st_mtime > ACTIVE_MIN * 60:
                continue
        except OSError:
            continue
        n = len(glob.glob(os.path.join(sub, "agent-*.meta.json")))
        counts[session_id] = n
        if session_id in already:
            continue
        grew = n - prev_counts.get(session_id, 0) if session_id in prev_counts else 0
        if n >= MAX_AGENTS:
            block(session_id, "%d agents (cap %d)" % (n, MAX_AGENTS))
        elif grew >= MAX_GROWTH:
            block(session_id, "+%d agents in one interval (cap %d, total %d)"
                  % (grew, MAX_GROWTH, n))

    with open(STATE, "w") as f:
        json.dump({"at": now, "counts": counts}, f)


if __name__ == "__main__":
    main()
