#!/usr/bin/env node
// ~/.claude/bin/session-identity.mjs
// Shared session/conversation identity resolution for the pipeline telemetry
// writers (log-pipeline-error.mjs, log-feedback.mjs) and the V-1 census
// (usage-stats.mjs). One owner for two trace handles, so the bug sink, the
// feedback sink, and the census all resolve identity the same way.
//
// WHY A SHARED MODULE (not a method on one writer): log-pipeline-error and
//   log-feedback are deliberately SIBLINGS, not forks of each other; the census is
//   a third, unrelated consumer. They must share the identity primitive without one
//   depending on another's internals — so it lives here, depended on by all three.
//
// THE TWO HANDLES:
//   session       — one run (one transcript file). The id of "this CLI invocation".
//   conversation  — the THREAD a run belongs to: a chain of sessions linked by each
//                   daemon job's state.json `resumeSessionId` (a follow-up turn or a
//                   post-compaction restart mints a NEW session that resumes the
//                   prior one). The chain ROOT is the stable per-conversation id, so
//                   two entries from one thread share it.
//
// WHY NOT CLAUDE_SESSION_ID: the bg/FleetView daemon launch path does NOT export
//   CLAUDE_SESSION_ID, so an env-only read returns null (the long-standing
//   session:null on every manual /report-bug). The real id lives in the job's
//   state.json (CLAUDE_JOB_DIR is exported), and the resume chain is walked from the
//   same per-job state files — so both handles resolve without the env var.
//
// CONTRACT: best-effort + never throws. These run inside always-exit-0 telemetry
//   writers, so every path is wrapped and degrades to a sensible fallback (the
//   session itself, or null) rather than propagating an error.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// The daemon's per-job state lives here (one dir per job, named by the session's
// 8-char short id). Global, not worktree-relative — homedir(), never cwd.
const JOBS_DIR = join(homedir(), ".claude", "jobs");

// Read one job's state.json by session id. The daemon names each job dir by the
// session's 8-char short id (daemonShort), so the dir is an O(1) prefix lookup.
// The full `sessionId` inside is checked against the requested id to reject an
// 8-hex prefix collision (or a stale/recycled dir). Never throws.
function readJobState(sessionId, jobsDir = JOBS_DIR) {
  if (!sessionId) return null;
  try {
    const p = join(jobsDir, String(sessionId).slice(0, 8), "state.json");
    if (!existsSync(p)) return null;
    const st = JSON.parse(readFileSync(p, "utf8"));
    if (st && st.sessionId && st.sessionId !== sessionId) return null; // prefix collision / stale dir
    return st;
  } catch {
    return null;
  }
}

// Resolve the CURRENT session id. Precedence:
//   1. an explicit --session flag (a caller that already resolved it),
//   2. CLAUDE_SESSION_ID (set in interactive TTY runs),
//   3. the daemon job's state.json sessionId (CLAUDE_JOB_DIR is exported even when
//      CLAUDE_SESSION_ID is NOT — the bg/FleetView launch path). This step is what
//      stops manual entries (e.g. /report-bug, /report-feedback) writing session:null.
// Returns null when none resolves. Never throws.
export function resolveSessionId(flags = {}, env = process.env) {
  if (flags.session) return flags.session;
  if (env.CLAUDE_SESSION_ID) return env.CLAUDE_SESSION_ID;
  try {
    if (env.CLAUDE_JOB_DIR) {
      const p = join(env.CLAUDE_JOB_DIR, "state.json");
      if (existsSync(p)) {
        const st = JSON.parse(readFileSync(p, "utf8"));
        if (st && st.sessionId) return st.sessionId;
      }
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

// Resolve the CONVERSATION id for a session — the trace handle that survives across
// a thread's many sessions. Walks the resume chain (state.json `resumeSessionId`)
// to its ROOT (the origin session), the stable per-conversation identity.
//
// Best-effort by construction: resume-chain ancestors get GC'd, so this returns the
// FURTHEST session it can still reach — the true root when the chain survives intact,
// else the oldest reachable ancestor, else the session itself (a length-1 chain when
// nothing is traceable). Cycle-guarded and depth-capped. Never throws.
export function resolveConversationId(sessionId, jobsDir = JOBS_DIR) {
  if (!sessionId) return null;
  let cur = sessionId;
  const seen = new Set([cur]);
  for (let hops = 0; hops < 64; hops++) {
    const parent = readJobState(cur, jobsDir)?.resumeSessionId;
    if (!parent || parent === cur || seen.has(parent)) break;
    if (!readJobState(parent, jobsDir)) break; // ancestor GC'd → cur is the furthest reachable root
    seen.add(parent);
    cur = parent;
  }
  return cur;
}
