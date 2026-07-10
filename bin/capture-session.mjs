#!/usr/bin/env node
// ~/.claude/bin/capture-session.mjs
// SessionStart hook: capture the harness-authoritative live transcript path.
//
// Claude Code hands every hook the current session's `session_id` + `transcript_path`
// on stdin, and re-fires SessionStart on resume/compact with the CURRENT values. So
// this is the one fully reliable, resume-proof source of "which .jsonl is this session
// writing right now" — better than any env var (CLAUDE_CODE_SESSION_ID is undocumented
// and frozen at process start) or daemon pointer.
//
// We persist it to sidecar files that downstream tools (usage-stats.mjs, future skills)
// read instead of guessing:
//   - $CLAUDE_JOB_DIR/transcript.json          (bg jobs — per-job, no collision)
//   - ~/.claude/run/transcripts/<encoded-cwd>.json  (interactive — latest start/resume wins)
//
// CONTRACT: best-effort telemetry. This runs on EVERY session start, so it must NEVER
// disrupt startup — every path is wrapped, and it ALWAYS exits 0. It writes only
// non-secret identifiers (session id, transcript path, cwd, source).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

function main() {
  // Read the hook payload (JSON on stdin). fd 0 is the piped, already-closed stdin.
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return; // no/!JSON stdin — nothing to capture
  }

  const sessionId = payload.session_id ?? null;
  const cwd = payload.cwd ?? process.cwd();
  const source = payload.source ?? null;

  // transcript_path is the absolute live .jsonl. Derive it if the harness omitted it.
  let transcriptPath = payload.transcript_path ?? null;
  if (!transcriptPath && sessionId && cwd) {
    const encoded = cwd.replace(/\//g, "-");
    transcriptPath = join(homedir(), ".claude/projects", encoded, `${sessionId}.jsonl`);
  }
  if (!transcriptPath) return; // can't capture without a path

  const record = {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    source,
    hook: "SessionStart",
    pid: process.ppid, // the Claude Code session process
  };
  const json = JSON.stringify(record, null, 2) + "\n";

  // (a) Per-job sidecar — authoritative for background jobs (no cross-session collision).
  try {
    const jobDir = process.env.CLAUDE_JOB_DIR;
    if (jobDir && existsSync(jobDir)) {
      writeFileSync(join(jobDir, "transcript.json"), json);
    }
  } catch {
    /* ignore */
  }

  // (b) Per-cwd sidecar — covers interactive sessions (no job dir). Latest start/resume
  //     in a given cwd wins; ambiguous only if two sessions share one cwd concurrently.
  try {
    const encoded = cwd.replace(/\//g, "-");
    const file = join(homedir(), ".claude/run/transcripts", `${encoded}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
  } catch {
    /* ignore */
  }
}

try {
  main();
} catch {
  /* never disrupt session start */
}
process.exit(0);
