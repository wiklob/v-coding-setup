#!/usr/bin/env node
// ~/.claude/bin/log-feedback.mjs
// Subjective-feedback writer (manual backstop only): append one human impression
// about how a command / session / output *felt* to pipeline/audit/feedback.jsonl. (V-86)
//
// SIBLING OF log-pipeline-error.mjs, NOT a fork of it:
//   - log-pipeline-error captures OBJECTIVE failures (a tool errored, a gate
//     misfired) on the PostToolUseFailure / PermissionDenied hooks + a manual
//     backstop, into errors.jsonl. Those are bugs, routed by /harvest-pipeline-bugs.
//   - THIS captures SUBJECTIVE feedback ("/scope was overkill here", "/go output
//     was great") that no hook can ever fire for — there is no "this felt off"
//     tool event. So this writer is MANUAL-ONLY: no hook registration, no noise
//     filter (a human-typed impression is genuine by definition).
//
// SEPARATE SINK (feedback.jsonl, not errors.jsonl) — deliberate: feedback isn't a
//   bug, and folding it into the bug log would pollute /harvest-pipeline-bugs's
//   (tool, activeCommand) routing. The bug harvester never reads this file.
//
// CONSUMER: the Pipeline self-review loop's per-ticket scorecard (V-81) — the human
//   signal it can't synthesize from transcripts alone. The format below is
//   consumer-ready (ts + session + conversation + subject + verbatim note); V-81 keys
//   off `subject` (the command/topic) the same way the scorecard is per-command, and
//   the session/conversation trace handles let it attribute feedback to a thread.
//
// TRACE HANDLES: `session` (this run) and `conversation` (the resume-chain root — the
//   thread the run belongs to) are resolved via session-identity.mjs (shared with the
//   bug sink), NOT from CLAUDE_SESSION_ID, which the bg/FleetView daemon leaves unset —
//   the reason every feedback entry would otherwise be session:null.
//
// SECRET SAFETY: the note can paste a token, so it passes through redact() (imported
//   from transcript-resolver.mjs, same lib log-pipeline-error uses) before write.
//
// CONTRACT: best-effort telemetry — never disrupt a session, ALWAYS exit 0.
//
// USAGE (the /report-feedback front door invokes this):
//   node ~/.claude/bin/log-feedback.mjs --note "<impression>" [--subject <command-or-topic>] [--session <id>]
//     --note     (required) the verbatim impression. Empty/absent → nothing logged.
//     --subject  (optional) the command/topic the feedback is about ("scope", "go",
//                "land-ticket"). The /report-feedback command infers this from
//                context and passes it; omitted → null (not all feedback has a subject).
//     --session  (optional) override the auto-resolved session id (backfill); normally
//                omitted — the writer resolves session + conversation itself.
//
// Exit codes: always 0.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./transcript-resolver.mjs";
import { resolveSessionId, resolveConversationId } from "./session-identity.mjs";

// Repo-rooted sink path: this file lives at <root>/bin/, sink at <root>/pipeline/audit/.
// fileURLToPath (not new URL(...).pathname) so a space / non-ASCII char in an ancestor
// dir doesn't percent-encode the path and silently misdirect the write. (Mirrors
// log-pipeline-error.mjs.) The path follows the script's location, so capture is
// GLOBAL — every session writes the main checkout's feedback.jsonl regardless of cwd.
const SINK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "audit", "feedback.jsonl");

// Build the JSONL record. `nowIso` is injected so the function is pure/testable.
// Subject is normalized to a bare slug (leading slash stripped) or null. `session`
// (the run) and `conversation` (the thread it belongs to) are the V-1 trace handles,
// resolved by the caller and passed in — kept as inputs so the builder stays pure.
export function buildRecord({ note, subject, session, conversation }, nowIso) {
  return {
    ts: nowIso,
    session: session ?? null,
    conversation: conversation ?? null,
    subject: normalizeSubject(subject),
    note: redact(String(note)),
  };
}

function normalizeSubject(subject) {
  if (typeof subject !== "string") return null;
  const s = subject.trim().replace(/^\//, "");
  return s.length ? s : null;
}

function appendRecord(rec) {
  const line = JSON.stringify(rec) + "\n";
  mkdirSync(dirname(SINK_PATH), { recursive: true });
  appendFileSync(SINK_PATH, line);
}

function parseFlags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--note") f.note = argv[++i];
    else if (a === "--subject") f.subject = argv[++i];
    else if (a === "--session") f.session = argv[++i];
  }
  return f;
}

function main() {
  const nowIso = new Date().toISOString();
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.note || !String(flags.note).trim()) return; // nothing to log; stay silent
  // Resolve the trace handles the same way the bug sink does — NOT from
  // CLAUDE_SESSION_ID (unset in the bg/FleetView daemon, which is why every feedback
  // entry would otherwise be session:null), but from the job state.json + resume chain.
  const session = resolveSessionId(flags);
  const conversation = resolveConversationId(session);
  appendRecord(buildRecord({ note: flags.note, subject: flags.subject, session, conversation }, nowIso));
}

// Only run as a CLI, not when imported by the test.
const isMain = process.argv[1] && process.argv[1].endsWith("log-feedback.mjs");
if (isMain) {
  try {
    main();
  } catch {
    /* never disrupt a session */
  }
  process.exit(0);
}
