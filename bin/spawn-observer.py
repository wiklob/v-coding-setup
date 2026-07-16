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

Second duty — JOB PARKING: the bg-job daemon re-runs a blocked job on a cadence
we don't control, and on 2026-07-15 that meant re-shipping full context into a
provider whose limit was already exhausted, every ~3 minutes, for an hour. The
observer parks such jobs: a job whose state is "blocked" with a provider-limit
error (cooling down / rate limit / spend or usage limit / quota) recorded
PARK_STRIKES+ times in its recent timeline gets state=done (original state.json
backed up as .parked.bak, the reason preserved in detail). A human resumes it
deliberately, on a model with quota.

Env knobs (defaults tuned to yesterday's data):
  SPAWN_OBSERVER_ROOT            projects root   (~/.claude/projects)
  SPAWN_OBSERVER_JOBS            jobs root       (~/.claude/jobs)
  SPAWN_OBSERVER_BLOCKLIST       blocklist path  (~/.claude/spawn-guard.blocklist)
  SPAWN_OBSERVER_STATE           state file      (~/.claude/spawn-observer-state.json)
  SPAWN_OBSERVER_MAX_AGENTS      absolute cap    (default 100)
  SPAWN_OBSERVER_MAX_GROWTH      new agents per interval (default 30)
  SPAWN_OBSERVER_ACTIVE_MINUTES  only sessions touched this recently (default 30)
  SPAWN_OBSERVER_PARK_STRIKES    provider-limit blocks before parking (default 3)
  SPAWN_OBSERVER_PARK_WINDOW_MIN strike window in minutes (default 60)

Usage: spawn-observer.py [--once]   (it is single-shot either way; --once is
       accepted for clarity in manual runs; scheduling is launchd's job —
       see install-spawn-observer-launchd.sh)
"""
import sys, os, json, glob, time, re, shutil

ROOT = os.environ.get("SPAWN_OBSERVER_ROOT",
                      os.path.expanduser("~/.claude/projects"))
JOBS = os.environ.get("SPAWN_OBSERVER_JOBS",
                      os.path.expanduser("~/.claude/jobs"))
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
PARK_STRIKES = env_int("SPAWN_OBSERVER_PARK_STRIKES", 3)
PARK_WINDOW = env_int("SPAWN_OBSERVER_PARK_WINDOW_MIN", 60)

# provider-limit signatures — the errors that make respawning pure waste
LIMIT_RE = re.compile(
    r"cooling down|rate.?limit|spend limit|usage limit|quota|credit balance",
    re.IGNORECASE)


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


def parse_ts(s):
    """ISO-8601 'Z' timestamp -> epoch seconds (0 on failure)."""
    try:
        import datetime
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0


def limit_strikes(job_dir, now):
    """Provider-limit blocked events in this job's timeline within the window."""
    n = 0
    try:
        with open(os.path.join(job_dir, "timeline.jsonl")) as f:
            for ln in f:
                try:
                    ev = json.loads(ln)
                except ValueError:
                    continue
                if (ev.get("state") == "blocked"
                        and LIMIT_RE.search(ev.get("detail") or "")
                        and now - parse_ts(ev.get("at", "")) <= PARK_WINDOW * 60):
                    n += 1
    except OSError:
        pass
    return n


def park_limited_jobs(now):
    for state_path in glob.glob(os.path.join(JOBS, "*", "state.json")):
        job_dir = os.path.dirname(state_path)
        st = load_json(state_path, None)
        if not st or st.get("state") != "blocked":
            continue
        detail = st.get("detail") or ""
        if not LIMIT_RE.search(detail):
            continue
        strikes = limit_strikes(job_dir, now)
        if strikes < PARK_STRIKES:
            continue
        shutil.copy2(state_path, state_path + ".parked.bak")
        st["state"] = "done"
        st["tempo"] = "done"
        st["detail"] = ("parked %s by spawn-observer: %d provider-limit blocks in %d min — "
                        "respawning a limited job only re-ships context into a dead account. "
                        "Original: %s"
                        % (time.strftime("%Y-%m-%dT%H:%M:%S"), strikes, PARK_WINDOW, detail))
        with open(state_path, "w") as f:
            json.dump(st, f, indent=2)
        sys.stdout.write("%s PARKED job %s (%d strikes): %s\n"
                         % (time.strftime("%Y-%m-%dT%H:%M:%S"),
                            os.path.basename(job_dir), strikes, detail[:120]))
        try:
            import subprocess
            subprocess.run(
                ["osascript", "-e",
                 'display notification "job %s parked (provider limit)" '
                 'with title "spawn-observer"' % os.path.basename(job_dir)],
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

    park_limited_jobs(now)


if __name__ == "__main__":
    main()
